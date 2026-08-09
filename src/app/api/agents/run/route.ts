/**
 * POST /api/agents/run — queue an agent run via the orchestrator.
 *
 * Body: { agent: "checking"|"scraper_create"|"scraper_repair"|"summary"|
 *         "keyword"|"spider"|"categorization"|"full_pipeline",
 *         slug?: string, agendaText?: string, trigger?: string }
 *
 * The UI never runs agents itself. This forwards to the orchestrator's
 * /trigger endpoint (Redis-backed queue) and returns immediately. Live
 * events stream via /api/agents/events?moduleId=...
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { modules } from "@/db/schema";
import { eq } from "drizzle-orm";
import { rateLimit, getRateLimitKey } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL ?? "http://orchestrator:8000";

/** Map a UI "agent" value to an orchestrator flow job. */
function toJob(agent: string, slug: string | undefined, agendaText: string | undefined,
              trigger: string): Record<string, unknown> | null {
  if (agent === "full_pipeline") return { flow: "pipeline", slug, trigger };
  if (agent === "spider") return { flow: "spider", trigger };
  const singles = ["checking", "scraper_create", "scraper_repair", "summary",
                   "keyword", "categorization"];
  if (singles.includes(agent)) {
    return { flow: "agent", agent, slug, trigger, inputs: { agenda_text: agendaText ?? "" } };
  }
  return null;
}

export async function POST(request: NextRequest) {
  let body: { agent?: string; slug?: string; agendaText?: string; trigger?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { agent, slug, agendaText } = body;
  if (!agent) return NextResponse.json({ error: "Missing 'agent' field" }, { status: 400 });

  // Rate limit: 10 runs per minute per IP.
  const rl = rateLimit(getRateLimitKey(request), 10, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Try again in a minute.",
        resetAt: new Date(rl.resetAt).toISOString() },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } },
    );
  }

  const job = toJob(agent, slug, agendaText, body.trigger ?? "manual");
  if (!job) return NextResponse.json({ error: `Unknown agent: ${agent}` }, { status: 400 });

  // Resolve moduleId so the client can open the SSE stream by module.
  let moduleId: string | undefined;
  if (slug) {
    const [m] = await db.select({ id: modules.id }).from(modules)
      .where(eq(modules.slug, slug)).limit(1);
    if (!m) return NextResponse.json({ error: `Module '${slug}' not found` }, { status: 404 });
    moduleId = m.id;
  } else if (job.flow === "agent") {
    return NextResponse.json({ error: "Missing 'slug'" }, { status: 400 });
  }

  try {
    const res = await fetch(`${ORCHESTRATOR_URL}/trigger`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(job),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json({ error: `Orchestrator error: ${text.slice(0, 200)}` },
                              { status: 502 });
    }
    return NextResponse.json({ runId: "queued", moduleId, status: "started" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Could not reach orchestrator: ${msg}` }, { status: 502 });
  }
}
