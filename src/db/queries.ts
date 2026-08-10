import { eq, asc, desc, sql, and, ilike, or, inArray } from "drizzle-orm";
import { db } from "./index";
import {
  modules,
  highlights,
  keywords,
  meetings,
  agentEvents,
  agentRuns,
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
  /** Province/state extracted from the region (e.g. "British Columbia"). */
  province: string;
  /** Latest regular council meeting title, if any. */
  latestMeetingTitle: string | null;
  /** Latest regular council meeting date, if any. */
  latestMeetingDate: string | null;
  /** Latitude from the geo.locate agent (null if not yet geolocated). */
  lat: number | null;
  /** Longitude from the geo.locate agent (null if not yet geolocated). */
  lng: number | null;
};

/** Extract the province/state from a region string like "Langley, British Columbia". */
export function extractProvince(region: string): string {
  const parts = region.split(",").map((s) => s.trim());
  return parts.length > 1 ? parts[parts.length - 1] : region;
}

/** Haversine distance in km between two lat/lng points. */
function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export type ModuleView = ModuleListItem & {
  id: string;
  sourceUrl: string;
  nextExpected: string;
  lastChecked: string;
  highlights: { tag: string; text: string }[];
  keywords: {
    keyword: string;
    followers: number;
    related: string[];
    summary: string;
  }[];
  meetings: { date: string; dateRaw: Date; title: string; kind: string; pages: number; pdfUrl: string | null; meetingUrl: string | null }[];
  /** Latest regular council meeting, if any (for the download card). */
  latestCouncilMeeting: { title: string; date: string; kind: string; pages: number; pdfUrl: string | null; meetingUrl: string | null } | null;
  agentLog: {
    agent: string;
    action: string;
    tool?: string;
    detail?: string;
    screenshot?: string;
    prompt?: string;
    response?: string;
    model?: string;
  }[];
};

/** Fetch a paginated, filtered list of modules for the index page. */
export async function getModulesPaged(opts: {
  page?: number;
  perPage?: number;
  province?: string;
  query?: string;
  lat?: number;
  lng?: number;
  radiusKm?: number;
}): Promise<{ items: ModuleListItem[]; total: number; provinces: string[] }> {
  const page = Math.max(1, opts.page ?? 1);
  const perPage = Math.min(100, Math.max(1, opts.perPage ?? 20));

  // Build WHERE conditions
  const conditions = [];
  if (opts.province) {
    conditions.push(ilike(modules.region, `%${opts.province}%`));
  }
  if (opts.query) {
    const q = `%${opts.query}%`;
    conditions.push(
      or(
        ilike(modules.name, q),
        ilike(modules.region, q),
      )!,
    );
  }

  const where =
    conditions.length > 0 ? and(...conditions) : undefined;

  // Get total count
  const countQ = db
    .select({ count: sql<number>`count(*)` })
    .from(modules);
  if (where) countQ.where(where);
  const [{ count: total }] = await countQ;

  // Get distinct provinces for the filter dropdown
  const provinceRows = await db
    .select({ region: modules.region })
    .from(modules);
  const provinceSet = new Set<string>();
  for (const r of provinceRows) {
    provinceSet.add(extractProvince(r.region));
  }
  const provinces = [...provinceSet].sort();

  // Get the page of results
  const rowsQ = db.select().from(modules);
  if (where) rowsQ.where(where);
  // NULLS LAST: a council that has never successfully found an agenda has
  // last_updated = NULL forever (only last_checked moves on failed attempts).
  // Postgres's default DESC order puts NULLs first, which would otherwise
  // permanently pin every broken council to the top of the homepage.
  rowsQ.orderBy(sql`${modules.lastUpdated} DESC NULLS LAST`).limit(perPage).offset((page - 1) * perPage);
  const rows = await rowsQ;

  // For geo filtering, if lat/lng provided, filter in JS (postgres earthdistance
  // extension isn't guaranteed). This is fine for a few hundred modules.
  let filtered = rows;
  if (opts.lat != null && opts.lng != null && opts.radiusKm) {
    filtered = rows.filter(
      (m) =>
        m.lat != null &&
        m.lng != null &&
        haversine(opts.lat!, opts.lng!, m.lat, m.lng) <= opts.radiusKm!,
    );
  }

  // Fetch latest regular council meeting for each module (single query).
  // We filter out generic "Council Calendar" / "Meetings and Agendas" entries
  // that aren't actual meetings.
  const moduleIds = filtered.map((m) => m.id);
  const latestMeetings: Record<string, { title: string; date: Date }> = {};
  if (moduleIds.length > 0) {
    const meetingRows = await db
      .select()
      .from(meetings)
      .where(
        and(
          inArray(meetings.moduleId, moduleIds),
          or(
            ilike(meetings.kind, "%council%"),
            ilike(meetings.title, "%council%"),
          )!,
        ),
      )
      .orderBy(desc(meetings.date));

    for (const mt of meetingRows) {
      if (latestMeetings[mt.moduleId]) continue; // already have the latest
      const title = mt.title.toLowerCase();
      // Skip generic calendar/listing entries
      const isGeneric =
        title.includes("council calendar") ||
        title.includes("meetings and agendas") ||
        title.includes("meeting calendar") ||
        title.includes("agenda search");
      if (isGeneric) continue;
      latestMeetings[mt.moduleId] = { title: mt.title, date: mt.date };
    }
  }

  return {
    items: filtered.map((m) => ({
      slug: m.slug,
      name: m.name,
      region: m.region,
      health: m.health,
      followers: m.followers,
      lastUpdated: fmtDate(m.lastUpdated),
      summary: m.summary ?? "",
      province: extractProvince(m.region),
      latestMeetingTitle: latestMeetings[m.id]?.title ?? null,
      latestMeetingDate: latestMeetings[m.id]
        ? fmtDate(latestMeetings[m.id].date)
        : null,
      lat: m.lat,
      lng: m.lng,
    })),
    total: opts.lat != null ? filtered.length : Number(total),
    provinces,
  };
}

