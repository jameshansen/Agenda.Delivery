"use client";

import { useEffect, useState, useCallback } from "react";

export type LiveEvent = {
  runId: string;
  moduleId?: string;
  agent: string;
  action: string;
  tool?: string;
  detail?: string;
  replayed?: boolean;
};

const PALETTE = [
  "bg-emerald-500",
  "bg-sky-500",
  "bg-amber-500",
  "bg-violet-500",
  "bg-rose-500",
];

function dotColor(agent: string) {
  let h = 0;
  for (const ch of agent) h = (h * 31 + ch.charCodeAt(0)) % PALETTE.length;
  return PALETTE[h];
}

/**
 * LiveAgentLog — connects to the SSE event stream and shows agent
 * activity in real-time. Also provides a "trigger run" button.
 */
export default function LiveAgentLog({
  moduleId,
  slug,
  initialEvents = [],
}: {
  moduleId: string;
  slug: string;
  initialEvents?: LiveEvent[];
}) {
  const [events, setEvents] = useState<LiveEvent[]>(initialEvents);
  const [connected, setConnected] = useState(false);
  const [running, setRunning] = useState(false);
  const [runType, setRunType] = useState<string>("scraper_create");
  const [statusMsg, setStatusMsg] = useState<string>("");

  // ── SSE connection (persistent, keyed by moduleId) ────────
  useEffect(() => {
    const url = `/api/agents/events?moduleId=${encodeURIComponent(moduleId)}`;
    console.log("[LiveAgentLog] Connecting SSE to", url);
    const es = new EventSource(url);

    es.onopen = () => {
      console.log("[LiveAgentLog] SSE connected");
      setConnected(true);
    };

    es.onerror = () => {
      console.log("[LiveAgentLog] SSE error (will auto-reconnect)");
      setConnected(false);
    };

    es.onmessage = (msg) => {
      try {
        const event: LiveEvent = JSON.parse(msg.data);
        console.log("[LiveAgentLog] SSE event:", event);

        if (event.replayed) {
          // Append DB-replayed events to the initial set.
          // We never replace all events — just append and cap at 50.
          setEvents((prev) => [...prev, event].slice(-50));
        } else {
          // Live event
          setEvents((prev) => [...prev, event].slice(-30));
          setRunning(true);
        }
      } catch {
        // heartbeat or non-JSON
      }
    };

    return () => {
      console.log("[LiveAgentLog] Closing SSE");
      es.close();
      setConnected(false);
    };
  }, [moduleId]);

  // ── Trigger a run ─────────────────────────────────────────
  const triggerRun = useCallback(async () => {
    setRunning(true);
    setStatusMsg("Starting agent…");
    setEvents([]);

    console.log("[LiveAgentLog] Triggering run:", runType, slug);

    try {
      const res = await fetch("/api/agents/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent: runType,
          slug,
          trigger: "manual",
        }),
      });
      const data = await res.json();
      console.log("[LiveAgentLog] Run response:", data);

      if (data.error) {
        setStatusMsg(`Error: ${data.error}`);
        setEvents([
          {
            runId: "error",
            agent: "System",
            action: `Error: ${data.error}`,
          },
        ]);
        setRunning(false);
        return;
      }

      setStatusMsg(`Agent started (runId: ${data.runId?.slice(0, 8)}…)`);
      // The SSE connection is already open on moduleId — live events
      // will stream in automatically. No need to open a new one.
    } catch (err) {
      console.error("[LiveAgentLog] Trigger failed:", err);
      setStatusMsg(`Request failed: ${err instanceof Error ? err.message : String(err)}`);
      setRunning(false);
    }
  }, [runType, slug]);

  return (
    <div>
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={runType}
          onChange={(e) => setRunType(e.target.value)}
          className="rounded-lg border border-black/10 bg-white/70 px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-green/30"
        >
          <option value="checking">Check for updates</option>
          <option value="scraper_create">Build scraper</option>
          <option value="scraper_repair">Repair scraper</option>
          <option value="summary">Regenerate summary</option>
          <option value="keyword">Refresh keyword summaries</option>
          <option value="full_pipeline">Full pipeline</option>
        </select>
        <button
          onClick={triggerRun}
          disabled={running}
          className="rounded-lg bg-green px-3 py-1 text-xs text-paper transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {running ? "Running…" : "▶ Run agent"}
        </button>
        <span className="ml-auto flex items-center gap-1.5 text-xs text-ink-soft">
          <span
            className={`h-2 w-2 rounded-full ${
              connected ? "bg-emerald-500 animate-pulse" : "bg-ink-soft/40"
            }`}
          />
          {connected ? "live" : "connecting"}
        </span>
      </div>

      {/* Status message */}
      {statusMsg && (
        <p className="mt-2 text-xs text-ink-soft">{statusMsg}</p>
      )}

      {/* Event stream */}
      <div className="mt-4 space-y-2">
        {events.length === 0 && (
          <p className="text-sm text-ink-soft">
            {running
              ? "Agent is starting…"
              : "No recent activity. Trigger a run to see agents work in real-time."}
          </p>
        )}
        {events.map((e, i) => {
          const isLast = i === events.length - 1;
          const working = isLast && running;
          return (
            <div
              key={`evt-${i}-${e.action.slice(0, 10)}`}
              className="animate-fade-up rounded-lg border border-black/5 bg-white/70 px-3 py-2 text-sm shadow-sm"
            >
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${dotColor(e.agent)}`} />
                <span className="font-semibold">{e.agent}</span>
                {working ? (
                  <span className="ml-auto flex items-center gap-1 text-xs text-ink-soft">
                    <span className="h-1.5 w-1.5 animate-ping rounded-full bg-ink-soft" />
                    working
                  </span>
                ) : (
                  <span className="ml-auto text-xs text-emerald-600">✓ done</span>
                )}
              </div>
              <p className="mt-1 text-ink">{e.action}</p>
              {e.tool && (
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <span className="rounded bg-ink/5 px-1.5 py-0.5 font-mono text-xs">
                    ⚙ {e.tool}
                  </span>
                  {e.detail && (
                    <span className="font-mono text-xs text-ink-soft">
                      {e.detail}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}