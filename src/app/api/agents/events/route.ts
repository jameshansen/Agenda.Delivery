/**
 * GET /api/agents/events — SSE stream of agent events.
 *
 * Query params:
 *   ?moduleId=...  — stream all live + replayed events for a module
 *   ?runId=...     — stream events for a specific run only
 *
 * Behaviour: first replays historical events from Postgres (so the client
 * sees context on load), then proxies the orchestrator's live SSE relay
 * (which tails the Redis event bus). The UI stays a pure reader — it never
 * talks to agents directly.
 */

import { NextRequest } from "next/server";
import { db } from "@/db";
import { agentEvents } from "@/db/schema";
import { eq, asc, desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL ?? "http://orchestrator:8000";

export async function GET(request: NextRequest) {
  const runId = request.nextUrl.searchParams.get("runId");
  const moduleId = request.nextUrl.searchParams.get("moduleId");
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (data: Record<string, unknown>) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      // ── Replay existing events from Postgres ─────────────
      // Order by createdAt, NOT `sort` -- `sort` is
      // `time.time()*1000 % 1_000_000` (wraps every ~16.7 minutes), so
      // ordering by it alone across more than one run/timespan produces an
      // effectively arbitrary order. createdAt is monotonic; `sort` is only
      // a same-instant tie-breaker.
      try {
        const q = db.select().from(agentEvents);
        const rows = moduleId
          ? await q.where(eq(agentEvents.moduleId, moduleId))
              .orderBy(asc(agentEvents.createdAt), asc(agentEvents.sort))
          : runId
            ? await q.where(eq(agentEvents.runId, runId))
                .orderBy(asc(agentEvents.createdAt), asc(agentEvents.sort))
            : (
                await q.orderBy(desc(agentEvents.createdAt), desc(agentEvents.sort)).limit(50)
              ).reverse();
        for (const e of rows) {
          send({
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
          });
        }
      } catch {
        // DB not ready — skip replay
      }

      // ── Proxy the orchestrator's live SSE relay ──────────
      const params = new URLSearchParams();
      if (runId) params.set("runId", runId);
      if (moduleId) params.set("moduleId", moduleId);
      const upstreamUrl = `${ORCHESTRATOR_URL}/events${params.toString() ? `?${params}` : ""}`;

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          clearInterval(heartbeat);
          closed = true;
        }
      }, 15_000);

      const cleanup = () => {
        closed = true;
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      request.signal.addEventListener("abort", cleanup);

      try {
        const upstream = await fetch(upstreamUrl, { signal: request.signal });
        if (!upstream.body) return;
        const reader = upstream.body.getReader();
        // Pipe upstream chunks straight through (already SSE-framed).
        for (;;) {
          const { done, value } = await reader.read();
          if (done || closed) break;
          try {
            controller.enqueue(value);
          } catch {
            break;
          }
        }
      } catch {
        // upstream closed / aborted
      } finally {
        cleanup();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
