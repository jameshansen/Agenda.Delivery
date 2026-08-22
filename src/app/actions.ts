"use server";

import crypto from "crypto";
import { eq, and } from "drizzle-orm";
import { auth, signIn, signOut } from "@/auth";
import { db } from "@/db";
import {
  modules,
  subscriptions,
  users,
  automationTargets,
  automationArtifacts,
  automationRules,
  mailingLists,
} from "@/db/schema";
import { isValidContact } from "@/lib/contact";
import { requestOtp, verifyOtp } from "@/lib/otp";
import { createSession } from "@/lib/session";
import { rateLimit } from "@/lib/rate-limit";
import { SMS_ENABLED } from "@/lib/features";
import { revalidatePath } from "next/cache";

async function requireUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not signed in");
  return session.user.id;
}

export async function signInGoogle() {
  await signIn("google", { redirectTo: "/account" });
}

export async function signOutAction() {
  await signOut({ redirectTo: "/" });
}

export async function subscribe(input: {
  slug: string;
  channel: "email" | "text";
  contact: string;
}) {
  const [m] = await db
    .select({ id: modules.id })
    .from(modules)
    .where(eq(modules.slug, input.slug))
    .limit(1);
  if (!m) throw new Error("Unknown module");
  if (input.channel === "text" && !SMS_ENABLED) throw new Error("SMS is not enabled");

  const session = await auth();
  const userId = session?.user?.id ?? null;

  // Idempotent for signed-in users: don't stack duplicate rows (which would
  // double-email) when someone subscribes again or picks "Create an Action".
  if (userId) {
    const [existing] = await db
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(and(eq(subscriptions.moduleId, m.id), eq(subscriptions.userId, userId), eq(subscriptions.channel, input.channel)))
      .limit(1);
    if (existing) return;
  }

  await db.insert(subscriptions).values({
    moduleId: m.id,
    channel: input.channel,
    contact: input.contact,
    userId,
  });
}

/** Send a one-time code to an email or phone number for signup/sign-in. */
export async function requestOtpAction(input: { channel: "email" | "text"; contact: string }) {
  const { channel, contact } = input;
  if (channel === "text" && !SMS_ENABLED) {
    return { ok: false, error: "Text messages aren't available yet. Please use email." };
  }
  if (!isValidContact(channel, contact)) {
    return { ok: false, error: "That doesn't look like a valid contact." };
  }
  const rl = rateLimit(`otp:${contact}`, 3, 10 * 60 * 1000);
  if (!rl.allowed) {
    return { ok: false, error: "Too many codes requested. Try again in a few minutes." };
  }
  try {
    await requestOtp(channel, contact);
    return { ok: true };
  } catch (err) {
    console.error("[requestOtpAction] failed:", err);
    return { ok: false, error: "Couldn't send a code just now. Try again." };
  }
}

/**
 * Verify a submitted code, find-or-create the account, sign the user in
 * (database session, same shape Auth.js uses), and — if a module slug was
 * carried through from a guest subscribe attempt — create the subscription
 * now that the contact is actually verified.
 */
export async function verifyOtpAction(input: {
  channel: "email" | "text";
  contact: string;
  code: string;
  moduleSlug?: string;
}) {
  const { channel, contact, code, moduleSlug } = input;
  const rl = rateLimit(`otp-verify:${contact}`, 8, 10 * 60 * 1000);
  if (!rl.allowed) {
    return { ok: false, error: "Too many attempts. Try again in a few minutes." };
  }

  const valid = await verifyOtp(contact, code);
  if (!valid) return { ok: false, error: "That code is incorrect or expired." };

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(channel === "email" ? eq(users.email, contact) : eq(users.phone, contact))
    .limit(1);

  let userId: string;
  const now = new Date();
  if (existing) {
    userId = existing.id;
    await db
      .update(users)
      .set(channel === "email" ? { emailVerified: now } : { phoneVerified: now })
      .where(eq(users.id, userId));
  } else {
    const [created] = await db
      .insert(users)
      .values(
        channel === "email"
          ? { email: contact, emailVerified: now }
          : { phone: contact, phoneVerified: now },
      )
      .returning({ id: users.id });
    userId = created.id;
  }

  await createSession(userId);

  if (moduleSlug) {
    const [m] = await db.select({ id: modules.id }).from(modules).where(eq(modules.slug, moduleSlug)).limit(1);
    if (m) {
      await db.insert(subscriptions).values({ moduleId: m.id, channel, contact, userId });
      // Email delivery is action-driven; give an email subscriber the matching
      // "Send to my email" action so they actually receive summaries.
      if (channel === "email") {
        await db.insert(automationRules).values({
          userId,
          moduleId: m.id,
          trigger: "new_agenda",
          contentMode: "summary",
          actionKind: "email",
        });
      }
    }
  }

  return { ok: true };
}