/** Legacy: fetch all modules (used by search, map, etc.) */
export async function getModules(): Promise<ModuleListItem[]> {
  const rows = await db
    .select()
    .from(modules)
    .orderBy(sql`${modules.lastUpdated} DESC NULLS LAST`);
  return rows.map((m) => ({
    slug: m.slug,
    name: m.name,
    region: m.region,
    health: m.health,
    followers: m.followers,
    lastUpdated: fmtDate(m.lastUpdated),
    summary: m.summary ?? "",
    province: extractProvince(m.region),
    latestMeetingTitle: null,
    latestMeetingDate: null,
    lat: m.lat,
    lng: m.lng,
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

  // "Last completed run" should mean exactly that -- one run's worth of
  // events, not every agent_event row this module has ever accumulated.
  // Without scoping to a single run_id, the list only grows over the
  // module's lifetime and repeats near-identical phrasing across many
  // historical runs (e.g. "Crawling X to locate the agenda listing page"
  // once per past check).
  const [latestRun] = await db
    .select({ id: agentRuns.id })
    .from(agentRuns)
    .where(eq(agentRuns.moduleId, m.id))
    .orderBy(desc(agentRuns.createdAt))
    .limit(1);

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
    latestRun
      ? db
          .select()
          .from(agentEvents)
          .where(and(eq(agentEvents.moduleId, m.id), eq(agentEvents.runId, latestRun.id)))
          .orderBy(asc(agentEvents.sort))
      : // Pre-Phase-4 events have no run_id -- fall back to the most recent
        // handful rather than the module's entire history.
        db
          .select()
          .from(agentEvents)
          .where(eq(agentEvents.moduleId, m.id))
          .orderBy(desc(agentEvents.sort))
          .limit(10)
          .then((rows) => rows.reverse()),
  ]);

  return {
    id: m.id,
    slug: m.slug,
    name: m.name,
    region: m.region,
    health: m.health,
    followers: m.followers,
    lastUpdated: fmtDate(m.lastUpdated),
    summary: m.summary ?? "",
    sourceUrl: m.sourceUrl,
    nextExpected: fmtDate(m.nextExpected),
    lastChecked: fmtDate(m.lastChecked),
    province: extractProvince(m.region),
    latestMeetingTitle: null,
    latestMeetingDate: null,
    lat: m.lat,
    lng: m.lng,
    highlights: hs.map((h) => ({ tag: h.tag, text: h.text })),
    keywords: ks.map((k) => ({
      keyword: k.keyword,
      followers: k.followers,
      related: k.related,
      summary: k.summary,
    })),
    meetings: mts.map((t) => ({
      date: fmtDate(t.date),
      dateRaw: t.date,
      title: t.title,
      kind: t.kind,
      pages: t.pages,
      pdfUrl: t.pdfUrl,
      meetingUrl: t.meetingUrl,
    })),
    latestCouncilMeeting: (() => {
      // Find the most recent meeting that is a real council meeting,
      // not a generic calendar/listing entry.
      const cm = mts.find(
        (t) => {
          const kind = t.kind.toLowerCase();
          const title = t.title.toLowerCase();
          // Must be classified as a council meeting kind
          const isCouncilKind = kind.includes("council");
          // Must not be a generic calendar/listing entry
          const isGenericCalendar =
            title.includes("council calendar") ||
            title.includes("meetings and agendas") ||
            title.includes("meeting calendar") ||
            title.includes("agenda search");
          // Must have a PDF or meeting URL (real agenda, not a listing)
          const hasContent = t.pdfUrl || t.meetingUrl;
          return (isCouncilKind || title.includes("council")) && !isGenericCalendar && hasContent;
        },
      );
      return cm
        ? {
            title: cm.title,
            date: fmtDate(cm.date),
            kind: cm.kind,
            pages: cm.pages,
            pdfUrl: cm.pdfUrl,
            meetingUrl: cm.meetingUrl,
          }
        : null;
    })(),
    agentLog: evs.map((e) => ({
      agent: e.agent,
      action: e.action,
      tool: e.tool ?? undefined,
      detail: e.detail ?? undefined,
      screenshot: e.screenshot ?? undefined,
      prompt: e.prompt ?? undefined,
      response: e.response ?? undefined,
      model: e.model ?? undefined,
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
