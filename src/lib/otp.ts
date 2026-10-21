import crypto from "crypto";
import { eq, and, gt } from "drizzle-orm";
import { db } from "@/db";
import { verificationTokens } from "@/db/schema";
import { sendMail } from "@/lib/email";
import { SMS_ENABLED } from "@/lib/features";

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

  if (channel === "text") {
    // ponytail: no SMS sender wired yet. Enable via SMS_ENABLED + a Twilio
    // call here once a sender exists; until then the UI never offers "text".
    if (!SMS_ENABLED) throw new Error("SMS is not enabled");
    throw new Error("SMS sending is not implemented");
  }

  await sendMail(
    contact,
    "Your agenda.delivery code",
    `Your agenda.delivery verification code is ${code}\n\nIt expires in 10 minutes. If you didn't request it, ignore this email.`,
    codeEmailHtml(code),
  );
}

/** The code email in the same look as the agenda notifications. */
function codeEmailHtml(code: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f1e8;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1e8;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
<tr><td style="padding:0 4px 14px 4px;font-family:Georgia,'Times New Roman',serif;font-size:22px;">
<span style="color:#3d5e2b;">agenda</span><span style="color:#4f8a2f;">.delivery</span>
</td></tr>
<tr><td style="background:#ffffff;border:1px solid #e4e0d2;border-radius:14px;padding:28px;font-family:Georgia,'Times New Roman',serif;color:#1c1b16;font-size:16px;line-height:1.6;">
<p style="margin:0 0 14px 0;">Your verification code is</p>
<div style="margin:0 0 18px 0;font:bold 34px/1 'Courier New',Courier,monospace;letter-spacing:8px;color:#1c1b16;">${code}</div>
<p style="margin:0;font:14px/1.5 Arial,sans-serif;color:#6f6c60;">It expires in 10 minutes. If you didn't ask for it, you can ignore this email.</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
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
