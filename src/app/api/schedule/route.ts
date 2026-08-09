import { NextResponse } from "next/server";
import { db } from "@/db";
import { agentConfig } from "@/db/schema";

export const dynamic = "force-dynamic";

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL ?? "http://orchestrator:8000";

/**
 * GET /api/schedule — scheduling state.
 *
 * Scheduling lives in the orchestrator now. We report the editable schedule
 * from agent_config plus the orchestrator's live queue/pause status.
 */
export async function GET() {
  let entries: unknown[] = [];
  try {
    entries = await db
      .select({
        agent: agentConfig.agent,
        displayName: agentConfig.displayName,
        scheduleSecs: agentConfig.scheduleSecs,
        enabled: agentConfig.enabled,
      })
      .from(agentConfig);
  } catch {
    // agent_config not present yet
  }

  let status: Record<string, unknown> = { ok: false };
  try {
    const res = await fetch(`${ORCHESTRATOR_URL}/status`, {
      signal: AbortSignal.timeout(3000),
    });
    status = await res.json();
  } catch {
    // orchestrator unreachable
  }

  return NextResponse.json({
    running: Boolean(status.ok),
    queued: status.queued ?? 0,
    pausedSecs: status.paused_secs ?? 0,
    entries,
  });
}
