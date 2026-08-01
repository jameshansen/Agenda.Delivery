import { eq, asc, desc } from "drizzle-orm";
import { db } from "./index";
import {
  modules,
  highlights,
  keywords,
  meetings,
  agentEvents,
  subscriptions,
} from "./schema";
import { fmtDate } from "@/lib/format";

type ModuleRow = typeof modules.$inferSelect;
export type Health = ModuleRow["health"];

export type ModuleListItem = {
  slug: string;
  name: string;
  region: string;
  health: Health;
  followers: number;
  lastUpdated: string;
  summary: string;
};

export type ModuleView = ModuleListItem & {
  sourceUrl: string;
  nextExpected: string;
  highlights: { tag: string; text: string }[];
  keywords: {
    keyword: string;
    followers: number;
    related: string[];
    summary: string;
  }[];
  meetings: { date: string; title: string; kind: string; pages: number }[];
  agentLog: {
    agent: string;
    action: string;
    tool?: string;
    detail?: string;
  }[];
};

export async function getModules(): Promise<ModuleListItem[]> {
  const rows = await db
    .select()
    .from(modules)
    .orderBy(desc(modules.lastUpdated));
  return rows.map((m) => ({
    slug: m.slug,
    name: m.name,
    region: m.region,
    health: m.health,
    followers: m.followers,
    lastUpdated: fmtDate(m.lastUpdated),
    summary: m.summary ?? "",
  }));
}

export async function getModuleBySlug(
  slug: string,
): Promise<ModuleView | null> {
  const [m] = await db
    .select()
    .from(modules)
    .where(eq(modules.slug, slug))
    .limit(1);
  if (!m) return null;

  const [hs, ks, mts, evs] = await Promise.all([
    db
      .select()
      .from(highlights)
      .where(eq(highlights.moduleId, m.id))
      .orderBy(asc(highlights.sort)),
    db.select().from(keywords).where(eq(keywords.moduleId, m.id)),
    db
      .select()
      .from(meetings)
      .where(eq(meetings.moduleId, m.id))
      .orderBy(desc(meetings.date)),
    db
      .select()
      .from(agentEvents)
      .where(eq(agentEvents.moduleId, m.id))
      .orderBy(asc(agentEvents.sort)),
  ]);

  return {
    slug: m.slug,
    name: m.name,
    region: m.region,
    health: m.health,
    followers: m.followers,
    lastUpdated: fmtDate(m.lastUpdated),
    summary: m.summary ?? "",
    sourceUrl: m.sourceUrl,
    nextExpected: fmtDate(m.nextExpected),
    highlights: hs.map((h) => ({ tag: h.tag, text: h.text })),
    keywords: ks.map((k) => ({
      keyword: k.keyword,
      followers: k.followers,
      related: k.related,
      summary: k.summary,
    })),
    meetings: mts.map((t) => ({
      date: fmtDate(t.date),
      title: t.title,
      kind: t.kind,
      pages: t.pages,
    })),
    agentLog: evs.map((e) => ({
      agent: e.agent,
      action: e.action,
      tool: e.tool ?? undefined,
      detail: e.detail ?? undefined,
    })),
  };
}

export type UserSubscription = {
  slug: string;
  name: string;
  region: string;
  channel: "email" | "text";
  summary: string;
  lastUpdated: string;
};

export async function getSubscriptionsForUser(
  userId: string,
): Promise<UserSubscription[]> {
  const rows = await db
    .select({
      slug: modules.slug,
      name: modules.name,
      region: modules.region,
      channel: subscriptions.channel,
      summary: modules.summary,
      lastUpdated: modules.lastUpdated,
    })
    .from(subscriptions)
    .innerJoin(modules, eq(subscriptions.moduleId, modules.id))
    .where(eq(subscriptions.userId, userId))
    .orderBy(desc(subscriptions.createdAt));

  return rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    region: r.region,
    channel: r.channel,
    summary: r.summary ?? "",
    lastUpdated: fmtDate(r.lastUpdated),
  }));
}
