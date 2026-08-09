/**
 * Agent scheduler — runs agents on a fixed cadence.
 *
 * The scheduler is started when the Next.js server boots (via
 * instrumentation.ts) and runs in-process. It uses setInterval timers
 * to trigger agent runs at the configured intervals:
 *
 *  - Checking Agent: every module, every 6 hours
 *  - Auto-repair: dispatched when Checking flags a module as broken
 *
 * The Spider Agent is currently DISABLED. Council sources come from
 * sources.toml (a version-controlled file at the project root) rather
 * than the old hardcoded TS arrays. When the spider is re-enabled it
 * will read from sources.toml via the loadSources() loader.
 *
 * NOTE: This is a single-process scheduler suitable for a single VPS
 * deployment. For multi-instance deployments (K8s), a distributed lock
 * (e.g. Redis) would be needed to prevent duplicate runs.
 */

import { db } from "@/db";
import { modules } from "@/db/schema";
import {
  startCheckingAgent,
  startSpiderAgent,
  runScraperRepairAgent,
} from "@/agents";

// ── Scheduler state (singleton) ─────────────────────────────

export type ScheduleEntry = {
  name: string;
  cadence: string;
  intervalMs: number;
  lastRun: Date | null;
  nextRun: Date | null;
  running: boolean;
};

class Scheduler {
  private timers: NodeJS.Timeout[] = [];
  private entries: ScheduleEntry[] = [];

  // ── Cadences ──────────────────────────────────────────
  private readonly CHECK_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours
  // Spider is disabled — sources.toml is the new entry point.
  // Re-enable by setting SPIDER_INTERVAL > 0 and uncommenting the timer.
  private readonly SPIDER_INTERVAL = 0;

  // For dev/testing: use shorter intervals if env is set
  private readonly isDev = process.env.NODE_ENV !== "production";
  private readonly checkMs = this.isDev ? 30 * 60 * 1000 : this.CHECK_INTERVAL; // 30min in dev
  private readonly spiderMs = this.isDev ? 0 : this.SPIDER_INTERVAL; // disabled

  // ── Public API ────────────────────────────────────────

  start() {
    if (this.timers.length > 0) return; // already started

    const now = new Date();

    this.entries = [
      {
        name: "Checking Agent",
        cadence: this.isDev ? "every 30 min" : "every 6 hours",
        intervalMs: this.checkMs,
        lastRun: null,
        nextRun: new Date(now.getTime() + this.checkMs),
        running: false,
      },
      {
        name: "Spider Agent",
        cadence: "disabled (sources.toml)",
        intervalMs: 0,
        lastRun: null,
        nextRun: null,
        running: false,
      },
    ];

    // Start the checking timer
    const checkTimer = setInterval(
      () => this.runChecking(),
      this.checkMs,
    );
    this.timers.push(checkTimer);

    // Spider is disabled — sources.toml is the new entry point.
    // The spider will be re-enabled once the sources.toml loader is integrated.

    console.log(
      `[scheduler] Started — checking every ${this.checkMs / 1000}s, spider disabled`,
    );
  }

  stop() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.entries = [];
    console.log("[scheduler] Stopped");
  }

  getSchedule(): ScheduleEntry[] {
    return [...this.entries];
  }

  // ── Internal run methods ─────────────────────────────

  private async runChecking() {
    const entry = this.entries.find((e) => e.name === "Checking Agent");
    if (!entry) return;

    entry.running = true;
    entry.lastRun = new Date();
    entry.nextRun = new Date(Date.now() + entry.intervalMs);

    try {
      // Get all modules
      const allModules = await db
        .select({ slug: modules.slug, health: modules.health })
        .from(modules);

      for (const m of allModules) {
        // If module is broken or repairing, run the repair agent and WAIT
        // for it to finish before moving on. This avoids triggering checking
        // agents on still-broken modules and prevents wasted runs.
        if (m.health === "broken" || m.health === "repairing") {
          console.log(`[scheduler] Module ${m.slug} is ${m.health} — running repair (synchronous).`);
          try {
            await runScraperRepairAgent(m.slug, "schedule");
          } catch (err) {
            console.error(`[scheduler] Repair failed for ${m.slug}:`, err);
          }
          continue;
        }

        console.log(`[scheduler] Checking module ${m.slug}.`);
        startCheckingAgent(m.slug);
      }
    } catch (err) {
      console.error("[scheduler] Checking run failed:", err);
    } finally {
      entry.running = false;
    }
  }

  private async runSpider() {
    const entry = this.entries.find((e) => e.name === "Spider Agent");
    if (!entry) return;

    entry.running = true;
    entry.lastRun = new Date();
    entry.nextRun = new Date(Date.now() + entry.intervalMs);

    try {
      console.log("[scheduler] Spider run — processing next candidate.");
      startSpiderAgent();
    } catch (err) {
      console.error("[scheduler] Spider run failed:", err);
    } finally {
      entry.running = false;
    }
  }
}

// ── Singleton (global, survives across module reloads) ───────

const globalForScheduler = globalThis as typeof globalThis & {
  __scheduler?: Scheduler;
};

export function getScheduler(): Scheduler {
  if (!globalForScheduler.__scheduler) {
    globalForScheduler.__scheduler = new Scheduler();
  }
  return globalForScheduler.__scheduler;
}

export function startScheduler() {
  getScheduler().start();
}