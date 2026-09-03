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
  mailingListSubscribers,
  subscribers as subscriberTable,
  emailTemplates,
  mergeFields,
  senderSettings,
} from "@/db/schema";
import { isValidContact } from "@/lib/contact";
import { requestOtp, verifyOtp } from "@/lib/otp";
import { createSession } from "@/lib/session";
import { rateLimit } from "@/lib/rate-limit";
import { SMS_ENABLED } from "@/lib/features";
import { revalidatePath } from "next/cache";
import { inArray, isNull, or as sqlOr, sql, ilike, desc, asc } from "drizzle-orm";
import { chat, extractHtml, llmConfigured } from "@/lib/llm";
import { sendHtmlMail, type SenderConfig } from "@/lib/email";
import {
  BUILTIN_KEYS,
  missingRequiredFields,
  previewValues,
  renderTemplate,
  toFieldKey,
} from "@/lib/mail-fields";
import { parseSubscribers, DEFAULT_SENDER_SUBSCRIBER_CAP } from "@/lib/mailing";
import { EMAIL_RE } from "@/lib/contact";

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
  sendPolicy: "threshold" | "weekly" | "monthly";
  threshold: number;
  weekday: number;
  monthDay: string;
  audience: "all" | "selected";
  templateId: string | null;
  subscriberIds: string[];
}) {
  const userId = await requireUserId();
  if (!input.name.trim()) return { ok: false, error: "Name can't be empty." };

  const values = {
    name: input.name.trim(),
    header: input.header,
    footer: input.footer,
    sendPolicy: input.sendPolicy,
    threshold: Math.max(1, input.threshold || 5),
    weekday: Math.min(6, Math.max(0, input.weekday || 0)),
    monthDay: input.monthDay || "first",
    audience: input.audience,
    templateId: input.templateId || null,
  };

  let listId = input.id;
  if (listId) {
    await db.update(mailingLists).set(values).where(and(eq(mailingLists.id, listId), eq(mailingLists.userId, userId)));
  } else {
    const [created] = await db.insert(mailingLists).values({ userId, ...values }).returning({ id: mailingLists.id });
    listId = created.id;
  }

  // Membership is only meaningful for a "selected" list, but keep the rows
  // either way so flipping back to "selected" doesn't lose the picks.
  await db.delete(mailingListSubscribers).where(eq(mailingListSubscribers.listId, listId));
  const ids = [...new Set(input.subscriberIds)].filter(Boolean);
  if (ids.length > 0) {
    const owned = await db
      .select({ id: subscriberTable.id })
      .from(subscriberTable)
      .where(and(eq(subscriberTable.userId, userId), inArray(subscriberTable.id, ids)));
    if (owned.length > 0) {
      await db.insert(mailingListSubscribers).values(
        owned.map((s) => ({ listId: listId as string, subscriberId: s.id })),
      );
    }
  }

  revalidatePath("/account");
  return { ok: true };
}

export async function deleteMailingList(input: { id: string }) {
  const userId = await requireUserId();
  await db.delete(mailingLists).where(and(eq(mailingLists.id, input.id), eq(mailingLists.userId, userId)));
  revalidatePath("/account");
}

/* ---- Subscribers (global to the account, shared by every list) ---- */

async function subscriberCount(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(subscriberTable)
    .where(eq(subscriberTable.userId, userId));
  return Number(row?.n ?? 0);
}

/** Bulk add. Pasting is the normal path, so this takes a raw block and
 * reports what it could and couldn't read rather than rejecting the lot. */
