"use client";

import { useEffect, useState, useRef } from "react";

type LiveEvent = {
  runId: string;
  agent: string;
  action: string;
  tool?: string;
  detail?: string;
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
 * LiveSpiderFeed — real-time spider agent activity.
 *
 * The spider has no moduleId, so we use a two-step approach:
 * 1. POST /api/agents/run to start the run (returns runId)
 * 2. GET /api/agents/events?runId=... to stream events for that run
 *
 * We also keep a global SSE listener open that catches spider events
 * keyed by a "spider" pseudo-moduleId.
 */
export default function LiveSpiderFeed() {
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [running, setRunning] = useState(false);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  async function triggerSpider() {
    setRunning(true);
    setEvents([]);

    try {
      // POST to start the run — returns runId immediately
      const res = await fetch("/api/agents/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent: "spider", trigger: "manual" }),
      });
      const data = await res.json();

      if (data.error) {
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

      // Connect SSE to the runId
      const runId = data.runId;
      if (esRef.current) esRef.current.close();

      const es = new EventSource(
        `/api/agents/events?runId=${encodeURIComponent(runId)}`,
      );
      esRef.current = es;

      es.onopen = () => setConnected(true);
      es.onerror = () => setConnected(false);

      es.onmessage = (msg) => {
        try {
          const event: LiveEvent = JSON.parse(msg.data);
          setEvents((prev) => [...prev, event].slice(-15));
        } catch {
          // heartbeat
        }
      };

      // The run is async — keep connection open for up to 2 minutes
      setTimeout(() => {
        setRunning(false);
        setConnected(false);
        es.close();
      }, 120_000);
    } catch (err) {
      setEvents([
        {
          runId: "error",
          agent: "System",
          action: `Request failed: ${err instanceof Error ? err.message : String(err)}`,
        },
      ]);
      setRunning(false);
    }
  }

  useEffect(() => {
    return () => esRef.current?.close();
  }, []);

  return (
    <div>
      <div className="flex items-center gap-3">
        <button
          onClick={triggerSpider}
          disabled={running}
          className="rounded-lg bg-green px-4 py-2 text-sm text-paper transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {running ? "Spider running…" : "▶ Launch spider"}
        </button>
        <span className="flex items-center gap-1.5 text-xs text-ink-soft">
          <span
            className={`h-2 w-2 rounded-full ${
              connected ? "bg-emerald-500 animate-pulse" : "bg-ink-soft/40"
            }`}
          />
          {connected ? "connected" : "idle"}
        </span>
      </div>

      <div className="mt-6 space-y-2">
        {events.length === 0 && (
          <p className="text-sm text-ink-soft">
            {running
              ? "Spider is warming up…"
              : 'Click "Launch spider" to watch the agent discover new councils in real-time.'}
          </p>
        )}
        {events.map((e, i) => {
          const isLast = i === events.length - 1;
          const working = isLast && running;
          return (
            <div
              key={`${e.agent}-${i}-${e.action.slice(0, 20)}`}
              className={`rounded-lg border border-black/5 bg-white/70 px-3 py-2 text-sm shadow-sm ${
                i === 0 ? "animate-fade-up" : ""
              }`}
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
              <p className="mt-1">{e.action}</p>
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