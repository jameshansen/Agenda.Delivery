"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";

type LiveEvent = {
  runId: string;
  moduleId?: string;
  agent: string;
  action: string;
  tool?: string;
  detail?: string;
  screenshot?: string;
  prompt?: string;
  response?: string;
  model?: string;
  /** Real DB timestamp -- present on replayed/paginated events, absent on
   * freshly-live ones (which use the client-side `ts` below instead). Used
   * as the infinite-scroll cursor: always look for it among the oldest
   * loaded events, which are always replayed/paginated, never live. */
  createdAt?: string;
  replayed?: boolean;
  ts: number;
};

type ScheduleEntry = {
  agent: string;
  displayName: string;
  scheduleSecs: number | null;
  enabled: boolean;
};

/** Local clock time for an event bubble. Uses the real DB timestamp when
 * present (replayed/paginated events), else the client arrival time. */
function eventTime(e: { createdAt?: string; ts: number }): string {
  const d = e.createdAt ? new Date(e.createdAt) : new Date(e.ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** Human-friendly cadence label from a seconds interval. */
function cadence(secs: number | null): string {
  if (secs == null) return "on trigger";
  if (secs % 3600 === 0) return `every ${secs / 3600}h`;
  if (secs % 60 === 0) return `every ${secs / 60}m`;
  return `every ${secs}s`;
}

const AGENTS = [
  { key: "Spider Agent", short: "Spider", desc: "Discovers new councils and organizations", dot: "bg-emerald-500", pill: "bg-emerald-500 text-white" },
  { key: "Scraper Agent", short: "Scraper Create", desc: "Builds scraping configs for new sources", dot: "bg-sky-500", pill: "bg-sky-500 text-white" },
  { key: "Scraper Repair Agent", short: "Scraper Repair", desc: "Self-heals broken scrapers", dot: "bg-amber-500", pill: "bg-amber-500 text-white" },
  { key: "Checking Agent", short: "Checking", desc: "Polls sources for new agendas", dot: "bg-violet-500", pill: "bg-violet-500 text-white" },
  { key: "Summary Agent", short: "Summary", desc: "Generates AI summaries and highlights", dot: "bg-rose-500", pill: "bg-rose-500 text-white" },
  { key: "Keyword Agent", short: "Keyword", desc: "Bespoke per-keyword summaries", dot: "bg-teal-500", pill: "bg-teal-500 text-white" },
  { key: "Categorization Agent", short: "Categorization", desc: "Classifies agenda type", dot: "bg-orange-500", pill: "bg-orange-500 text-white" },
] as const;

/** Icon + color per known `tool` value. Events with no tool (lifecycle
 * steps like "Task started by X") fall back to a neutral flag icon. */
const TOOL_META: Record<string, { icon: string; color: string; label: string }> = {
  "agenda.find_latest": { icon: "fa-bullseye", color: "text-orange-600", label: "find latest" },
  "browser.nav": { icon: "fa-globe", color: "text-sky-600", label: "browser nav" },
  "db.save_config": { icon: "fa-database", color: "text-purple-600", label: "save config" },
  "geo.locate": { icon: "fa-location-dot", color: "text-amber-600", label: "geolocate" },
  "llm.highlights": { icon: "fa-wand-magic-sparkles", color: "text-rose-600", label: "highlights" },
  "llm.repair": { icon: "fa-wand-magic-sparkles", color: "text-amber-600", label: "repair" },
  "llm.summarize": { icon: "fa-brain", color: "text-violet-600", label: "summarize" },
  "queue.enqueue": { icon: "fa-list-ol", color: "text-slate-500", label: "enqueue" },
  "s3.put": { icon: "fa-cloud-arrow-up", color: "text-sky-500", label: "store" },
  "schedule.predict": { icon: "fa-clock", color: "text-indigo-600", label: "schedule" },
  "site.crawl": { icon: "fa-spider", color: "text-emerald-600", label: "crawl" },
  "verify.selfcheck": { icon: "fa-shield-halved", color: "text-teal-600", label: "self-check" },
  "web.search": { icon: "fa-magnifying-glass", color: "text-cyan-600", label: "web search" },
};
const DEFAULT_TOOL_META = { icon: "fa-flag", color: "text-ink-soft", label: "" };

/** Which Ollama model actually served an LLM-call step. No real provider
 * logos here (no assets, and reproducing brand marks isn't appropriate) --
 * each gets a small abstract monogram chip instead, colored in the
 * general spirit of the provider's brand without copying it. Matched by
 * prefix since tags vary ("glm-5.2" has no tag, "gemma4:31b" and
 * "deepseek-v4-flash:0731" do). */
const MODEL_META: { prefix: string; label: string; glyph: string; chip: string; text: string }[] = [
  { prefix: "glm", label: "GLM 5.2", glyph: "Z", chip: "bg-blue-600", text: "text-blue-700" },
  { prefix: "gemma4", label: "Gemma", glyph: "G", chip: "bg-violet-500", text: "text-violet-700" },
  { prefix: "deepseek", label: "DeepSeek", glyph: "D", chip: "bg-indigo-600", text: "text-indigo-700" },
];

function modelMeta(model: string | undefined) {
  if (!model) return null;
  const prefix = model.split(":")[0].toLowerCase();
  return MODEL_META.find((m) => prefix.startsWith(m.prefix)) ?? null;
}

/** Tiny, ~8px-tall badge: monogram chip + model name, under the tool badge.
 * Non-LLM steps (db.save_config, s3.put, lifecycle events, ...) have no
 * model -- render a neutral "Action" badge instead of nothing, so every
 * event gets this row and the log doesn't jump around vertically. */
function ModelBadge({ model }: { model?: string }) {
  const meta = modelMeta(model);
  if (!model || !meta) {
    return (
      <span className="inline-flex h-[14px] items-center gap-1 rounded-sm bg-ink/5 px-1">
        <span className="grid h-[9px] w-[9px] shrink-0 place-items-center rounded-[2px] bg-ink-soft/50 text-white">
          <i className="fa-solid fa-bolt text-[7px]" />
        </span>
        <span className="text-[9px] font-medium leading-none whitespace-nowrap text-ink-soft">Action</span>
      </span>
    );
  }
  return (
    <span className="inline-flex h-[14px] items-center gap-1 rounded-sm bg-ink/5 px-1" title={`Served by ${model}`}>
      <span className={`grid h-[9px] w-[9px] shrink-0 place-items-center rounded-[2px] text-white ${meta.chip}`}>
        <span className="text-[8px] font-bold leading-none">{meta.glyph}</span>
      </span>
      <span className={`text-[9px] font-medium leading-none whitespace-nowrap ${meta.text}`}>{meta.label}</span>
    </span>
  );
}

const MAX_PER_AGENT_MINI = 15;

function agentMeta(name: string) {
  return AGENTS.find((a) => a.key === name);
}

/** One row in Combined Log mode -- tool icon, screenshot, expandable prompt/response. */
function EventRow({ event }: { event: LiveEvent }) {
  const [expanded, setExpanded] = useState(false);
  const meta = agentMeta(event.agent);
  const toolMeta = event.tool ? (TOOL_META[event.tool] ?? { ...DEFAULT_TOOL_META, label: event.tool }) : DEFAULT_TOOL_META;
  const hasPromptResponse = Boolean(event.prompt || event.response);

  return (
    <div className="rounded-lg border border-black/5 bg-white/70 px-4 py-3.5 shadow-sm transition-colors hover:bg-row-hover">
      <div className="flex items-start gap-3">
        <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${meta?.dot ?? "bg-ink-soft/40"}`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-semibold text-ink">{event.agent}</span>
            {event.tool && (
              <span className={`inline-flex items-center gap-1 rounded-full bg-ink/5 px-2 py-0.5 text-xs font-medium ${toolMeta.color}`}>
                <i className={`fa-solid ${toolMeta.icon} text-[10px]`} />
                {toolMeta.label}
              </span>
            )}
          </div>

          <div className="-mt-1.5">
            <ModelBadge model={event.model} />
          </div>

          <p className="mt-1 text-sm text-ink">{event.action}</p>

          {event.detail && (
            <p className="mt-0.5 break-words font-mono text-xs text-ink-soft">{event.detail}</p>
          )}

          {event.screenshot && (
            // eslint-disable-next-line @next/next/no-img-element -- data URI, no next/image optimization to gain
            <img
              src={event.screenshot}
              alt={`Browser view: ${event.action}`}
              className="mt-2 w-full max-w-xs rounded-lg border border-black/10"
            />
          )}

          {hasPromptResponse && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-green hover:text-green-dark"
            >
              <i className={`fa-solid ${expanded ? "fa-chevron-down" : "fa-chevron-right"} text-[10px]`} />
              {`${expanded ? "Hide" : "View"} full prompt & response`}
            </button>
          )}

          {expanded && hasPromptResponse && (
            <div className="mt-2 space-y-2">
              {event.prompt && (
                <div>
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-soft">Prompt</div>
                  <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-field p-3 font-mono text-xs text-ink">
                    {event.prompt}
                  </pre>
                </div>
              )}
              {event.response && (
                <div>
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-soft">Response</div>
                  <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-field p-3 font-mono text-xs text-ink">
                    {event.response}
                  </pre>
                </div>
              )}
            </div>
          )}

          <div className="mt-1 text-right text-[10px] text-ink-soft/60">{eventTime(event)}</div>
        </div>
      </div>
    </div>
  );
}

/**
 * AgentsPage — "combined log" (default) or "mini mode" (7-column grid),
 * both fed by a single global SSE connection to /api/agents/events.
 * Pure transparency: no user triggers, just the agents working in the open.
 */
export default function AgentsPage() {
  const [mode, setMode] = useState<"combined" | "mini">("combined");
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [columns, setColumns] = useState<Record<string, LiveEvent[]>>({});
  const [connected, setConnected] = useState(false);
  const [enabledAgents, setEnabledAgents] = useState<Set<string>>(() => new Set(AGENTS.map((a) => a.key)));
  const [schedule, setSchedule] = useState<ScheduleEntry[]>([]);
  const [schedulerUp, setSchedulerUp] = useState(false);
  const [queued, setQueued] = useState(0);

  // ── Infinite scroll (Combined Log only -- Mini Mode is unaffected) ────
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // ── Fetch scheduler state ─────────────────────────────
  useEffect(() => {
    const fetchSchedule = async () => {
      try {
        const res = await fetch("/api/schedule");
        const data = await res.json();
        setSchedule(data.entries ?? []);
        setSchedulerUp(Boolean(data.running));
        setQueued(data.queued ?? 0);
      } catch {}
    };
    fetchSchedule();
    const scheduleTimer = setInterval(fetchSchedule, 30_000);
    return () => clearInterval(scheduleTimer);
  }, []);

  // ── Global SSE stream (no moduleId = all events) ──────
  useEffect(() => {
    const es = new EventSource("/api/agents/events");

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    es.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data) as Omit<LiveEvent, "ts">;
        const event: LiveEvent = { ...data, ts: Date.now() };

        // No cap here (unlike Mini Mode's per-column cap below) -- capping
        // would trim from the front on every live tick, silently deleting
        // the older history infinite-scroll just paginated in.
        setEvents((prev) => [...prev, event]);
        setColumns((prev) => {
          const col = prev[event.agent] ?? [];
          return { ...prev, [event.agent]: [...col, event].slice(-MAX_PER_AGENT_MINI) };
        });
      } catch {
        // heartbeat
      }
    };

    return () => {
      es.close();
      setConnected(false);
    };
  }, []);

  // ── Infinite scroll: fetch older events once the sentinel at the
  // bottom of the Combined Log comes into view ───────────────────
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    // events[] is ascending (oldest first) -- the oldest loaded event
    // with a real DB timestamp (replayed/paginated, never a bare live
    // one) is the cursor for "give me events older than this".
    const oldest = events.find((e) => e.createdAt);
    if (!oldest?.createdAt) return;
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/agents/history?before=${encodeURIComponent(oldest.createdAt)}&limit=30`);
      const data = await res.json();
      const older: LiveEvent[] = ((data.events ?? []) as Omit<LiveEvent, "ts">[])
        .map((e) => ({ ...e, ts: 0 }))
        .reverse();
      setEvents((prev) => [...older, ...prev]);
      setHasMore(Boolean(data.hasMore));
    } catch {
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }, [events, loadingMore, hasMore]);

  useEffect(() => {
    if (mode !== "combined") return;
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMore();
      },
      { rootMargin: "600px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [mode, loadMore]);

  const toggleAgent = useCallback((key: string) => {
    setEnabledAgents((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const filteredEvents = useMemo(
    () => events.filter((e) => enabledAgents.has(e.agent)).slice().reverse(),
    [events, enabledAgents],
  );

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-8">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl sm:text-4xl">Agents</h1>
        <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-sm text-emerald-700">
          <span className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-500 animate-pulse" : "bg-ink-soft/40"}`} />
          {connected ? "live" : "connecting"}
        </span>
        <span className="text-sm text-ink-soft">{events.length} events streamed</span>

        {/* Mode toggle */}
        <div className="ml-auto flex items-center gap-1 rounded-lg border border-black/10 bg-field p-1">
          <button
            onClick={() => setMode("combined")}
            className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
              mode === "combined" ? "bg-green text-paper" : "text-ink-soft hover:text-ink"
            }`}
          >
            <i className="fa-solid fa-list-ul mr-1.5 text-xs" />
            Combined Log
          </button>
          <button
            onClick={() => setMode("mini")}
            className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
              mode === "mini" ? "bg-green text-paper" : "text-ink-soft hover:text-ink"
            }`}
          >
            <i className="fa-solid fa-table-columns mr-1.5 text-xs" />
            Mini Mode
          </button>
        </div>
      </div>
      <p className="mt-2 text-ink-soft">
        Every agent in the system, working in real-time. No user triggers —
        the agents run autonomously. This is full transparency into how
        agenda.delivery works.
      </p>

      {/* Scheduler status (from the orchestrator) */}
      {schedule.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-4 rounded-xl border border-black/10 bg-white/50 p-3 text-sm">
          <span className="flex items-center gap-1.5 font-semibold text-ink">
            <span className={`h-2 w-2 rounded-full ${schedulerUp ? "bg-emerald-500 animate-pulse" : "bg-ink-soft/30"}`} />
            Orchestrator {schedulerUp ? "active" : "offline"}
          </span>
          {queued > 0 && (
            <span className="text-xs text-ink-soft">{queued} job{queued !== 1 ? "s" : ""} queued</span>
          )}
          {schedule.map((s) => (
            <span key={s.agent} className="flex items-center gap-1.5 text-ink-soft">
              <span className={`h-1.5 w-1.5 rounded-full ${s.enabled ? "bg-emerald-500" : "bg-ink-soft/30"}`} />
              {s.displayName} <span className="text-xs">({cadence(s.scheduleSecs)})</span>
              {!s.enabled && <span className="text-xs text-ink-soft/50">paused</span>}
            </span>
          ))}
        </div>
      )}

      {/* ===================== Combined Log ===================== */}
      {mode === "combined" && (
        <div className="mt-6">
          {/* Agent filter pills */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-xs font-semibold uppercase tracking-wide text-ink-soft">Filter:</span>
            {AGENTS.map((agent) => {
              const active = enabledAgents.has(agent.key);
              return (
                <button
                  key={agent.key}
                  onClick={() => toggleAgent(agent.key)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    active ? `border-transparent ${agent.pill}` : "border-black/10 text-ink-soft hover:border-black/20"
                  }`}
                >
                  <span className={`h-2 w-2 rounded-full ${active ? "bg-white/80" : agent.dot}`} />
                  {agent.short}
                </button>
              );
            })}
            <span className="ml-auto text-xs text-ink-soft">{filteredEvents.length} shown</span>
          </div>

          {/* Log list -- plain page flow, no scrollable container. Older
              events load in as the sentinel below comes into view. */}
          <div className="mt-3">
            {filteredEvents.length === 0 ? (
              <div className="px-4 py-16 text-center text-ink-soft">
                <p className="text-sm">Waiting for agent activity…</p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredEvents.map((evt, i) => <EventRow key={`${evt.runId}-${evt.ts}-${i}`} event={evt} />)}
              </div>
            )}

            <div ref={sentinelRef} className="flex items-center justify-center py-6">
              {loadingMore ? (
                <span className="text-xs text-ink-soft">
                  <i className="fa-solid fa-circle-notch fa-spin mr-1.5" />
                  loading more…
                </span>
              ) : !hasMore && filteredEvents.length > 0 ? (
                <span className="text-xs text-ink-soft/60">— start of history —</span>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* ===================== Mini Mode ===================== */}
      {mode === "mini" && (
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-7">
          {AGENTS.map((agent) => {
            const agentEvents = columns[agent.key] ?? [];
            return (
              <div
                key={agent.key}
                className="flex flex-col rounded-xl border border-black/10 bg-paper/60 p-3"
                style={{ minHeight: "400px" }}
              >
                <div className="mb-3 border-b border-black/5 pb-2">
                  <div className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${agent.dot}`} />
                    <span className="font-semibold text-sm">{agent.short}</span>
                  </div>
                  <p className="mt-1 text-xs text-ink-soft">{agent.desc}</p>
                  <p className="mt-1 text-xs tabular-nums text-ink-soft/60">
                    {agentEvents.length} event{agentEvents.length !== 1 ? "s" : ""}
                  </p>
                </div>

                <div className="flex-1 space-y-1.5 overflow-hidden">
                  {agentEvents.length === 0 ? (
                    <p className="text-xs text-ink-soft/50">Waiting for activity…</p>
                  ) : (
                    agentEvents.map((e, i) => {
                      const toolMeta = e.tool ? (TOOL_META[e.tool] ?? DEFAULT_TOOL_META) : DEFAULT_TOOL_META;
                      return (
                        <div
                          key={`evt-${i}-${e.action.slice(0, 8)}`}
                          className="animate-fade-up rounded-lg border border-black/5 bg-white/70 px-2.5 py-1.5 text-xs shadow-sm"
                        >
                          <p className="text-ink leading-snug">{e.action}</p>
                          {e.tool && (
                            <div className="mt-1 flex flex-wrap items-center gap-1">
                              <span className={`inline-flex items-center gap-1 rounded bg-ink/5 px-1 py-0.5 font-mono text-[10px] ${toolMeta.color}`}>
                                <i className={`fa-solid ${toolMeta.icon}`} />
                                {e.tool}
                              </span>
                            </div>
                          )}
                          <div className="-mt-1.5">
                            <ModelBadge model={e.model} />
                          </div>
                          {e.detail && (
                            <p className="mt-0.5 font-mono text-[10px] text-ink-soft leading-tight">{e.detail}</p>
                          )}
                          {e.screenshot && (
                            // eslint-disable-next-line @next/next/no-img-element -- data URI, no next/image optimization to gain
                            <img
                              src={e.screenshot}
                              alt={`Browser view: ${e.action}`}
                              className="mt-1 w-full rounded border border-black/10"
                            />
                          )}
                          <div className="mt-1 text-right text-[9px] text-ink-soft/60">{eventTime(e)}</div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
