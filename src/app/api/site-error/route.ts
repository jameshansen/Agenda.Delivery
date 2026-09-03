import { NextResponse } from "next/server";
import { recordSiteError } from "@/lib/site-error";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * POST /api/site-error — the client error boundary reporting in.
 *
 * Open by design (an unauthenticated visitor hitting a 500 is exactly the
 * case worth knowing about), so it's rate limited per IP and every field is
 * length-capped before it reaches the table the Escalation Agent reads.
 */
export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!rateLimit(`site-error:${ip}`, 20, 60_000).allowed) {
    return NextResponse.json({ ok: false }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return NextResponse.json({ ok: false }, { status: 400 });

  await recordSiteError({
    source: "ui",
    level: "error",
    message,
    detail: typeof body.stack === "string" ? body.stack : null,
    path: typeof body.path === "string" ? body.path : null,
    digest: typeof body.digest === "string" ? body.digest : null,
  });

  return NextResponse.json({ ok: true });
}