export async function addSubscribers(input: { raw: string }) {
  const userId = await requireUserId();
  const { valid, invalid } = parseSubscribers(input.raw);
  if (valid.length === 0) {
    return { ok: false, error: "No valid email addresses found in that." };
  }

  // Only the shared relay is capped. Checked before inserting rather than
  // after, so a paste either lands whole or not at all.
  const cfg = await loadSenderConfig(userId);
  if (cfg.provider === "default") {
    const existing = await subscriberCount(userId);
    const room = DEFAULT_SENDER_SUBSCRIBER_CAP - existing;
    if (room <= 0) {
      return {
        ok: false,
        error: `The built-in sender is limited to ${DEFAULT_SENDER_SUBSCRIBER_CAP} subscribers and you have ${existing}. Connect SendGrid or your own SMTP server in Sending Settings to go beyond that.`,
      };
    }
    if (valid.length > room) {
      return {
        ok: false,
        error: `That would put you over the ${DEFAULT_SENDER_SUBSCRIBER_CAP}-subscriber limit on the built-in sender — you have ${existing} and room for ${room} more. Connect SendGrid or your own SMTP server to lift the cap.`,
      };
    }
  }

  // onConflictDoNothing targets the (user_id, lower(email)) unique index, so
  // re-pasting an existing list is a no-op rather than a duplicate storm.
  const inserted = await db
    .insert(subscriberTable)
    .values(valid.map((v) => ({ userId, email: v.email, name: v.name })))
    .onConflictDoNothing()
    .returning({ id: subscriberTable.id });

  revalidatePath("/account");
  return {
    ok: true,
    added: inserted.length,
    skipped: valid.length - inserted.length,
    invalid: invalid.length,
  };
}

export async function updateSubscriber(input: {
  id: string;
  name: string;
  email: string;
  fields: Record<string, string>;
}) {
  const userId = await requireUserId();
  const email = input.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { ok: false, error: "That isn't a valid email address." };
  await db
    .update(subscriberTable)
    .set({ name: input.name.trim().slice(0, 120), email, fields: input.fields ?? {} })
    .where(and(eq(subscriberTable.id, input.id), eq(subscriberTable.userId, userId)));
  revalidatePath("/account");
  return { ok: true };
}

export async function setSubscriberStatus(input: { ids: string[]; status: "active" | "unsubscribed" }) {
  const userId = await requireUserId();
  if (input.ids.length === 0) return { ok: true };
  await db
    .update(subscriberTable)
    .set({ status: input.status })
    .where(and(eq(subscriberTable.userId, userId), inArray(subscriberTable.id, input.ids)));
  revalidatePath("/account");
  return { ok: true };
}

export async function deleteSubscribers(input: { ids: string[] }) {
  const userId = await requireUserId();
  if (input.ids.length === 0) return { ok: true };
  await db
    .delete(subscriberTable)
    .where(and(eq(subscriberTable.userId, userId), inArray(subscriberTable.id, input.ids)));
  revalidatePath("/account");
  return { ok: true };
}

/** The {{unsubscribe_url}} landing page's opt-out. No auth: the subscriber
 * id in the link is the token, and this only ever sets a status. */
export async function confirmUnsubscribe(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await db
    .update(subscriberTable)
    .set({ status: "unsubscribed" })
    .where(eq(subscriberTable.id, id));
  revalidatePath("/unsubscribe/" + id);
}

/* ---- Templates ---- */

const MAX_TEMPLATE_BYTES = 400_000;

export async function saveTemplate(input: { id?: string; name: string; html: string }) {
  const userId = await requireUserId();
  if (!input.name.trim()) return { ok: false, error: "Give the template a name." };
  if (!input.html.trim()) return { ok: false, error: "The template is empty." };
  if (input.html.length > MAX_TEMPLATE_BYTES) {
    return { ok: false, error: "That template is too large. Link to images instead of embedding them." };
  }
  const missing = missingRequiredFields(input.html);
  if (missing.length > 0) {
    const list = missing.map((f) => `{{${f.key}}} (${f.why})`).join(" and ");
    return { ok: false, error: `The template is missing ${list}.` };
  }

  if (input.id) {
    // The built-in default has user_id NULL, so this ownership check is also
    // what stops anyone editing it.
    await db
      .update(emailTemplates)
      .set({ name: input.name.trim(), html: input.html, updatedAt: new Date() })
      .where(and(eq(emailTemplates.id, input.id), eq(emailTemplates.userId, userId)));
  } else {
    await db.insert(emailTemplates).values({ userId, name: input.name.trim(), html: input.html });
  }
  revalidatePath("/account");
  return { ok: true };
}

export async function deleteTemplate(input: { id: string }) {
  const userId = await requireUserId();
  await db.delete(emailTemplates).where(and(eq(emailTemplates.id, input.id), eq(emailTemplates.userId, userId)));
  revalidatePath("/account");
  return { ok: true };
}

