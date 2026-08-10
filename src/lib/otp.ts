import crypto from "crypto";
import { eq, and, gt } from "drizzle-orm";
import { db } from "@/db";
import { verificationTokens } from "@/db/schema";
import { sendOtp } from "@/lib/suprsend";

const CODE_TTL_MS = 10 * 60 * 1000;
const IDENTIFIER_PREFIX = "otp:";

function hash(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

/**
 * Generate, store (hashed), and send a 6-digit OTP to an email or phone.
 * Reuses Auth.js's verification_token table (identifier/token/expires is
 * exactly the shape OTP needs) rather than adding a new one.
 */
export async function requestOtp(channel: "email" | "text", contact: string): Promise<void> {
  const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
  const identifier = IDENTIFIER_PREFIX + contact;

  // One outstanding code per contact — clear any previous one first.
  await db.delete(verificationTokens).where(eq(verificationTokens.identifier, identifier));
  await db.insert(verificationTokens).values({
    identifier,
    token: hash(code),
    expires: new Date(Date.now() + CODE_TTL_MS),
  });

  await sendOtp(channel, contact, code);
}

/** Verify a submitted code. Single-use: deletes the token on any match attempt past expiry or success. */
export async function verifyOtp(contact: string, code: string): Promise<boolean> {
  const identifier = IDENTIFIER_PREFIX + contact;
  const [row] = await db
    .select()
    .from(verificationTokens)
    .where(and(eq(verificationTokens.identifier, identifier), gt(verificationTokens.expires, new Date())));

  if (!row || row.token !== hash(code)) return false;

  await db
    .delete(verificationTokens)
    .where(and(eq(verificationTokens.identifier, identifier), eq(verificationTokens.token, row.token)));
  return true;
}
