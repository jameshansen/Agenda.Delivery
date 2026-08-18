"use server";

import crypto from "crypto";
import { eq, and, count } from "drizzle-orm";
import { auth, signIn, signOut } from "@/auth";
import { db } from "@/db";
import {
  modules,
  subscriptions,
  users,
  pushTargets,
  customPrompts,
  keywords,
  keywordFollows,
} from "@/db/schema";
import { isValidContact } from "@/lib/contact";
import { requestOtp, verifyOtp } from "@/lib/otp";
import { createSession } from "@/lib/session";
import { rateLimit } from "@/lib/rate-limit";

const MAX_CUSTOM_PROMPTS = 5;

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

  const session = await auth();
  await db.insert(subscriptions).values({
    moduleId: m.id,
    channel: input.channel,
    contact: input.contact,
    userId: session?.user?.id ?? null,
  });
}

/** Send a one-time code to an email or phone number for signup/sign-in. */
export async function requestOtpAction(input: { channel: "email" | "text"; contact: string }) {
  const { channel, contact } = input;
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

/* ---- Phase 6: API key, push targets, custom prompts, keyword follows ---- */

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

export async function savePushTarget(input: { kind: "discord" | "webhook"; url: string }) {
  const userId = await requireUserId();
  if (input.url) {
    try {
      new URL(input.url);
    } catch {
      return { ok: false, error: "That doesn't look like a valid URL." };
    }
  }
  await db
    .insert(pushTargets)
    .values({ userId, kind: input.kind, url: input.url })
    .onConflictDoUpdate({
      target: [pushTargets.userId, pushTargets.kind],
      set: { url: input.url },
    });
  return { ok: true };
}

export async function deletePushTarget(input: { kind: "discord" | "webhook" }) {
  const userId = await requireUserId();
  await db
    .delete(pushTargets)
    .where(and(eq(pushTargets.userId, userId), eq(pushTargets.kind, input.kind)));
}

export async function addCustomPrompt(input: { promptText: string; pushUrl?: string }) {
  const userId = await requireUserId();
  if (!input.promptText.trim()) return { ok: false, error: "Prompt can't be empty." };
  const [{ value: existing }] = await db
    .select({ value: count() })
    .from(customPrompts)
    .where(eq(customPrompts.userId, userId));
  if (existing >= MAX_CUSTOM_PROMPTS) {
    return { ok: false, error: `You can have up to ${MAX_CUSTOM_PROMPTS} custom prompts.` };
  }
  const [created] = await db
    .insert(customPrompts)
    .values({
      userId,
      promptText: input.promptText.trim(),
      pushUrl: input.pushUrl?.trim() || null,
    })
    .returning({ id: customPrompts.id });
  return { ok: true, id: created.id };
}

export async function deleteCustomPrompt(input: { id: string }) {
  const userId = await requireUserId();
  await db.delete(customPrompts).where(and(eq(customPrompts.id, input.id), eq(customPrompts.userId, userId)));
}

/** Follow a module's keyword (push URL is set later from the account page; starts null). */
export async function followKeyword(input: { keywordId: string }) {
  const userId = await requireUserId();
  await db
    .insert(keywordFollows)
    .values({ userId, keywordId: input.keywordId })
    .onConflictDoNothing();
  await db
    .update(keywords)
    .set({ followers: (await db.select({ value: count() }).from(keywordFollows).where(eq(keywordFollows.keywordId, input.keywordId)))[0].value })
    .where(eq(keywords.id, input.keywordId));
}

export async function unfollowKeyword(input: { keywordId: string }) {
  const userId = await requireUserId();
  await db
    .delete(keywordFollows)
    .where(and(eq(keywordFollows.userId, userId), eq(keywordFollows.keywordId, input.keywordId)));
  await db
    .update(keywords)
    .set({ followers: (await db.select({ value: count() }).from(keywordFollows).where(eq(keywordFollows.keywordId, input.keywordId)))[0].value })
    .where(eq(keywords.id, input.keywordId));
}

export async function updateKeywordFollowPushUrl(input: { keywordId: string; pushUrl: string }) {
  const userId = await requireUserId();
  if (input.pushUrl) {
    try {
      new URL(input.pushUrl);
    } catch {
      return { ok: false, error: "That doesn't look like a valid URL." };
    }
  }
  await db
    .update(keywordFollows)
    .set({ pushUrl: input.pushUrl.trim() || null })
    .where(and(eq(keywordFollows.userId, userId), eq(keywordFollows.keywordId, input.keywordId)));
  return { ok: true };
}