/** Unsubscribe from a module. Requires the user to be signed in. */
export async function unsubscribe(input: { slug: string }) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not signed in");

  const [m] = await db
    .select({ id: modules.id })
    .from(modules)
    .where(eq(modules.slug, input.slug))
    .limit(1);
  if (!m) throw new Error("Unknown module");

  await db
    .delete(subscriptions)
    .where(
      and(
        eq(subscriptions.moduleId, m.id),
        eq(subscriptions.userId, session.user.id),
      ),
    );
}

/* ---- API key ---- */

/**
 * Generate a fresh API key, store only its sha256 hash + an 8-char prefix,
 * and return the raw key exactly once — the caller must show it to the
 * user immediately, it can never be recovered again.
 */
export async function generateApiKey(): Promise<{ key: string; prefix: string }> {
  const userId = await requireUserId();
  const key = `agd_${crypto.randomBytes(24).toString("hex")}`;
  const prefix = key.slice(0, 12);
  const hash = crypto.createHash("sha256").update(key).digest("hex");
  await db.update(users).set({ apiKeyHash: hash, apiKeyPrefix: prefix }).where(eq(users.id, userId));
  return { key, prefix };
}

/* ---- Accounts redesign: targets, artifacts, rules, mailing lists ---- */

function validUrl(u: string): boolean {
  try { new URL(u); return true; } catch { return false; }
}

/** Reusable delivery target (script URL or Discord webhook). */
export async function createTarget(input: { kind: "script" | "discord"; name: string; url: string }) {
  const userId = await requireUserId();
  if (!input.name.trim()) return { ok: false, error: "Name can't be empty." };
  if (!validUrl(input.url)) return { ok: false, error: "That doesn't look like a valid URL." };
  await db.insert(automationTargets).values({
    userId, kind: input.kind, name: input.name.trim(), url: input.url.trim(),
  });
  revalidatePath("/account");
  return { ok: true };
}

export async function deleteTarget(input: { id: string }) {
  const userId = await requireUserId();
  await db.delete(automationTargets).where(and(eq(automationTargets.id, input.id), eq(automationTargets.userId, userId)));
  revalidatePath("/account");
}

/** Reusable content transform (custom prompt or keywords). */
export async function createArtifact(input: { kind: "custom_prompt" | "keywords"; name: string; promptText?: string; keywords?: string }) {
  const userId = await requireUserId();
  if (!input.name.trim()) return { ok: false, error: "Name can't be empty." };
  if (input.kind === "custom_prompt" && !input.promptText?.trim()) return { ok: false, error: "Prompt can't be empty." };
  if (input.kind === "keywords" && !input.keywords?.trim()) return { ok: false, error: "Keywords can't be empty." };
  await db.insert(automationArtifacts).values({
    userId, kind: input.kind, name: input.name.trim(),
    promptText: input.promptText?.trim() || null,
    keywords: input.keywords?.trim() || null,
  });
  revalidatePath("/account");
  return { ok: true };
}

