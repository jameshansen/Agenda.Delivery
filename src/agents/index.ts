/**
 * Agent orchestrator — convenience functions to run agents and
 * multi-agent pipelines.
 */

import { runAgent, runAgentBackground } from "./base";
import "./tools"; // ensure all tools + agents are registered
import { CheckingAgent } from "./agents/checking";
import { ScraperCreateAgent, ScraperRepairAgent } from "./agents/scraper";
import { SummaryAgent } from "./agents/summary";
import { KeywordAgent } from "./agents/keyword";
import { SpiderAgent } from "./agents/spider";
import { CategorizationAgent } from "./agents/categorization";
import { db } from "@/db";
import { modules } from "@/db/schema";
import { eq } from "drizzle-orm";

export { emitter, type AgentEventData } from "./base";

// ── Synchronous variants (wait for completion) ──────────────

/** Run the Checking Agent for a module. */
export async function runCheckingAgent(slug: string, trigger = "manual") {
  return runAgent(new CheckingAgent(slug), { trigger });
}

/** Run the Scraper Create Agent for a module. */
export async function runScraperCreateAgent(slug: string, trigger = "manual") {
  return runAgent(new ScraperCreateAgent(slug), { trigger });
}

/** Run the Scraper Repair Agent for a module. */
export async function runScraperRepairAgent(slug: string, trigger = "repair") {
  return runAgent(new ScraperRepairAgent(slug), { trigger });
}

/** Run the Summary Agent for a module. */
export async function runSummaryAgent(slug: string, agendaText: string, trigger = "manual") {
  return runAgent(new SummaryAgent(slug, agendaText), { trigger });
}

/** Run the Keyword Agent for a module. */
export async function runKeywordAgent(slug: string, agendaText: string, trigger = "manual") {
  return runAgent(new KeywordAgent(slug, agendaText), { trigger });
}

/** Run the Spider Agent. */
export async function runSpiderAgent(trigger = "manual") {
  return runAgent(new SpiderAgent(), { trigger });
}

/** Run the Categorization Agent for a module. */
export async function runCategorizationAgent(slug: string, agendaText: string, trigger = "manual") {
  return runAgent(new CategorizationAgent(slug, agendaText), { trigger });
}

// ── Background variants (return runId immediately, run async) ──

export function startCheckingAgent(slug: string, onStarted?: (runId: string) => void) {
  return runAgentBackground(new CheckingAgent(slug), { trigger: "manual", onStarted });
}
export function startScraperCreateAgent(slug: string, onStarted?: (runId: string) => void) {
  return runAgentBackground(new ScraperCreateAgent(slug), { trigger: "manual", onStarted });
}
export function startScraperRepairAgent(slug: string, onStarted?: (runId: string) => void) {
  return runAgentBackground(new ScraperRepairAgent(slug), { trigger: "repair", onStarted });
}
export function startSummaryAgent(slug: string, agendaText: string, onStarted?: (runId: string) => void) {
  return runAgentBackground(new SummaryAgent(slug, agendaText), { trigger: "manual", onStarted });
}
export function startKeywordAgent(slug: string, agendaText: string, onStarted?: (runId: string) => void) {
  return runAgentBackground(new KeywordAgent(slug, agendaText), { trigger: "manual", onStarted });
}
export function startSpiderAgent(onStarted?: (runId: string) => void) {
  return runAgentBackground(new SpiderAgent(), { trigger: "manual", onStarted });
}
export function startCategorizationAgent(slug: string, agendaText: string, onStarted?: (runId: string) => void) {
  return runAgentBackground(new CategorizationAgent(slug, agendaText), { trigger: "manual", onStarted });
}

// ── Full pipeline (synchronous) ─────────────────────────────

/**
 * Run the full pipeline for a module: Check, then Repair if needed,
 * then Summarize, Keyword summaries, and Categorize.
 *
 * The Checking Agent finds and downloads the latest meeting agenda.
 * Its extracted text is passed to the Summary, Keyword, and
 * Categorization agents — they don't need to re-fetch anything.
 */
export async function runFullPipeline(slug: string, trigger = "manual") {
  // 1. Check for new agendas (this also finds and downloads the latest)
  const checkingAgent = new CheckingAgent(slug);
  const checkResult = await runAgent(checkingAgent, { trigger });

  // 2. If broken, run repair
  const [mod] = await db
    .select()
    .from(modules)
    .where(eq(modules.slug, slug))
    .limit(1);

  if (mod?.health === "broken" || mod?.health === "repairing") {
    await runScraperRepairAgent(slug, "repair");
    // After repair, re-check to get the agenda content
    const recheckAgent = new CheckingAgent(slug);
    await runAgent(recheckAgent, { trigger });
    // Use the rechecked agent's agenda text (NOT the stale mod.summary)
    const agendaText = recheckAgent.latestAgendaText || checkingAgent.latestAgendaText || "";
    if (agendaText.length < 50) {
      // No real agenda content after repair — skip summarization
      return { checkResult };
    }
    await runSummaryAgent(slug, agendaText, trigger);
    await runKeywordAgent(slug, agendaText, trigger);
    await runCategorizationAgent(slug, agendaText, trigger);
    return { checkResult };
  }

  // 3. Use the agenda text found by the Checking Agent (never fall back to
  // the stale DB summary — if the checking agent found nothing, skip).
  const agendaText = checkingAgent.latestAgendaText || "";

  if (agendaText.length < 50) {
    // No real agenda content — skip summarization
    return { checkResult };
  }

  // 4. Summarize
  await runSummaryAgent(slug, agendaText, trigger);

  // 5. Keyword summaries
  await runKeywordAgent(slug, agendaText, trigger);

  // 6. Categorize
  await runCategorizationAgent(slug, agendaText, trigger);

  return { checkResult };
}