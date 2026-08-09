#!/usr/bin/env node
/**
 * Seed the spider queue from sources.toml.
 *
 * Usage: npm run db:seed-spider
 *
 * Reads the transparent, version-controlled sources.toml at the project
 * root and inserts any new sources as spider_candidates.
 */

import "dotenv/config";
import { db } from "../src/db";
import { spiderCandidates } from "../src/db/schema";
import { modules } from "../src/db/schema";
import { sql } from "drizzle-orm";
import { loadSources } from "../src/data/sources";

async function main() {
  const allSources = loadSources();

  // Get existing module names so we don't queue sources that are
  // already live modules.
  const existingModules = await db.select({ name: modules.name, sourceUrl: modules.sourceUrl }).from(modules);
  const existingNames = new Set(existingModules.map((m) => m.name.toLowerCase()));

  // Get existing candidate URLs so we don't duplicate.
  const existingCandidates = await db.select({ url: spiderCandidates.url }).from(spiderCandidates);
  const existingUrls = new Set(existingCandidates.map((c) => c.url.toLowerCase()));

  let inserted = 0;
  let skipped = 0;

  for (const s of allSources) {
    // Skip if already a live module
    if (existingNames.has(s.name.toLowerCase())) {
      skipped++;
      continue;
    }

    // Skip if already in the queue
    if (existingUrls.has(s.url.toLowerCase())) {
      skipped++;
      continue;
    }

    await db.insert(spiderCandidates).values({
      name: s.name,
      url: s.url,
      region: s.region,
      status: "queued",
    });
    inserted++;
  }

  const total = await db.select({ count: sql<number>`count(*)` }).from(spiderCandidates);

  console.log(`Sources from sources.toml: ${allSources.length}`);
  console.log(`Inserted: ${inserted} new candidates, ${skipped} already exist.`);
  console.log(`Total candidates in queue: ${total[0].count}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});