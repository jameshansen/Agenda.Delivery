#!/usr/bin/env node
/**
 * Test script: run the Spider Agent to discover new sources.
 *
 * Usage:
 *   npm run test:spider
 */

import "dotenv/config";
import { runSpiderAgent } from "../src/agents/index";

async function main() {
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║  Spider Agent — Test Run                            ║");
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log(`  LLM:    ${process.env.OLLAMA_BASE_URL ?? "(mock)"}`);
  console.log(`  Model:  ${process.env.AGENT_MODEL ?? "glm-5.2"}`);
  console.log("");

  const { runId, result } = await runSpiderAgent("test");
  console.log("");
  console.log("  Run ID:", runId);
  console.log("  Result:", result);
  console.log("");

  // Show discovered candidates
  const { db } = await import("../src/db");
  const { spiderCandidates } = await import("../src/db/schema");
  const { desc } = await import("drizzle-orm");

  const candidates = await db
    .select()
    .from(spiderCandidates)
    .orderBy(desc(spiderCandidates.createdAt))
    .limit(10);

  if (candidates.length > 0) {
    console.log("─── Discovered Candidates ────────────────────────────");
    for (const c of candidates) {
      console.log(`  ${c.name} — ${c.url}`);
      console.log(`    ${c.region ?? "Location pending"} — ${c.status}`);
    }
  }

  console.log("");
  console.log("✓ Test complete");
  process.exit(0);
}

main().catch((e) => {
  console.error("✗ Test failed:", e);
  process.exit(1);
});