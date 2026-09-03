// Shared, non-"use server" helpers for the mailing-list actions. Server
// action files may only export async functions, so the plain helpers live here.
import { EMAIL_RE } from "@/lib/contact";

export type ParsedSubscriber = { email: string; name: string };

/**
 * Parse a pasted block of subscribers. Accepts one per line or comma
 * separated, in any of:
 *   sam@example.com
 *   Sam Rivers <sam@example.com>
 *   sam@example.com, Sam Rivers        (CSV: email first, then name)
 *   Sam Rivers, sam@example.com        (CSV: name first)
 * Invalid rows are returned separately rather than silently dropped.
 */
export function parseSubscribers(raw: string): {
  valid: ParsedSubscriber[];
  invalid: string[];
} {
  const valid: ParsedSubscriber[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();

  // Split on newlines first; only fall back to commas for single-line pastes
  // so "Sam Rivers, sam@example.com" survives as one row.
  const lines = raw.split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed) return [];
    // A line with several addresses is a comma-separated address list.
    return (trimmed.match(/@/g) ?? []).length > 1 ? trimmed.split(/[,;]+/) : [trimmed];
  });

  for (const line of lines) {
    const row = line.trim().replace(/^["']|["']$/g, "");
    if (!row) continue;

    const angled = row.match(/^(.*?)<([^>]+)>$/);
    let email: string;
    let name: string;
    if (angled) {
      name = angled[1].trim().replace(/^["']|["']$/g, "");
      email = angled[2].trim();
    } else {
      const parts = row.split(/[,;\t]+/).map((p) => p.trim()).filter(Boolean);
      const emailPart = parts.find((p) => EMAIL_RE.test(p));
      if (!emailPart) {
        invalid.push(row);
        continue;
      }
      email = emailPart;
      name = parts.filter((p) => p !== emailPart).join(" ").trim();
    }

    email = email.toLowerCase();
    if (!EMAIL_RE.test(email)) {
      invalid.push(row);
      continue;
    }
    if (seen.has(email)) continue;
    seen.add(email);
    valid.push({ email, name: name.slice(0, 120) });
  }

  return { valid, invalid };
}

export const WEEKDAYS = [
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
];

/** Month-day options: first, last, then the 2nd through the 28th. */
export const MONTH_DAYS: { value: string; label: string }[] = [
  { value: "first", label: "the first day" },
  { value: "last", label: "the last day" },
  ...Array.from({ length: 27 }, (_, i) => {
    const d = i + 2;
    const suffix = d === 2 ? "nd" : d === 3 ? "rd" : d >= 21 && d % 10 === 1 ? "st" : d >= 22 && d % 10 === 2 ? "nd" : d >= 23 && d % 10 === 3 ? "rd" : "th";
    return { value: String(d), label: `the ${d}${suffix}` };
  }),
];

/** Human-readable cadence for a list card. */
export function describeSchedule(l: {
  sendPolicy: string;
  threshold: number;
  weekday: number;
  monthDay: string;
}): string {
  if (l.sendPolicy === "weekly") return `weekly on ${WEEKDAYS[l.weekday] ?? WEEKDAYS[0]}`;
  if (l.sendPolicy === "monthly") {
    return `monthly on ${MONTH_DAYS.find((m) => m.value === l.monthDay)?.label ?? "the first day"}`;
  }
  return `when ${l.threshold} updates are queued`;
}
