// Server-only: sends mail through the host's Postfix relay (which DKIM-signs
// and delivers). No auth -- the container reaches Postfix over the trusted
// Docker bridge, which is in Postfix's mynetworks. Never import from a
// "use client" file.
import nodemailer from "nodemailer";

const FROM = process.env.MAIL_FROM ?? "agenda.delivery <update@agenda.delivery>";

// ponytail: one shared transport; nodemailer pools nothing by default, fine
// for our low volume. Bump `pool: true` if OTP/alert volume ever spikes.
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
