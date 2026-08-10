"use client";

import { useEffect, useState } from "react";

type AgentEvent = { agent: string; action: string; tool?: string; detail?: string; screenshot?: string };

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
 * Reveals a completed agent run one bubble at a time, like an agentic
 * coding assistant streaming its tool calls. The last visible bubble shows a
 * "working…" state until the next one appears; once all are shown they're done.
 */
export default function AgentLog({
  events,
  interval = 950,
}: {
  events: AgentEvent[];
  interval?: number;
}) {
  const [n, setN] = useState(1);

  useEffect(() => {
    if (n >= events.length) return;
    const id = setTimeout(() => setN((k) => k + 1), interval);
    return () => clearTimeout(id);
  }, [n, events.length, interval]);

  const done = n >= events.length;

  return (
    <div className="space-y-2">
      {events.slice(0, n).map((e, i) => {
        const isLast = i === n - 1;
        const working = isLast && !done;
        return (
          <div
            key={i}
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
            {e.screenshot && (
              // eslint-disable-next-line @next/next/no-img-element -- data URI, no next/image optimization to gain
              <img
                src={e.screenshot}
                alt={`Browser view: ${e.action}`}
                className="mt-2 w-full max-w-xs rounded-lg border border-black/10"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
