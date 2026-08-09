#!/usr/bin/env node
/**
 * Test script: run the Summary Agent against a module.
 *
 * Usage:
 *   npm run test:summary              # defaults to township-of-langley
 *   npm run test:summary -- city-of-langley
 */

import "dotenv/config";
import { runSummaryAgent } from "../src/agents/index";

async function main() {
  const slug = process.argv[2] ?? "township-of-langley";
  // Use a realistic agenda text excerpt for the test
  const agendaText = `
    Township of Langley Regular Council Meeting — June 24, 2024

    1. Adoption of Minutes
    2. Delegations
       - Presentation from the Langley Chamber of Commerce re: economic development
       - HUB Cycling presentation on active transportation infrastructure
    3. Reports
       - Staff report on the Brookswood-Fernridge Community Plan amendment
       - Engineering report on the 208 Street watermain replacement project
       - Financial report Q2 2024 operating budget variance
    4. Bylaws
       - Bylaw 2024-045: Zoning amendment for mixed-use development in Willoughby
       - Bylaw 2024-046: Road naming bylaw for new subdivision in Murrayville
    5. Correspondence
       - Letter from Metro Vancouver re: regional growth strategy update
       - Petition from residents re: traffic calming on 56 Avenue
    6. New Business
       - Motion: Direct staff to prepare a report on e-bike infrastructure
       - Motion: Write letter to TransLink re: increased bus frequency on Route 595
  `;

  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║  Summary Agent — Test Run                           ║");
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log(`  Target:  ${slug}`);
  console.log(`  Model:   ${process.env.SUMMARY_MODEL ?? "gemma4:31b"}`);
  console.log("");

  const { runId, result } = await runSummaryAgent(slug, agendaText, "test");
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