const TEMPLATE_SYSTEM = [
  "You write HTML email templates for agenda.delivery, a service that emails",
  "plain-language summaries of municipal council agendas.",
  "",
  "Rules:",
  "- Output ONE complete HTML document and nothing else. No commentary, no code fences.",
  "- Email clients are not browsers: use tables for layout and inline style attributes",
  "  only. No <style> blocks, no external CSS, no flexbox, no grid, no JavaScript.",
  "- Keep the body under 600px wide and centred.",
  "- Use these placeholders literally, braces included. {{content}} is mandatory:",
  "  {{logo_url}} {{organization_name}} {{list_name}} {{subject}} {{header}}",
  "  {{content}} {{footer}} {{date}} {{subscriber_name}} {{subscriber_email}}",
  "  {{unsubscribe_url}}",
  "- The footer must contain a working unsubscribe link to {{unsubscribe_url}}.",
  "- If a logo URL is provided, set the img alt to {{organization_name}} so the",
  "  layout still reads well when images are blocked.",
].join("\n");

/** Generate a template from a logo, some background, and a prompt. */
export async function generateTemplate(input: {
  logoUrl: string;
  info: string;
  prompt: string;
}) {
  await requireUserId();
  if (!llmConfigured()) {
    return { ok: false, error: "The model isn't configured on this server (OLLAMA_BASE_URL is unset)." };
  }
  if (!input.prompt.trim() && !input.info.trim()) {
    return { ok: false, error: "Describe the template you want." };
  }

  const user = [
    input.logoUrl.trim()
      ? "Logo image URL (use it verbatim as the header image src): " + input.logoUrl.trim()
      : "No logo supplied - use {{organization_name}} as a text wordmark in the header.",
    input.info.trim() ? "About the organization:\n" + input.info.trim() : "",
    input.prompt.trim() ? "What they want:\n" + input.prompt.trim() : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const html = extractHtml(await chat(TEMPLATE_SYSTEM, user, { temperature: 0.6 }));
    const absent = missingRequiredFields(html);
    if (absent.length > 0) {
      const list = absent.map((f) => `{{${f.key}}}`).join(" and ");
      return { ok: false, error: `The model left out ${list}. Try generating again.` };
    }
    return { ok: true, html };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Generation failed." };
  }
}

/* ---- Sending settings ---- */

async function loadSenderConfig(userId: string): Promise<SenderConfig> {
  const [row] = await db.select().from(senderSettings).where(eq(senderSettings.userId, userId)).limit(1);
  return {
    provider: row?.provider ?? "default",
    fromEmail: row?.fromEmail ?? "",
    fromName: row?.fromName ?? "",
    sendgridKey: row?.sendgridKey ?? null,
    smtpHost: row?.smtpHost ?? null,
    smtpPort: row?.smtpPort ?? 587,
    smtpUser: row?.smtpUser ?? null,
    smtpPass: row?.smtpPass ?? null,
    smtpSecure: row?.smtpSecure ?? true,
  };
}

export async function saveSenderSettings(input: {
  provider: "default" | "sendgrid" | "smtp";
  fromEmail: string;
  fromName: string;
  sendgridKey: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  smtpSecure: boolean;
}) {
  const userId = await requireUserId();
  const fromEmail = input.fromEmail.trim().toLowerCase();

  // Guard the other direction too: switching back to the shared relay with a
  // list already larger than the cap would put it over without an add.
  if (input.provider === "default") {
    const existing = await subscriberCount(userId);
    if (existing > DEFAULT_SENDER_SUBSCRIBER_CAP) {
      return {
        ok: false,
        error: `You have ${existing} subscribers, over the ${DEFAULT_SENDER_SUBSCRIBER_CAP} the built-in sender allows. Remove some, or keep sending through your own provider.`,
      };
    }
  }

  if (input.provider !== "default") {
    if (!EMAIL_RE.test(fromEmail)) {
      return { ok: false, error: "Set a valid 'from' address for this provider." };
    }
    if (input.provider === "sendgrid" && !input.sendgridKey.trim()) {
      const [existing] = await db
        .select({ key: senderSettings.sendgridKey })
        .from(senderSettings)
        .where(eq(senderSettings.userId, userId))
        .limit(1);
      if (!existing?.key) return { ok: false, error: "SendGrid needs an API key." };
    }
    if (input.provider === "smtp" && !input.smtpHost.trim()) {
      return { ok: false, error: "SMTP needs a host." };
    }
  }

  const existing = await loadSenderConfig(userId);
  const values = {
    provider: input.provider,
    fromEmail,
    fromName: input.fromName.trim().slice(0, 120),
    // A blank secret means "leave it alone" - the UI never renders the stored
    // value back, so an empty box is absence of an edit, not a deletion.
    sendgridKey: input.sendgridKey.trim() || existing.sendgridKey,
    smtpHost: input.smtpHost.trim() || null,
    smtpPort: Math.min(65535, Math.max(1, input.smtpPort || 587)),
    smtpUser: input.smtpUser.trim() || null,
    smtpPass: input.smtpPass.trim() || existing.smtpPass,
    smtpSecure: input.smtpSecure,
    updatedAt: new Date(),
  };

  await db
    .insert(senderSettings)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: senderSettings.userId, set: values });

  revalidatePath("/account");
  return { ok: true };
}

