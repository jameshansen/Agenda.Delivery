"use client";

import { useEffect, useState, useRef } from "react";

type LiveEvent = {
  runId: string;
  moduleId?: string;
  agent: string;
  action: string;
  tool?: string;
  detail?: string;
  replayed?: boolean;
};

type ScheduleEntry = {
  agent: string;
  displayName: string;
  scheduleSecs: number | null;
  enabled: boolean;
};

/** Human-friendly cadence label from a seconds interval. */
function cadence(secs: number | null): string {
  if (secs == null) return "on trigger";
  if (secs % 3600 === 0) return `every ${secs / 3600}h`;
  if (secs % 60 === 0) return `every ${secs / 60}m`;
  return `every ${secs}s`;
}

const AGENTS = [
  { key: "Spider Agent", short: "Spider", desc: "Discovers new councils and organizations", color: "bg-emerald-500" },
  { key: "Scraper Agent", short: "Scraper Create", desc: "Builds scraping configs for new sources", color: "bg-sky-500" },
  { key: "Scraper Repair Agent", short: "Scraper Repair", desc: "Self-heals broken scrapers", color: "bg-amber-500" },
  { key: "Checking Agent", short: "Checking", desc: "Polls sources for new agendas", color: "bg-violet-500" },
  { key: "Summary Agent", short: "Summary", desc: "Generates AI summaries and highlights", color: "bg-rose-500" },
  { key: "Keyword Agent", short: "Keyword", desc: "Bespoke per-keyword summaries", color: "bg-teal-500" },
  { key: "Categorization Agent", short: "Categorization", desc: "Classifies agenda type", color: "bg-orange-500" },
];

/**
 * AgentsPage — full-page view showing all 7 agents as vertical columns.
 * Each column streams events in real-time via a single SSE connection
 * to /api/agents/events (no moduleId filter — we get everything).
 *
 * This is the "mission control" view — pure transparency. No buttons,
 * no user triggers. Just the agents working in the open.
 */
export default function AgentsPage() {
  const [columns, setColumns] = useState<Record<string, LiveEvent[]>>({});
  const [connected, setConnected] = useState(false);
  const [totalEvents, setTotalEvents] = useState(0);
  const [schedule, setSchedule] = useState<ScheduleEntry[]>([]);
  const [schedulerUp, setSchedulerUp] = useState(false);
  const [queued, setQueued] = useState(0);
  const esRef = useRef<EventSource | null>(null);

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

  useEffect(() => {
    // Connect to the global SSE stream (no moduleId = all events)
    const es = new EventSource("/api/agents/events");
    esRef.current = es;

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    es.onmessage = (msg) => {
      try {
        const event: LiveEvent = JSON.parse(msg.data);

        // Route the event to the right agent column
        setColumns((prev) => {
          const col = prev[event.agent] ?? [];
          return {
            ...prev,
            [event.agent]: [...col, event].slice(-15),
          };
        });
        setTotalEvents((n) => n + 1);
      } catch {
        // heartbeat
      }
    };

    return () => {
      es.close();
      setConnected(false);
    };
  }, []);

  return (
    <main className="mx-auto w-full max-w-7xl px-6 py-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <h1 className="text-3xl sm:text-4xl">Agents</h1>
        <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-sm text-emerald-700">
          <span
            className={`h-2 w-2 rounded-full ${
              connected ? "bg-emerald-500 animate-pulse" : "bg-ink-soft/40"
            }`}
          />
          {connected ? "live" : "connecting"}
        </span>
        <span className="text-sm text-ink-soft">
          {totalEvents} events streamed
        </span>
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

      {/* Agent columns */}
      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-7">
        {AGENTS.map((agent) => {
          const events = columns[agent.key] ?? [];
          return (
            <div
              key={agent.key}
              className="flex flex-col rounded-xl border border-black/10 bg-paper/60 p-3"
              style={{ minHeight: "400px" }}
            >
              {/* Column header */}
              <div className="mb-3 border-b border-black/5 pb-2">
                <div className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${agent.color}`} />
                  <span className="font-semibold text-sm">{agent.short}</span>
                </div>
                <p className="mt-1 text-xs text-ink-soft">{agent.desc}</p>
                <p className="mt-1 text-xs tabular-nums text-ink-soft/60">
                  {events.length} event{events.length !== 1 ? "s" : ""}
                </p>
              </div>

              {/* Events */}
              <div className="flex-1 space-y-1.5 overflow-hidden">
                {events.length === 0 ? (
                  <p className="text-xs text-ink-soft/50">
                    Waiting for activity…
                  </p>
                ) : (
                  events.map((e, i) => (
                    <div
                      key={`evt-${i}-${e.action.slice(0, 8)}`}
                      className="animate-fade-up rounded-lg border border-black/5 bg-white/70 px-2.5 py-1.5 text-xs shadow-sm"
                    >
                      <p className="text-ink leading-snug">{e.action}</p>
                      {e.tool && (
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          <span className="rounded bg-ink/5 px-1 py-0.5 font-mono text-[10px]">
                            ⚙ {e.tool}
                          </span>
                        </div>
                      )}
                      {e.detail && (
                        <p className="mt-0.5 font-mono text-[10px] text-ink-soft leading-tight">
                          {e.detail}
                        </p>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}