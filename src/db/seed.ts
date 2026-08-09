import "dotenv/config";
import { db } from "./index";
import {
  modules,
  highlights,
  keywords,
  meetings,
  agentEvents,
  scrapeConfigs,
} from "./schema";
import { allModules } from "../data/modules";
import { eq } from "drizzle-orm";

/**
 * Seed script — inserts sample modules ONLY if they don't already exist.
 *
 * By default, existing modules are left completely untouched so agent runs
 * (summaries, highlights, meetings, health status, etc.) are preserved
 * across dev server restarts.
 *
 * To force a full reset (wipe and re-seed), pass --reset:
 *   npm run db:seed -- --reset
 */

const forceReset = process.argv.includes("--reset");

async function main() {
  if (forceReset) {
    console.log("⚠️  --reset flag detected. Wiping all seeded data...");
    // Delete in dependency order (FK constraints)
    await db.delete(agentEvents);
    await db.delete(meetings);
    await db.delete(highlights);
    await db.delete(keywords);
    await db.delete(scrapeConfigs);
    await db.delete(modules);
    console.log("  All module data wiped.");
  }

  let inserted = 0;
  let skipped = 0;

  for (const m of allModules) {
    // Check if the module already exists — if so, skip it entirely.
    const [existing] = await db
      .select({ id: modules.id })
      .from(modules)
      .where(eq(modules.slug, m.slug))
      .limit(1);

    if (existing && !forceReset) {
      // Leave the module exactly as-is. Agents may have updated its
      // summary, health, highlights, keywords, meetings, etc.
      console.log(`  skipped ${m.slug} (already exists — use --reset to overwrite)`);
      skipped++;
      continue;
    }

    // Insert the new module with full sample data.
    const [row] = await db
      .insert(modules)
      .values({
        slug: m.slug,
        name: m.name,
        region: m.region,
        sourceUrl: m.sourceUrl,
        health: m.health,
        followers: m.followers,
        lastUpdated: new Date(m.lastUpdated),
        nextExpected: new Date(m.nextExpected),
        summary: m.summary,
        lat: m.lat ?? null,
        lng: m.lng ?? null,
      })
      .returning({ id: modules.id });
    const moduleId = row.id;

    await db.insert(highlights).values(
      m.highlights.map((h, i) => ({
        moduleId,
        tag: h.tag,
        text: h.text,
        sort: i,
      })),
    );

    await db.insert(keywords).values(
      m.keywords.map((k) => ({
        moduleId,
        keyword: k.keyword,
        followers: k.followers,
        related: k.related,
        summary: k.summary,
      })),
    );

    // Seed meetings (sample data) for new modules.
    if (m.meetings.length > 0) {
      await db.insert(meetings).values(
        m.meetings.map((t) => ({
          moduleId,
          date: new Date(t.date),
          title: t.title,
          kind: t.kind,
          pages: t.pages,
          pdfUrl: t.pdfUrl,
          meetingUrl: t.meetingUrl,
        })),
      );
    }

    // Seed agent log events for new modules.
    await db.insert(agentEvents).values(
      m.agentLog.map((e, i) => ({
        moduleId,
        agent: e.agent,
        action: e.action,
        tool: e.tool ?? null,
        detail: e.detail ?? null,
        sort: i,
      })),
    );

    // Seed scrape config.
    await db
      .insert(scrapeConfigs)
      .values({
        moduleId,
        agendaUrl: m.sourceUrl,
        linkSelector:
          m.slug === "city-of-langley"
            ? "a[href$='.pdf'] in .agenda-list"
            : "a[href*='agenda']",
        fileTypes: ["pdf"],
        hints: "Agenda PDFs are listed by meeting date.",
        version: 1,
        verified: true,
      })
      .onConflictDoNothing();

    console.log(`  seeded ${m.slug}`);
    inserted++;
  }

  console.log(`\ndone — ${inserted} inserted, ${skipped} skipped`);
  console.log(
    skipped > 0
      ? `  (skipped modules retain agent-generated data. Use --reset to wipe.)`
      : ``,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});