/** Send the chosen template to one address, filled with sample values. */
export async function sendTestEmail(input: { to: string; templateId: string | null }) {
  const userId = await requireUserId();
  const to = input.to.trim().toLowerCase();
  if (!EMAIL_RE.test(to)) return { ok: false, error: "That isn't a valid email address." };
  if (!rateLimit("test-mail:" + userId, 5, 10 * 60 * 1000).allowed) {
    return { ok: false, error: "Too many test emails. Try again in a few minutes." };
  }

  const [tpl] = input.templateId
    ? await db
        .select({ html: emailTemplates.html })
        .from(emailTemplates)
        .where(
          and(
            eq(emailTemplates.id, input.templateId),
            sqlOr(eq(emailTemplates.userId, userId), isNull(emailTemplates.userId))!,
          ),
        )
        .limit(1)
    : await db
        .select({ html: emailTemplates.html })
        .from(emailTemplates)
        .where(isNull(emailTemplates.userId))
        .limit(1);
  if (!tpl) return { ok: false, error: "Couldn't find that template." };

  const fieldRows = await db
    .select({ key: mergeFields.key, value: mergeFields.value })
    .from(mergeFields)
    .where(eq(mergeFields.userId, userId));
  const owned = Object.fromEntries(fieldRows.map((f) => [f.key, f.value]));

  const cfg = await loadSenderConfig(userId);
  const html = renderTemplate(tpl.html, previewValues({ ...owned, subscriber_email: to }));
  const res = await sendHtmlMail(cfg, to, "agenda.delivery test email", html);
  return res.ok ? { ok: true } : { ok: false, error: res.error ?? "Sending failed." };
}

/* ---- Merge fields ---- */

/** Replace the account's field values in one go. Built-in keys keep their
 * canonical label; custom keys are derived from the label the user typed. */
export async function saveMergeFields(input: {
  fields: { key?: string; label: string; value: string }[];
}) {
  const userId = await requireUserId();

  const rows: { key: string; label: string; value: string }[] = [];
  const seen = new Set<string>();
  for (const f of input.fields) {
    const key = f.key || toFieldKey(f.label);
    if (!key || seen.has(key)) continue;
    if (!BUILTIN_KEYS.has(key) && !f.label.trim()) continue;
    seen.add(key);
    rows.push({ key, label: f.label.trim() || key, value: f.value ?? "" });
  }

  await db.delete(mergeFields).where(eq(mergeFields.userId, userId));
  if (rows.length > 0) {
    await db.insert(mergeFields).values(rows.map((r) => ({ userId, ...r })));
  }
  revalidatePath("/account");
  return { ok: true };
}

/* ---- Account profile ---- */

export async function updateAccountName(input: { name: string }) {
  const userId = await requireUserId();
  const name = input.name.trim().slice(0, 120);
  if (!name) return { ok: false, error: "Name can't be empty." };
  await db.update(users).set({ name }).where(eq(users.id, userId));
  revalidatePath("/account");
  return { ok: true };
}

/** Changing the sign-in address needs the new address proved, same as
 * signing up does - so it's the OTP flow, not a bare UPDATE. */
