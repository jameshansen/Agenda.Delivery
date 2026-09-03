// Server-only. Writes into `site_error`, which the Escalation Agent sweeps
// on its schedule and mails to the admin. Deliberately swallow-everything:
// failing to record an error must never turn into a second error.
import { db } from "@/db";
import { siteErrors } from "@/db/schema";

export type SiteErrorInput = {
  message: string;
  detail?: string | null;
  path?: string | null;
  digest?: string | null;
  source?: "ui" | "server" | "api";
  level?: "warn" | "error";
};

export async function recordSiteError(input: SiteErrorInput): Promise<void> {
  try {
    await db.insert(siteErrors).values({
      source: input.source ?? "server",
      level: input.level ?? "error",
      message: input.message.slice(0, 2000),
      detail: input.detail?.slice(0, 8000) ?? null,
      path: input.path?.slice(0, 500) ?? null,
      digest: input.digest?.slice(0, 100) ?? null,
    });
  } catch (err) {
    console.error("[site-error] could not record:", err);
  }
}