export async function deleteArtifact(input: { id: string }) {
  const userId = await requireUserId();
  await db.delete(automationArtifacts).where(and(eq(automationArtifacts.id, input.id), eq(automationArtifacts.userId, userId)));
  revalidatePath("/account");
}

/** A flowchart rule: subscription trigger → optional artifact → action. */
export async function createRule(input: {
  moduleId: string;
  trigger: "new_agenda" | "new_summary";
  artifactId?: string | null;
  contentMode: "summary" | "link" | "full_text";
  actionKind: "email" | "script" | "discord" | "mailing_list";
  targetId?: string | null;
  listId?: string | null;
}) {
  const userId = await requireUserId();
  if (input.actionKind === "mailing_list" && !input.listId) return { ok: false, error: "Pick a mailing list." };
  if ((input.actionKind === "script" || input.actionKind === "discord") && !input.targetId) {
    return { ok: false, error: "Pick a target." };
  }
  await db.insert(automationRules).values({
    userId,
    moduleId: input.moduleId,
    trigger: input.trigger,
    artifactId: input.artifactId || null,
    contentMode: input.contentMode,
    actionKind: input.actionKind,
    targetId: input.actionKind === "script" || input.actionKind === "discord" ? input.targetId || null : null,
    listId: input.actionKind === "mailing_list" ? input.listId || null : null,
  });
  revalidatePath("/account");
  return { ok: true };
}

/**
 * Convenience for the module page's "Send the summary to my email": ensure the
 * module is followed (so it shows in Subscriptions) and create a default
 * "email the AI summary on a new agenda" action, unless one already exists.
 */
export async function subscribeAndEmail(input: { slug: string }) {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "Not signed in" };
  const userId = session.user.id;
  const email = session.user.email;
  if (!email) return { ok: false, error: "Your account has no email address." };

  const [m] = await db.select({ id: modules.id }).from(modules).where(eq(modules.slug, input.slug)).limit(1);
  if (!m) return { ok: false, error: "Unknown module" };

  await subscribe({ slug: input.slug, channel: "email", contact: email });

  const [existingRule] = await db
    .select({ id: automationRules.id })
    .from(automationRules)
    .where(
      and(
        eq(automationRules.userId, userId),
        eq(automationRules.moduleId, m.id),
        eq(automationRules.actionKind, "email"),
        eq(automationRules.trigger, "new_agenda"),
      ),
    )
    .limit(1);
  if (!existingRule) {
    await db.insert(automationRules).values({
      userId,
      moduleId: m.id,
      trigger: "new_agenda",
      contentMode: "summary",
      actionKind: "email",
    });
  }
  revalidatePath("/account");
  return { ok: true };
}

export async function deleteRule(input: { id: string }) {
  const userId = await requireUserId();
  await db.delete(automationRules).where(and(eq(automationRules.id, input.id), eq(automationRules.userId, userId)));
  revalidatePath("/account");
}

export async function saveMailingList(input: {
  id?: string;
  name: string;
  header: string;
  footer: string;
  emails: string;
  sendPolicy: "threshold" | "schedule";
  threshold: number;
  frequency: "daily" | "weekly";
}) {
  const userId = await requireUserId();
  if (!input.name.trim()) return { ok: false, error: "Name can't be empty." };
  const values = {
    name: input.name.trim(),
    header: input.header,
    footer: input.footer,
    emails: input.emails,
    sendPolicy: input.sendPolicy,
    threshold: Math.max(1, input.threshold || 5),
    frequency: input.frequency,
  };
  if (input.id) {
    await db.update(mailingLists).set(values).where(and(eq(mailingLists.id, input.id), eq(mailingLists.userId, userId)));
  } else {
    await db.insert(mailingLists).values({ userId, ...values });
  }
  revalidatePath("/account");
  return { ok: true };
}

export async function deleteMailingList(input: { id: string }) {
  const userId = await requireUserId();
  await db.delete(mailingLists).where(and(eq(mailingLists.id, input.id), eq(mailingLists.userId, userId)));
  revalidatePath("/account");
}
