"use client";

import { useEffect, useState, useRef } from "react";

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
 * AgentLogStream — read-only SSE viewer for a single module's agent activity.
 * No trigger buttons — agents are fired by the system, not the user.
 */
export default function AgentLogStream({
  moduleId,
  initialEvents = [],
}: {
  moduleId: string;
  initialEvents?: LiveEvent[];
}) {
  const [events, setEvents] = useState<LiveEvent[]>(initialEvents);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const url = `/api/agents/events?moduleId=${encodeURIComponent(moduleId)}`;
    const es = new EventSource(url);
    esRef.current = es;

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    es.onmessage = (msg) => {
      try {
        const event: LiveEvent = JSON.parse(msg.data);
        if (event.replayed) {
          // Append DB-replayed events — never replace the whole list.
          setEvents((prev) => [...prev, event].slice(-50));
        } else {
          setEvents((prev) => [...prev, event].slice(-30));
        }
      } catch {
        // heartbeat
      }
    };

    return () => {
      es.close();
      setConnected(false);
    };
  }, [moduleId]);

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs text-ink-soft">Agent activity</span>
        <span className="ml-auto flex items-center gap-1.5 text-xs text-ink-soft">
          <span
            className={`h-2 w-2 rounded-full ${
              connected ? "bg-emerald-500 animate-pulse" : "bg-ink-soft/40"
            }`}
          />
          {connected ? "live" : "connecting"}
        </span>
      </div>

      <div className="space-y-2">
        {events.length === 0 && (
          <p className="text-sm text-ink-soft">
            No recent activity. Agents run automatically — their work appears here in real-time.
          </p>
        )}
        {events.map((e, i) => (
          <div
            key={`evt-${i}-${e.action.slice(0, 10)}`}
            className="animate-fade-up rounded-lg border border-black/5 bg-white/70 px-3 py-2 text-sm shadow-sm"
          >
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${dotColor(e.agent)}`} />
              <span className="font-semibold">{e.agent}</span>
              <span className="ml-auto text-xs text-emerald-600">✓</span>
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
        ))}
      </div>
    </div>
  );
}