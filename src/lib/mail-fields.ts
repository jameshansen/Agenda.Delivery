/**
 * Template placeholders. `{{key}}` in an email template is replaced at send
 * time; these are the keys the app itself knows about.
 *
 * Two kinds:
 *   - `owned` fields hold a value the account sets once (Sending Settings).
 *     Custom fields a user adds are always of this kind.
 *   - `auto` fields are filled per send and can't be edited.
 *
 * Keep in sync with BUILTIN_FIELD_KEYS in agents/base/agenda_shared/mailer.py.
 */

export type MergeFieldDef = {
  key: string;
  label: string;
  hint: string;
  kind: "owned" | "auto";
};

export const BUILTIN_FIELDS: MergeFieldDef[] = [
  { key: "organization_name", label: "Organization Name", hint: "Your group's name, shown in the header", kind: "owned" },
  { key: "logo_url", label: "Logo URL", hint: "Hosted image URL for the header logo", kind: "owned" },
  { key: "reply_to", label: "Reply-to Address", hint: "Where replies should go, if you print it in the footer", kind: "owned" },
  { key: "website_url", label: "Website URL", hint: "Your group's homepage", kind: "owned" },
  { key: "list_name", label: "List Name", hint: "The mailing list being sent", kind: "auto" },
  { key: "subject", label: "Subject", hint: "The subject line of this send", kind: "auto" },
  { key: "header", label: "Header", hint: "The list's header text", kind: "auto" },
  { key: "content", label: "Content", hint: "The queued updates — every template needs this", kind: "auto" },
  { key: "footer", label: "Footer", hint: "The list's footer text", kind: "auto" },
  { key: "date", label: "Date", hint: "The send date", kind: "auto" },
  { key: "subscriber_name", label: "Subscriber Name", hint: "The recipient's name", kind: "auto" },
  { key: "subscriber_email", label: "Subscriber Email", hint: "The recipient's address", kind: "auto" },
  { key: "unsubscribe_url", label: "Unsubscribe URL", hint: "One-click unsubscribe link", kind: "auto" },
];

export const BUILTIN_KEYS = new Set(BUILTIN_FIELDS.map((f) => f.key));

/** Normalize a user-typed field name into a placeholder key. */
export function toFieldKey(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

/** Substitute {{key}} placeholders. Unknown keys collapse to empty, so a
 * half-filled template shows a gap rather than literal braces. */
export function renderTemplate(html: string, values: Record<string, string>): string {
  return html.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key: string) => values[key] ?? "");
}

/** Sample values for the template preview and test sends. */
export function previewValues(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    organization_name: "Your Organization",
    logo_url: "",
    list_name: "Weekly Digest",
    subject: "Weekly Digest: 3 updates",
    header: "Here is what your councils were up to this week.",
    content:
      '<div style="margin:0 0 20px 0;"><div style="font-weight:bold;margin-bottom:4px;">' +
      "City of Langley: Regular Council Meeting</div><div>Council approved the capital " +
      "budget and gave first reading to a downtown rezoning.</div></div>",
    footer: "You are receiving this because you subscribed.",
    date: new Date().toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" }),
    subscriber_name: "Sam Rivers",
    subscriber_email: "sam@example.com",
    unsubscribe_url: "#",
    ...overrides,
  };
}
