#!/usr/bin/env node
/**
 * Test script: run the Checking Agent against a module.
 *
 * Usage:
 *   npm run test:checking              # defaults to township-of-langley
 *   npm run test:checking -- city-of-langley
 */

import "dotenv/config";
import { runCheckingAgent } from "../src/agents/index";

async function main() {
  const slug = process.argv[2] ?? "township-of-langley";

  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║  Checking Agent — Test Run                          ║");
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log(`  Target: ${slug}`);
  console.log("");

  const { runId, result } = await runCheckingAgent(slug, "test");
  console.log("  Run ID:", runId);
  console.log("  Result:", result);
  console.log("");
  console.log("✓ Test complete");
  process.exit(0);
}

main().catch((e) => {
  console.error("✗ Test failed:", e);
  process.exit(1);
});