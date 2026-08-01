"use client";

import { useEffect, useState } from "react";

// Candidate councils the spider "discovers" live. Purely for the demo feed.
const POOL = [
  "District of North Vancouver, BC",
  "City of Surrey, BC",
  "Town of Gibsons, BC",
  "City of Coquitlam, BC",
  "District of Saanich, BC",
  "City of Kelowna, BC",
  "Town of Comox, BC",
  "City of Nanaimo, BC",
  "Township of Esquimalt, BC",
  "City of Calgary, AB",
  "City of Red Deer, AB",
  "City of Saskatoon, SK",
  "City of Winnipeg, MB",
  "City of Guelph, ON",
  "Town of Cochrane, AB",
  "Regional District of Nanaimo, BC",
];

const NOTES = [
  { tool: "site.discover", detail: "found council-meetings page" },
  { tool: "geo.locate", detail: "resolved to lat/lng for the map" },
  { tool: "queue.enqueue", detail: "handed to Scraper Create Agent" },
  { tool: "robots.check", detail: "crawl allowed, 1 req / 5s" },
];

type Item = { id: number; name: string; tool: string; detail: string };

export default function SpiderFeed() {
  const [items, setItems] = useState<Item[]>([]);
  const [found, setFound] = useState(212);
  const [queue, setQueue] = useState(7);
  const [scanned, setScanned] = useState(1483);

  useEffect(() => {
    let id = 0;
    const t = setInterval(() => {
      id += 1;
      const name = POOL[Math.floor(Math.random() * POOL.length)];
      const note = NOTES[Math.floor(Math.random() * NOTES.length)];
      setItems((xs) => [{ id, name, ...note }, ...xs].slice(0, 8));
      setFound((c) => c + 1);
      setScanned((s) => s + Math.floor(Math.random() * 40) + 10);
      setQueue((q) => Math.min(24, Math.max(1, q + (Math.random() > 0.45 ? 1 : -1))));
    }, 1900);
    return () => clearInterval(t);
  }, []);

  return (
    <div>
      <div className="grid grid-cols-3 gap-4">
        <Stat label="councils found" value={found} live />
        <Stat label="pages scanned" value={scanned} />
        <Stat label="in create queue" value={queue} />
      </div>

      <div className="mt-6 space-y-2">
        {items.length === 0 && (
          <p className="text-sm text-ink-soft">Spider warming up…</p>
        )}
        {items.map((it, i) => (
          <div
            key={it.id}
            className={`rounded-lg border border-black/5 bg-white/70 px-3 py-2 text-sm shadow-sm ${
              i === 0 ? "animate-fade-up" : ""
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-sky-500" />
              <span className="font-semibold">Spider Agent</span>
              <span className="ml-auto text-xs text-emerald-600">✓ queued</span>
            </div>
            <p className="mt-1">
              Discovered <strong>{it.name}</strong>
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <span className="rounded bg-ink/5 px-1.5 py-0.5 font-mono text-xs">
                ⚙ {it.tool}
              </span>
              <span className="font-mono text-xs text-ink-soft">{it.detail}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  live,
}: {
  label: string;
  value: number;
  live?: boolean;
}) {
  return (
    <div className="rounded-xl border border-black/5 bg-white/50 p-4">
      <div className="flex items-center gap-2">
        <span className="text-2xl font-semibold tabular-nums">
          {value.toLocaleString()}
        </span>
        {live && (
          <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
        )}
      </div>
      <div className="text-xs text-ink-soft">{label}</div>
    </div>
  );
}