export async function requestEmailChange(input: { email: string }) {
  const userId = await requireUserId();
  const email = input.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { ok: false, error: "That isn't a valid email address." };

  const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (taken && taken.id !== userId) return { ok: false, error: "That address is already in use." };
  if (!rateLimit("email-change:" + userId, 3, 10 * 60 * 1000).allowed) {
    return { ok: false, error: "Too many codes requested. Try again in a few minutes." };
  }

  try {
    await requestOtp("email", email);
    return { ok: true };
  } catch (err) {
    console.error("[requestEmailChange] failed:", err);
    return { ok: false, error: "Couldn't send a code just now. Try again." };
  }
}

export async function confirmEmailChange(input: { email: string; code: string }) {
  const userId = await requireUserId();
  const email = input.email.trim().toLowerCase();
  if (!rateLimit("email-change-verify:" + userId, 8, 10 * 60 * 1000).allowed) {
    return { ok: false, error: "Too many attempts. Try again in a few minutes." };
  }
  if (!(await verifyOtp(email, input.code))) {
    return { ok: false, error: "That code is incorrect or expired." };
  }
  await db.update(users).set({ email, emailVerified: new Date() }).where(eq(users.id, userId));
  revalidatePath("/account");
  return { ok: true };
}

/* ---- Subscriptions, managed from the account screen ---- */

/**
 * Search the agenda catalogue for the "Add subscription" dialog. An empty
 * query returns the most-followed sources, so the dialog has something useful
 * in it before anyone types.
 */
export async function searchModules(input: { query: string }) {
  const userId = await requireUserId();
  const q = input.query.trim();

  const rows = await db
    .select({
      slug: modules.slug,
      name: modules.name,
      region: modules.region,
      followers: modules.followers,
      health: modules.health,
    })
    .from(modules)
    .where(
      q
        ? and(
            eq(modules.isDemo, false),
            sqlOr(ilike(modules.name, `%${q}%`), ilike(modules.region, `%${q}%`))!,
          )
        : eq(modules.isDemo, false),
    )
    .orderBy(desc(modules.followers), asc(modules.name))
    .limit(25);

  // Mark what they already follow so the dialog can show it instead of
  // offering a subscribe that would be a no-op.
  const mine = await db
    .select({ slug: modules.slug })
    .from(subscriptions)
    .innerJoin(modules, eq(subscriptions.moduleId, modules.id))
    .where(eq(subscriptions.userId, userId));
  const following = new Set(mine.map((m) => m.slug));

  return {
    ok: true,
    results: rows.map((r) => ({ ...r, subscribed: following.has(r.slug) })),
  };
}

/** Follow a source from the account screen. Deliberately does NOT create an
 * action: the point of the flowchart is that you choose what happens next. */
export async function addSubscription(input: { slug: string }) {
  const userId = await requireUserId();

  // Read the contact from the row rather than the session: an account created
  // by phone OTP has no email on the session object at all.
  const [me] = await db
    .select({ email: users.email, phone: users.phone })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const contact = me?.email ?? me?.phone ?? null;
  if (!contact) return { ok: false, error: "Your account has no email address." };

  const [m] = await db.select({ id: modules.id }).from(modules).where(eq(modules.slug, input.slug)).limit(1);
  if (!m) return { ok: false, error: "That source no longer exists." };

  const [existing] = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(and(eq(subscriptions.moduleId, m.id), eq(subscriptions.userId, userId)))
    .limit(1);
  if (!existing) {
    await db.insert(subscriptions).values({
      moduleId: m.id,
      channel: me?.email ? "email" : "text",
      contact,
      userId,
    });
  }

  revalidatePath("/account");
  return { ok: true };
}

/** Stop following a source. Its actions go too — a rule with no subscription
 * behind it would never fire again, and leaving it would be a puzzle. */
export async function removeSubscription(input: { slug: string }) {
  const userId = await requireUserId();
  const [m] = await db.select({ id: modules.id }).from(modules).where(eq(modules.slug, input.slug)).limit(1);
  if (!m) return { ok: false, error: "That source no longer exists." };

  await db.delete(automationRules).where(and(eq(automationRules.userId, userId), eq(automationRules.moduleId, m.id)));
  await db.delete(subscriptions).where(and(eq(subscriptions.userId, userId), eq(subscriptions.moduleId, m.id)));

  revalidatePath("/account");
  return { ok: true };
}
