#!/usr/bin/env node
/**
 * Test script: run the full pipeline for a module.
 * Check → (Repair if needed) → Summarize → Keywords → Categorize
 *
 * Usage:
 *   npm run test:pipeline              # defaults to township-of-langley
 *   npm run test:pipeline -- city-of-langley
 */

import "dotenv/config";
import { runFullPipeline } from "../src/agents/index";

async function main() {
  const slug = process.argv[2] ?? "township-of-langley";

  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║  Full Pipeline — Test Run                           ║");
  console.log("║  Check → Repair → Summarize → Keywords → Categorize ║");
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log(`  Target:  ${slug}`);
  console.log("");

  const { checkResult } = await runFullPipeline(slug, "test");

  console.log("");
  console.log("─── Pipeline Complete ─────────────────────────────────");
  console.log("  Check run ID:", checkResult.runId);
  console.log("  Check result:", checkResult.result);
  console.log("");
  console.log("✓ Test complete");
  process.exit(0);
}

main().catch((e) => {
  console.error("✗ Test failed:", e);
  process.exit(1);
});