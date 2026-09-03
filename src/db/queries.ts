import { eq, asc, desc, sql, and, ilike, or, inArray, isNull } from "drizzle-orm";
import { db } from "./index";
import {
  modules,
  highlights,
  keywords,
  meetings,
  agentEvents,
  agentRuns,
  subscriptions,
  users,
  accounts,
  automationTargets,
  automationArtifacts,
  automationRules,
  mailingLists,
  mailingQueue,
  mailingListSubscribers,
  moduleKeywordOutputs,
  subscribers,
  emailTemplates,
  mergeFields,
  senderSettings,
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
  /** Broad entity kind: "council" or "organization". */
  govType: string;
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
    id: string;
    keyword: string;
    followers: number;
    related: string[];
    summary: string;
  }[];
  /** Keyword-artifact presets referenced by an action on this module, with
   * their latest generated summary (null until the action first fires). */
  keywordArtifacts: {
    id: string;
    name: string;
    keywords: string;
    summary: string | null;
  }[];
  meetings: { date: string; dateRaw: Date; title: string; kind: string; pages: number; pdfUrl: string | null; meetingUrl: string | null; summary: string | null }[];
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
  govTypes?: string[];
}): Promise<{ items: ModuleListItem[]; total: number; provinces: string[]; govTypes: string[] }> {
  const page = Math.max(1, opts.page ?? 1);
  const perPage = Math.min(100, Math.max(1, opts.perPage ?? 20));

  // Build WHERE conditions
  const conditions = [];
  if (opts.province) {
    conditions.push(ilike(modules.region, `%${opts.province}%`));
  }
  if (opts.govTypes && opts.govTypes.length > 0) {
    conditions.push(inArray(modules.govType, opts.govTypes));
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

  // Get distinct gov types for the filter checkboxes
  const govTypeRows = await db
    .select({ govType: modules.govType })
    .from(modules);
  const govTypes = [...new Set(govTypeRows.map((r) => r.govType))].sort();

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
      govType: m.govType,
    })),
    total: opts.lat != null ? filtered.length : Number(total),
    provinces,
    govTypes,
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
    govType: m.govType,
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

  // Keyword-artifact presets referenced by any action on this module. The
  // section only appears when at least one such action exists.
  const kwRows = await db
    .select({
      id: automationArtifacts.id,
      name: automationArtifacts.name,
      keywords: automationArtifacts.keywords,
      summary: moduleKeywordOutputs.summary,
    })
    .from(automationRules)
    .innerJoin(automationArtifacts, eq(automationRules.artifactId, automationArtifacts.id))
    .leftJoin(
      moduleKeywordOutputs,
      and(eq(moduleKeywordOutputs.artifactId, automationArtifacts.id), eq(moduleKeywordOutputs.moduleId, m.id)),
    )
    .where(and(eq(automationRules.moduleId, m.id), eq(automationArtifacts.kind, "keywords")));
  const kwSeen = new Set<string>();
  const keywordArtifacts = kwRows
    .filter((k) => (kwSeen.has(k.id) ? false : (kwSeen.add(k.id), true)))
    .map((k) => ({ id: k.id, name: k.name, keywords: k.keywords ?? "", summary: k.summary }));

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
    govType: m.govType,
    highlights: hs.map((h) => ({ tag: h.tag, text: h.text })),
    keywords: ks.map((k) => ({
      id: k.id,
      keyword: k.keyword,
      followers: k.followers,
      related: k.related,
      summary: k.summary,
    })),
    keywordArtifacts,
    meetings: mts.map((t) => ({
      date: fmtDate(t.date),
      dateRaw: t.date,
      title: t.title,
      kind: t.kind,
      pages: t.pages,
      pdfUrl: t.pdfUrl,
      meetingUrl: t.meetingUrl,
      summary: t.summary,
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

/** Everything the account page renders: the Subscriptions → Artifacts →
 * Actions flowchart, the mailing-list manager, and account/API settings. */
export async function getAccountData(userId: string) {
  const [
    [user],
    subs,
    targets,
    artifacts,
    rules,
    lists,
    queueCounts,
    subscriberRows,
    listMembers,
    templates,
    fieldRows,
    [sender],
    providers,
  ] = await Promise.all([
    db
      .select({ apiKeyPrefix: users.apiKeyPrefix, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.id, userId)),
    db
      .select({
        moduleId: subscriptions.moduleId,
        slug: modules.slug,
        name: modules.name,
        region: modules.region,
        channel: subscriptions.channel,
      })
      .from(subscriptions)
      .innerJoin(modules, eq(subscriptions.moduleId, modules.id))
      .where(eq(subscriptions.userId, userId))
      .orderBy(desc(subscriptions.createdAt)),
    db.select().from(automationTargets).where(eq(automationTargets.userId, userId)).orderBy(asc(automationTargets.createdAt)),
    db.select().from(automationArtifacts).where(eq(automationArtifacts.userId, userId)).orderBy(asc(automationArtifacts.createdAt)),
    db.select().from(automationRules).where(eq(automationRules.userId, userId)).orderBy(desc(automationRules.createdAt)),
    db.select().from(mailingLists).where(eq(mailingLists.userId, userId)).orderBy(asc(mailingLists.createdAt)),
    db
      .select({ listId: mailingQueue.listId, count: sql<number>`count(*)` })
      .from(mailingQueue)
      .where(sql`${mailingQueue.sentAt} IS NULL`)
      .groupBy(mailingQueue.listId),
    db.select().from(subscribers).where(eq(subscribers.userId, userId)).orderBy(asc(subscribers.createdAt)),
    // Membership rows for this account's lists only — the join keeps another
    // account's list ids out of the payload.
    db
      .select({ listId: mailingListSubscribers.listId, subscriberId: mailingListSubscribers.subscriberId })
      .from(mailingListSubscribers)
      .innerJoin(mailingLists, eq(mailingListSubscribers.listId, mailingLists.id))
      .where(eq(mailingLists.userId, userId)),
    // The user's own templates plus the shared built-in default (user_id NULL).
    db
      .select()
      .from(emailTemplates)
      .where(or(eq(emailTemplates.userId, userId), isNull(emailTemplates.userId))!)
      .orderBy(asc(emailTemplates.userId), asc(emailTemplates.createdAt)),
    db.select().from(mergeFields).where(eq(mergeFields.userId, userId)).orderBy(asc(mergeFields.label)),
    db.select().from(senderSettings).where(eq(senderSettings.userId, userId)),
    // Which sign-in providers are linked, so the settings tab can say whether
    // the account is a Google one or an email-code one.
    db.select({ provider: accounts.provider }).from(accounts).where(eq(accounts.userId, userId)),
  ]);

  // Dedupe subscriptions by module (a user may have both an email + text row).
  const subByModule = new Map<string, (typeof subs)[number]>();
  for (const s of subs) if (!subByModule.has(s.moduleId)) subByModule.set(s.moduleId, s);

  const queued: Record<string, number> = {};
  for (const q of queueCounts) queued[q.listId] = Number(q.count);

  const membersByList: Record<string, string[]> = {};
  for (const m of listMembers) (membersByList[m.listId] ??= []).push(m.subscriberId);

  return {
    apiKeyPrefix: user?.apiKeyPrefix ?? null,
    profile: {
      name: user?.name ?? "",
      email: user?.email ?? "",
      providers: providers.map((p) => p.provider),
    },
    subscriptions: [...subByModule.values()],
    targets: targets.map((t) => ({ id: t.id, kind: t.kind, name: t.name, url: t.url })),
    artifacts: artifacts.map((a) => ({ id: a.id, kind: a.kind, name: a.name, promptText: a.promptText, keywords: a.keywords })),
    rules: rules.map((r) => ({
      id: r.id,
      moduleId: r.moduleId,
      trigger: r.trigger,
      artifactId: r.artifactId,
      contentMode: r.contentMode,
      actionKind: r.actionKind,
      targetId: r.targetId,
      listId: r.listId,
    })),
    mailingLists: lists.map((l) => ({
      id: l.id,
      name: l.name,
      header: l.header,
      footer: l.footer,
      sendPolicy: l.sendPolicy,
      threshold: l.threshold,
      weekday: l.weekday,
      monthDay: l.monthDay,
      audience: l.audience,
      templateId: l.templateId,
      subscriberIds: membersByList[l.id] ?? [],
      queued: queued[l.id] ?? 0,
      lastSentAt: fmtDate(l.lastSentAt),
    })),
    subscribers: subscriberRows.map((s) => ({
      id: s.id,
      email: s.email,
      name: s.name,
      status: s.status,
      fields: (s.fields ?? {}) as Record<string, string>,
      createdAt: fmtDate(s.createdAt),
    })),
    templates: templates.map((t) => ({
      id: t.id,
      name: t.name,
      html: t.html,
      isDefault: t.userId === null,
    })),
    mergeFields: fieldRows.map((f) => ({ key: f.key, label: f.label, value: f.value })),
    sender: {
      provider: sender?.provider ?? "default",
      fromEmail: sender?.fromEmail ?? "",
      fromName: sender?.fromName ?? "",
      // Secrets are never sent to the browser; the UI only needs to know
      // whether one is already on file.
      hasSendgridKey: Boolean(sender?.sendgridKey),
      hasSmtpPass: Boolean(sender?.smtpPass),
      smtpHost: sender?.smtpHost ?? "",
      smtpPort: sender?.smtpPort ?? 587,
      smtpUser: sender?.smtpUser ?? "",
      smtpSecure: sender?.smtpSecure ?? true,
    },
  };
}

export type AccountData = Awaited<ReturnType<typeof getAccountData>>;
