/**
 * GET /api/agents/history — paginated OLDER agent events for infinite
 * scroll on the /agents Combined Log. The SSE stream (/api/agents/events)
 * only replays the most recent 50 events + live ones; this endpoint fills
 * in further back as the user scrolls down.
 *
 * Query params:
 *   before  — ISO timestamp cursor; only events strictly older than this
 *   limit   — page size, default 30, capped at 100
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { agentEvents } from "@/db/schema";
import { lt, desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const before = request.nextUrl.searchParams.get("before");
  const limit = Math.min(100, Math.max(1, Number(request.nextUrl.searchParams.get("limit")) || 30));

  const q = db.select().from(agentEvents);
  const rows = await (before ? q.where(lt(agentEvents.createdAt, new Date(before))) : q)
    .orderBy(desc(agentEvents.createdAt), desc(agentEvents.sort))
    .limit(limit);

  return NextResponse.json({
    events: rows.map((e) => ({
      runId: e.runId ?? "replay",
      moduleId: e.moduleId,
      agent: e.agent,
      action: e.action,
      tool: e.tool ?? undefined,
      detail: e.detail ?? undefined,
      screenshot: e.screenshot ?? undefined,
      prompt: e.prompt ?? undefined,
      response: e.response ?? undefined,
      model: e.model ?? undefined,
      createdAt: e.createdAt.toISOString(),
      replayed: true,
    })),
    hasMore: rows.length === limit,
  });
}
