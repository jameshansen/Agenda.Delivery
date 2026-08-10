export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Accepts +1 604-555-0134, (604) 555-0134, etc.
export const PHONE_RE = /^\+?[\d\s()\-]{7,16}$/;

export function isValidContact(channel: "email" | "text", contact: string): boolean {
  return channel === "email" ? EMAIL_RE.test(contact) : PHONE_RE.test(contact);
}
