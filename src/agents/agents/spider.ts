/**
 * Spider Agent
 *
 * Processes the council source registry (sources.toml). Each run picks the
 * next source that hasn't been created as a module yet, geolocates it, creates
 * a bare module record, and hands it to the Scraper Create Agent to find the
 * actual agenda page and build the scrape config.
 *
 * The source list comes from sources.toml — a version-controlled, transparent
 * file at the project root. This replaces the old hardcoded TS arrays.
 *
 * One source per run. The scheduler triggers the Spider (when enabled).
 */

import { BaseAgent, type ToolContext } from "../base";
import { db } from "@/db";
import { spiderCandidates, modules } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ScraperCreateAgent } from "./scraper";
import { loadSources } from "@/data/sources";

export class SpiderAgent extends BaseAgent {
  readonly name = "Spider Agent";
  readonly tools = ["geo.locate"];
  readonly systemPrompt =
    "You are the Spider Agent for agenda.delivery. You process the queue of " +
    "candidate municipalities: geolocate each one, create a module record, " +
    "and hand it to the Scraper Create Agent to find the agenda page. " +
    "You process one candidate per run.";

  async run(ctx: ToolContext): Promise<string> {
    // Load all sources from sources.toml
    const allSources = loadSources();

    // Find which sources already have modules or candidates
    const existingModules = await db
      .select({ name: modules.name })
      .from(modules);
    const existingNames = new Set(existingModules.map((m) => m.name.toLowerCase()));

    const existingCandidates = await db
      .select({ url: spiderCandidates.url })
      .from(spiderCandidates);
    const existingUrls = new Set(existingCandidates.map((c) => c.url.toLowerCase()));

    // Find the first source that hasn't been processed yet
    const next = allSources.find(
      (s) =>
        !existingNames.has(s.name.toLowerCase()) &&
        !existingUrls.has(s.url.toLowerCase()),
    );

    if (!next) {
      await this.emit(
        "All sources from sources.toml have been processed.",
        undefined,
        `${allSources.length} sources, all processed`,
      );
      return "No sources to process";
    }

    await this.emit(
      `Processing source from sources.toml: ${next.name} (${next.region}).`,
      "site.crawl",
      `source URL: ${next.url}`,
    );

    // Record as a spider candidate for tracking. ON CONFLICT DO NOTHING
    // guards against concurrent spider runs inserting the same candidate.
    const [candidate] = await db
      .insert(spiderCandidates)
      .values({
        name: next.name,
        url: next.url,
        region: next.region,
        status: "queued",
      })
      .onConflictDoNothing()
      .returning();

    // If a candidate with this URL was already inserted by another run, skip.
    if (!candidate) {
      await this.emit(
        `${next.name} is already queued or processed — skipping.`,
        "queue.enqueue",
        "candidate already exists",
      );
      return `${next.name} already queued`;
    }

    // Step 2: Geolocate the candidate for the coverage map
    await this.emit(
      `Geolocating ${candidate.name} for the coverage map.`,
      "geo.locate",
      `query: ${candidate.region ?? candidate.name}`,
    );

    const geoResult = await this.callTool(
      "geo.locate",
      { query: candidate.region ?? candidate.name },
      ctx,
    );

    const geo = geoResult.data as { lat?: number; lng?: number; region?: string };

    // Step 3: Check if a module with this name already exists
    const [existing] = await db
      .select()
      .from(modules)
      .where(eq(modules.name, candidate.name))
      .limit(1);

    if (existing) {
      await this.emit(
        `${candidate.name} already exists as a module — skipping.`,
        "queue.enqueue",
        "module already exists",
      );
      await db
        .update(spiderCandidates)
        .set({ status: "created" })
        .where(eq(spiderCandidates.id, candidate.id));
      return `${candidate.name} already exists`;
    }

    // Step 4: Create the module with geolocation
    const slug = candidate.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

    // Use ON CONFLICT DO NOTHING so concurrent spider runs can't create
    // duplicate modules. If a module with this slug already exists, skip.
    const [newModule] = await db
      .insert(modules)
      .values({
        name: candidate.name,
        slug,
        region: candidate.region ?? "Unknown",
        sourceUrl: candidate.url,
        health: "healthy",
        followers: 0,
        lat: geo.lat ?? null,
        lng: geo.lng ?? null,
      })
      .onConflictDoNothing()
      .returning({ id: modules.id, slug: modules.slug });

    // If the insert was skipped (conflict), the module already exists.
    if (!newModule) {
      await this.emit(
        `${candidate.name} already exists as a module (slug conflict) — skipping.`,
        "queue.enqueue",
        "module already exists (slug conflict)",
      );
      await db
        .update(spiderCandidates)
        .set({ status: "created" })
        .where(eq(spiderCandidates.id, candidate.id));
      return `${candidate.name} already exists (slug conflict)`;
    }

    if (geo.lat != null && geo.lng != null) {
      await this.emit(
        `Resolved ${candidate.name} to ${geo.region} (${geo.lat}, ${geo.lng}). Created module "${slug}".`,
        "geo.locate",
        geoResult.detail,
      );
    } else {
      await this.emit(
        `Created module "${slug}" for ${candidate.name} (geolocation pending).`,
        "queue.enqueue",
        `module slug: ${slug}`,
      );
    }

    // Update candidate with geo data
    await db
      .update(spiderCandidates)
      .set({
        geo: geo.lat != null && geo.lng != null ? `${geo.lat},${geo.lng}` : null,
        region: geo.region ?? candidate.region,
        status: "geo_located",
      })
      .where(eq(spiderCandidates.id, candidate.id));

    // Step 5: Hand to Scraper Create Agent — wait for result
    await this.emit(
      `Handing ${candidate.name} to the Scraper Create Agent to find the agenda page.`,
      "queue.enqueue",
      `module: ${slug}`,
    );

    const scraperAgent = new ScraperCreateAgent(slug);
    // Share the run context so events stream together
    scraperAgent.runId = this.runId;
    scraperAgent.moduleId = newModule.id;

    try {
      const scraperCtx: ToolContext = {
        runId: this.runId,
        moduleId: newModule.id,
      };
      const scraperResult = await scraperAgent.run(scraperCtx);

      // Scraper succeeded — mark candidate as created
      await db
        .update(spiderCandidates)
        .set({ status: "created" })
        .where(eq(spiderCandidates.id, candidate.id));

      await this.emit(
        `Scraper Create Agent finished: ${scraperResult}. ${candidate.name} is now a live module.`,
        "queue.enqueue",
        "scraper create succeeded",
      );

      return `Created module for ${candidate.name} — scraper verified`;
    } catch (err) {
      // Scraper failed — mark candidate as rejected
      const reason = err instanceof Error ? err.message : String(err);
      await db
        .update(spiderCandidates)
        .set({ status: "rejected" })
        .where(eq(spiderCandidates.id, candidate.id));

      // Mark the module as broken
      await db
        .update(modules)
        .set({ health: "broken" })
        .where(eq(modules.id, newModule.id));

      await this.emit(
        `Scraper Create Agent failed for ${candidate.name}: ${reason}. Marked as rejected.`,
        undefined,
        `scraper failed: ${reason.slice(0, 100)}`,
      );

      return `Rejected ${candidate.name} — scraper failed: ${reason.slice(0, 80)}`;
    }
  }
}