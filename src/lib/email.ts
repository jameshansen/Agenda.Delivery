// Server-only: sends mail through the host's Postfix relay (which DKIM-signs
// and delivers), or through an account's own SendGrid / SMTP credentials.
// Never import from a "use client" file.
import nodemailer from "nodemailer";

const FROM = process.env.MAIL_FROM ?? "agenda.delivery <update@agenda.delivery>";

// One shared transport for the platform relay; nodemailer pools nothing by
// default, fine for our low volume. Bump `pool: true` if OTP/alert volume
// ever spikes.
const transport = nodemailer.createTransport({
  host: process.env.SMTP_HOST ?? "mailhost",
  port: Number(process.env.SMTP_PORT ?? 25),
  secure: false,
  // Local hop to Postfix: don't require/verify STARTTLS on the internal relay.
  ignoreTLS: true,
});

export async function sendMail(to: string, subject: string, text: string): Promise<void> {
  await transport.sendMail({ from: FROM, to, subject, text });
}

/** An account's sending configuration (sender_settings row shape). */
export type SenderConfig = {
  provider: string;
  fromEmail: string;
  fromName: string;
  sendgridKey: string | null;
  smtpHost: string | null;
  smtpPort: number;
  smtpUser: string | null;
  smtpPass: string | null;
  smtpSecure: boolean;
};

/** The From: header a config sends as. "default" is locked to the platform
 * address — our Postfix will only DKIM-sign our own domain. */
export function fromHeader(cfg: SenderConfig): string {
  if (cfg.provider === "default" || !cfg.fromEmail) return FROM;
  const name = cfg.fromName?.trim();
  return name ? `${name} <${cfg.fromEmail.trim()}>` : cfg.fromEmail.trim();
}

/** Crude HTML → text for the plain-text alternative part. */
export function toPlainText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/tr>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Send one HTML message with whichever provider the account selected.
 * Returns an error string instead of throwing — every caller is a server
 * action reporting back to a form.
 */
export async function sendHtmlMail(
  cfg: SenderConfig,
  to: string,
  subject: string,
  html: string,
): Promise<{ ok: boolean; error?: string }> {
  const text = toPlainText(html);
  try {
    if (cfg.provider === "sendgrid") {
      if (!cfg.sendgridKey) return { ok: false, error: "No SendGrid API key saved." };
      const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cfg.sendgridKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: to }] }],
          from: cfg.fromName
            ? { email: cfg.fromEmail, name: cfg.fromName }
            : { email: cfg.fromEmail },
          subject,
          content: [
            { type: "text/plain", value: text },
            { type: "text/html", value: html },
          ],
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) {
        return { ok: false, error: `SendGrid returned ${res.status}: ${(await res.text()).slice(0, 200)}` };
      }
      return { ok: true };
    }

    if (cfg.provider === "smtp") {
      if (!cfg.smtpHost) return { ok: false, error: "No SMTP host saved." };
      const port = cfg.smtpPort || 587;
      const custom = nodemailer.createTransport({
        host: cfg.smtpHost,
        port,
        // 465 is implicit TLS; everything else negotiates STARTTLS when asked.
        secure: port === 465,
        requireTLS: port !== 465 && cfg.smtpSecure,
        auth: cfg.smtpUser ? { user: cfg.smtpUser, pass: cfg.smtpPass ?? "" } : undefined,
        connectionTimeout: 20_000,
      });
      await custom.sendMail({ from: fromHeader(cfg), to, subject, text, html });
      return { ok: true };
    }

    await transport.sendMail({ from: fromHeader(cfg), to, subject, text, html });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
