"use server";

import { eq, and } from "drizzle-orm";
import { auth, signIn, signOut } from "@/auth";
import { db } from "@/db";
import { modules, subscriptions, users } from "@/db/schema";
import { isValidContact } from "@/lib/contact";
import { requestOtp, verifyOtp } from "@/lib/otp";
import { createSession } from "@/lib/session";
import { rateLimit } from "@/lib/rate-limit";

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
