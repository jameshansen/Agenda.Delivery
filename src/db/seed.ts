import "dotenv/config";
import { db } from "./index";
import {
  modules,
  highlights,
  keywords,
  meetings,
  agentEvents,
} from "./schema";
import { allModules } from "../data/modules";

async function main() {
  // Cascades to highlights/keywords/meetings/agent_events/subscriptions.
  await db.delete(modules);

  for (const m of allModules) {
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

    await db.insert(meetings).values(
      m.meetings.map((t) => ({
        moduleId,
        date: new Date(t.date),
        title: t.title,
        kind: t.kind,
        pages: t.pages,
      })),
    );

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

    console.log(`seeded ${m.slug}`);
  }

  console.log(`done — ${allModules.length} modules`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
