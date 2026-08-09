import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { validateEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * GET /api/health — health check endpoint.
 *
 * Returns 200 only when the database is reachable and the app process is
 * healthy. Used by Docker healthcheck and load balancer probes.
 *
 * Response: { status: "ok"|"degraded"|"down", checks: {...} }
 */
export async function GET() {
  const checks: Record<string, "ok" | "fail"> = {};

  // Check 1: Database connection
  try {
    await db.execute(sql`SELECT 1`);
    checks.database = "ok";
  } catch {
    checks.database = "fail";
  }

  // Check 2: Required environment variables
  const env = validateEnv();
  checks.env = env.ok ? "ok" : "fail";

  const allOk = Object.values(checks).every((v) => v === "ok");

  return NextResponse.json(
    {
      status: allOk ? "ok" : "down",
      checks,
      timestamp: new Date().toISOString(),
    },
    { status: allOk ? 200 : 503 },
  );
}