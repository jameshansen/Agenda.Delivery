import Link from "next/link";

type Item = {
  slug: string;
  name: string;
  latestMeetingDate: string | null;
  latestMeetingTitle: string | null;
};

/**
 * Vertical auto-scrolling ticker, bottom-to-top, pauses on hover.
 * Pure CSS (see .animate-scroll-up in globals.css) -- no JS/animation
 * library needed for a one-directional infinite loop.
 */
export default function RecentAgendasTicker({ items }: { items: Item[] }) {
  const durationSecs = Math.max(items.length * 4, 12);

  const row = (m: Item, key: string) => (
    <Link
      key={key}
      href={`/module/${m.slug}`}
      className="block rounded-lg bg-row px-3.5 py-2.5 transition-colors hover:bg-row-hover"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="truncate text-sm font-semibold">{m.name}</span>
        <span className="shrink-0 text-xs text-ink-soft">{m.latestMeetingDate}</span>
      </div>
      {m.latestMeetingTitle && (
        <div className="mt-0.5 truncate text-xs text-ink-soft/80">{m.latestMeetingTitle}</div>
      )}
    </Link>
  );

  return (
    <div className="relative h-64 overflow-hidden rounded-xl border border-black/8">
      <div
        className="animate-scroll-up absolute inset-x-0 top-0 space-y-2 p-2"
        style={{ animationDuration: `${durationSecs}s` }}
      >
        {items.map((m) => row(m, `a-${m.slug}`))}
        {items.map((m) => row(m, `b-${m.slug}`))}
      </div>
      {/* Fade the top/bottom edges so items don't hard-cut mid-scroll. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-paper to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-paper to-transparent" />
    </div>
  );
}
