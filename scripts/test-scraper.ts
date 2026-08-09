#!/usr/bin/env node
/**
 * Test script: run the Scraper Create Agent against a module.
 *
 * Usage:
 *   npm run test:scraper              # defaults to township-of-langley
 *   npm run test:scraper -- city-of-langley
 */

import "dotenv/config";
import { runScraperCreateAgent } from "../src/agents/index";

async function main() {
  const slug = process.argv[2] ?? "township-of-langley";

  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║  Scraper Create Agent — Test Run                     ║");
  console.log("╚══════════════════════════════════════════════════════╝");
  console.log("");
  console.log(`  Target:  ${slug}`);
  console.log(`  LLM:     ${process.env.OLLAMA_BASE_URL ?? "(mock)"}`);
  console.log(`  Model:   ${process.env.AGENT_MODEL ?? "glm-5.2"}`);
  console.log("");

  const { runId, result } = await runScraperCreateAgent(slug, "test");

  console.log("");
  console.log("─── Result ────────────────────────────────────────────");
  console.log("  Run ID:", runId);
  console.log("  Result:", result);
  console.log("");

  // Show the scrape config
  const { db } = await import("../src/db");
  const { modules, scrapeConfigs, agentEvents } = await import("../src/db/schema");
  const { eq } = await import("drizzle-orm");

  const [m] = await db
    .select()
    .from(modules)
    .where(eq(modules.slug, slug))
    .limit(1);

  if (m) {
    const [cfg] = await db
      .select()
      .from(scrapeConfigs)
      .where(eq(scrapeConfigs.moduleId, m.id))
      .limit(1);

    if (cfg) {
      console.log("─── Scrape Config ─────────────────────────────────────");
      console.log("  Agenda URL:  ", cfg.agendaUrl);
      console.log("  Selector:    ", cfg.linkSelector);
      console.log("  File types:  ", cfg.fileTypes);
      console.log("  Hints:       ", cfg.hints);
      console.log("  Version:     ", cfg.version);
      console.log("  Verified:    ", cfg.verified);
      console.log("");
    }

    const events = await db
      .select()
      .from(agentEvents)
      .where(eq(agentEvents.moduleId, m.id))
      .orderBy(agentEvents.sort);

    console.log("─── Agent Events ──────────────────────────────────────");
    for (const e of events) {
      const tool = e.tool ? `  [${e.tool}]` : "";
      const detail = e.detail ? ` ${e.detail}` : "";
      console.log(`  [${e.agent}] ${e.action}${tool}${detail}`);
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