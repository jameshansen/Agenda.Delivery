// Server-only: reads SUPRSEND_API_KEY. Never import from a "use client" file.
const API_BASE = "https://hub.suprsend.com";

function apiKey(): string {
  const key = process.env.SUPRSEND_API_KEY;
  if (!key) throw new Error("SUPRSEND_API_KEY is not set");
  return key;
}

/** Upsert a SuprSend user profile's contact channels (create-if-missing). */
async function upsertUser(distinctId: string, channels: { email?: string; sms?: string }) {
  const body: Record<string, string[]> = {};
  if (channels.email) body.$email = [channels.email];
  if (channels.sms) body.$sms = [channels.sms];
  const res = await fetch(`${API_BASE}/v1/user/${encodeURIComponent(distinctId)}/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`SuprSend user upsert failed: ${res.status} ${await res.text()}`);
}

/** Trigger a SuprSend event/workflow for a user. */
async function triggerEvent(distinctId: string, event: string, properties: Record<string, unknown>) {
  const res = await fetch(`${API_BASE}/event/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ distinct_id: distinctId, event, properties }),
  });
  if (!res.ok) throw new Error(`SuprSend event trigger failed: ${res.status} ${await res.text()}`);
}

/**
 * Send a one-time code to an email or phone number.
 *
 * Delivery depends on an "otp_requested" workflow existing in the SuprSend
 * dashboard (Workflows > Create) with a template that references
 * `{{code}}` and routes to the Email or SMS channel — the API alone can
 * trigger the event, it can't create that dashboard-side template.
 */
export async function sendOtp(channel: "email" | "text", contact: string, code: string): Promise<void> {
  const distinctId = `otp:${contact}`;
  await upsertUser(distinctId, channel === "email" ? { email: contact } : { sms: contact });
  await triggerEvent(distinctId, "otp_requested", { code, channel });
}
