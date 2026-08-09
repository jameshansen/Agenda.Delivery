#!/usr/bin/env node
/**
 * End-to-end test: run the full pipeline for a module.
 *
 * The pipeline is fully autonomous:
 *  1. Scraper Create Agent: crawls the site, finds the agenda listing page
 *     (self-heals if the known URL is broken via web search)
 *  2. Checking Agent: finds the latest meeting, follows to the detail page,
 *     extracts the actual agenda content
 *  3. Summary Agent: generates AI summary + highlights from the real agenda
 *  4. Keyword Agent: generates bespoke per-keyword summaries
 *  5. Categorization Agent: classifies the meeting type
 *
 * No manual HTML fetching — the agents do everything themselves.
 *
 * Usage:
 *   npm run test:e2e                     # defaults to township-of-langley
 *   npm run test:e2e -- city-of-langley
 */

import "dotenv/config";
import { db } from "../src/db";
import { modules, highlights, keywords, meetings, scrapeConfigs, agentEvents } from "../src/db/schema";
import { eq, desc } from "drizzle-orm";
import {
  runScraperCreateAgent,
  runFullPipeline,
} from "../src/agents/index";

async function main() {
  const slug = process.argv[2] ?? "township-of-langley";

  console.log("");
  console.log("  ╔══════════════════════════════════════════════════════════╗");
  console.log("  ║  End-to-End Pipeline Test (fully autonomous)              ║");
  console.log("  ║  Scraper → Check → Summary → Keywords → Categorize        ║");
  console.log("  ╚══════════════════════════════════════════════════════════╝");
  console.log("");
  console.log(`  Target:   ${slug}`);
  console.log(`  LLM:      ${process.env.OLLAMA_BASE_URL ?? "(mock)"}`);
  console.log(`  Agent:    ${process.env.AGENT_MODEL ?? "glm-5.2"}`);
  console.log(`  Summary:  ${process.env.SUMMARY_MODEL ?? "gemma4:31b"}`);
  console.log("");

  // ── 1. Load the module ──────────────────────────────────
  const [mod] = await db
    .select()
    .from(modules)
    .where(eq(modules.slug, slug))
    .limit(1);
  if (!mod) {
    console.error(`  ✗ Module '${slug}' not found in DB.`);
    process.exit(1);
  }
  console.log(`  ✓ Module: ${mod.name} (${mod.region})`);
  console.log(`    Source: ${mod.sourceUrl}`);
  console.log("");

  // ── 2. Run Scraper Create Agent ─────────────────────────
  console.log("  ─── Step 1: Scraper Create Agent ────────────────────");
  const scrapeResult = await runScraperCreateAgent(slug, "e2e-test");
  console.log(`  ✓ Scraper result: ${scrapeResult.result}`);
  console.log("");

  // ── 3. Run the full pipeline (Check → Summary → Keywords → Category) ──
  console.log("  ─── Step 2: Full Pipeline (Checking + Summary + Keywords + Categorization) ───");
  const pipelineResult = await runFullPipeline(slug, "e2e-test");
  console.log(`  ✓ Pipeline result: ${pipelineResult.checkResult.result}`);
  console.log("");

  // ── 4. Show the final state of the module in the DB ─────
  console.log("  ╔══════════════════════════════════════════════════════════╗");
  console.log("  ║  Final Module State in DB                                 ║");
  console.log("  ╚══════════════════════════════════════════════════════════╝");
  console.log("");

  const [updated] = await db
    .select()
    .from(modules)
    .where(eq(modules.slug, slug))
    .limit(1);

  console.log(`  Source URL: ${updated?.sourceUrl}`);
  console.log("");

  console.log("  ─── AI Summary ──────────────────────────────────────");
  console.log(`  ${updated?.summary ?? "(empty)"}`);
  console.log("");

  const dbHighlights = await db
    .select()
    .from(highlights)
    .where(eq(highlights.moduleId, mod.id))
    .orderBy(highlights.sort);

  console.log("  ─── Highlights ──────────────────────────────────────");
  for (const h of dbHighlights) {
    console.log(`  [${h.tag}] ${h.text}`);
  }
  console.log("");

  const dbKeywords = await db
    .select()
    .from(keywords)
    .where(eq(keywords.moduleId, mod.id));

  console.log("  ─── Keyword Summaries ───────────────────────────────");
  for (const k of dbKeywords) {
    console.log(`  ▸ ${k.keyword} (${k.followers} followers)`);
    console.log(`    ${k.summary}`);
    console.log("");
  }

  const dbMeetings = await db
    .select()
    .from(meetings)
    .where(eq(meetings.moduleId, mod.id))
    .orderBy(desc(meetings.date));

  console.log("  ─── Meetings ────────────────────────────────────────");
  for (const m of dbMeetings.slice(0, 5)) {
    console.log(`  ${m.date.toISOString().slice(0, 10)} — ${m.title} (${m.kind})`);
  }
  console.log("");

  const [cfg] = await db
    .select()
    .from(scrapeConfigs)
    .where(eq(scrapeConfigs.moduleId, mod.id))
    .limit(1);

  if (cfg) {
    console.log("  ─── Scrape Config ───────────────────────────────────");
    console.log(`  Agenda URL: ${cfg.agendaUrl}`);
    console.log(`  Selector:   ${cfg.linkSelector}`);
    console.log(`  Version:    ${cfg.version}  Verified: ${cfg.verified}`);
    console.log("");
  }

  const dbEvents = await db
    .select()
    .from(agentEvents)
    .where(eq(agentEvents.moduleId, mod.id));

  console.log(`  ─── Agent Events: ${dbEvents.length} total ──────────────`);
  console.log("");

  console.log("  ✓ End-to-end test complete!");
  console.log(`  → View the page at: http://localhost:3000/module/${slug}`);
  console.log("");
  process.exit(0);
}

main().catch((e) => {
  console.error("  ✗ E2E test failed:", e);
  process.exit(1);
});