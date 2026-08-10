import Link from "next/link";
import RotatingWord from "@/components/RotatingWord";
import GeoLocate from "@/components/GeoLocate";
import AutoSubmitSelect from "@/components/AutoSubmitSelect";
import { getModulesPaged } from "@/db/queries";
import type { Health } from "@/db/queries";

export const dynamic = "force-dynamic";

const HEALTH_BADGE: Record<Health, { label: string; dotClassName: string }> = {
  healthy: { label: "healthy", dotClassName: "bg-emerald-500" },
  repairing: { label: "repairing", dotClassName: "bg-amber-500" },
  broken: { label: "broken", dotClassName: "bg-rose-500" },
};

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    province?: string;
    near?: string;
    q?: string;
  }>;
}) {
  const sp = await searchParams;
  const page = parseInt(sp.page ?? "1", 10) || 1;
  const province = sp.province;
  const query = sp.q;
  const near = sp.near;

  // Parse "near" param (lat,lng)
  let lat: number | undefined;
  let lng: number | undefined;
  if (near) {
    const [la, lo] = near.split(",").map(parseFloat);
    if (!isNaN(la) && !isNaN(lo)) {
      lat = la;
      lng = lo;
    }
  }

  const { items, total, provinces } = await getModulesPaged({
    page,
    perPage: 100,
    province: province && province !== "all" ? province : undefined,
    query,
    lat,
    lng,
    radiusKm: lat != null ? 200 : undefined, // 200km default radius
  });

  // Health breakdown for the overview strip -- real counts, not decoration.
  const healthCounts = { healthy: 0, repairing: 0, broken: 0 } as Record<Health, number>;
  for (const m of items) healthCounts[m.health]++;

  // Most recently updated councils across the whole (unfiltered-by-region) result set.
  const recentActivity = [...items]
    .filter((m) => m.latestMeetingDate)
    .sort((a, b) => (a.latestMeetingDate! < b.latestMeetingDate! ? 1 : -1))
    .slice(0, 8);

  // Group by province; the province with the most councils opens expanded,
  // the rest collapse under <details> so a handful of out-of-region finds
  // (e.g. the Spider Agent turning up a council outside BC) don't dilute
  // the primary list.
  const groups = new Map<string, typeof items>();
  for (const m of items) {
    const list = groups.get(m.province) ?? [];
    list.push(m);
    groups.set(m.province, list);
  }
  const sortedGroups = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);

  return (
    <main className="flex-1 w-full">
      {/* Hero */}
      <section className="px-6 pt-16 pb-12 text-center sm:pt-24">
        <h1 className="text-6xl tracking-tight sm:text-7xl">
          <span className="text-green-dark">agenda</span>
          <span className="text-green">.delivery</span>
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-xl text-ink sm:text-2xl">
          never miss an update from your local <RotatingWord />
        </p>

        {/* Search */}
        <form
          action="/"
          method="get"
          className="mx-auto mt-10 flex max-w-xl items-center gap-2 rounded-full border border-black/10 bg-white/70 p-2 pl-5 shadow-sm transition-colors focus-within:border-green/50"
          role="search"
        >
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className="h-5 w-5 shrink-0 text-ink-soft"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            name="q"
            defaultValue={query}
            aria-label="Search agendas"
            placeholder="Search councils, committees, organizations…"
            className="flex-1 bg-transparent text-ink outline-none placeholder:text-ink-soft"
          />
          <button
            type="submit"
            className="rounded-full bg-green px-5 py-2 text-paper transition-opacity hover:opacity-90"
          >
            Search
          </button>
        </form>

        <div className="mt-4">
          <Link
            href="/map"
            className="text-ink-soft underline-offset-4 hover:text-green hover:underline"
          >
            or explore the coverage map →
          </Link>
        </div>

        {/* Stats */}
        <div className="mx-auto mt-12 flex max-w-2xl flex-wrap items-center justify-center gap-x-8 gap-y-2 text-sm text-ink-soft">
          <span>
            <strong className="text-ink">{total}</strong> councils monitored
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
            self-healing
          </span>
        </div>
      </section>

      {/* Filters bar + council list */}
      <section className="mx-auto max-w-3xl px-6 pb-24">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg">councils monitored</h2>

          {/* Province filter */}
          <form action="/" method="get" className="flex items-center gap-2">
            {query && <input type="hidden" name="q" value={query} />}
            {near && <input type="hidden" name="near" value={near} />}
            <AutoSubmitSelect
              name="province"
              defaultValue={province ?? "all"}
              options={[
                { value: "all", label: "all regions" },
                ...provinces.map((p) => ({ value: p, label: p })),
              ]}
            />
          </form>

          <div className="ml-auto">
            <GeoLocate label="councils near me" />
          </div>
        </div>

        {/* Active filter indicators */}
        {(province || query || near) && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-soft">
            <span>showing:</span>
            {near && (
              <span className="rounded-full bg-green/10 px-2 py-0.5 text-xs text-green-dark">
                within 200km of you
              </span>
            )}
            {province && province !== "all" && (
              <span className="rounded-full bg-rust/10 px-2 py-0.5 text-xs text-rust">
                {province}
              </span>
            )}
            {query && (
              <span className="rounded-full bg-ink/5 px-2 py-0.5 text-xs">
                &ldquo;{query}&rdquo;
              </span>
            )}
            <Link href="/" className="text-xs underline underline-offset-2 hover:text-green">
              clear all
            </Link>
          </div>
        )}

        {/* Results count */}
        <p className="mt-3 text-sm text-ink-soft">
          {items.length} of {total} council{total !== 1 ? "s" : ""}
        </p>

        {/* System health overview -- a real, live breakdown, not decoration */}
        {items.length > 0 && (
          <div className="mt-4 rounded-xl border border-black/8 bg-row px-4 py-3">
            <div className="flex items-center justify-between text-xs text-ink-soft">
              <span>system health</span>
              <span>
                {healthCounts.healthy} healthy · {healthCounts.repairing} repairing
                {healthCounts.broken > 0 && ` · ${healthCounts.broken} broken`}
              </span>
            </div>
            <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-black/5">
              {healthCounts.healthy > 0 && (
                <span
                  className="bg-emerald-500"
                  style={{ width: `${(healthCounts.healthy / items.length) * 100}%` }}
                />
              )}
              {healthCounts.repairing > 0 && (
                <span
                  className="bg-amber-500"
                  style={{ width: `${(healthCounts.repairing / items.length) * 100}%` }}
                />
              )}
              {healthCounts.broken > 0 && (
                <span
                  className="bg-rose-500"
                  style={{ width: `${(healthCounts.broken / items.length) * 100}%` }}
                />
              )}
            </div>
          </div>
        )}

        {/* Recent activity rail -- the freshest finds, horizontally scrollable */}
        {recentActivity.length > 0 && (
          <div className="mt-6">
            <h3 className="text-sm text-ink-soft">recently found</h3>
            <div className="mt-2 flex snap-x gap-3 overflow-x-auto pb-2">
              {recentActivity.map((m) => (
                <Link
                  key={m.slug}
                  href={`/module/${m.slug}`}
                  className="min-w-56 shrink-0 snap-start rounded-lg bg-row px-3 py-2.5 transition-colors hover:bg-row-hover"
                >
                  <div className="truncate text-sm font-semibold">{m.name}</div>
                  <div className="mt-0.5 text-xs text-ink-soft">{m.latestMeetingDate}</div>
                  {m.latestMeetingTitle && (
                    <div className="mt-1 line-clamp-2 text-xs text-ink-soft/80">
                      {m.latestMeetingTitle}
                    </div>
                  )}
                </Link>
              ))}
              <Link
                href="/agents"
                className="flex min-w-32 shrink-0 snap-start items-center justify-center gap-1.5 rounded-lg border border-dashed border-black/15 px-3 py-2.5 text-sm text-ink-soft hover:border-green hover:text-green"
              >
                view all activity <i className="fa-solid fa-arrow-right text-xs" />
              </Link>
            </div>
          </div>
        )}

        {/* Councils grouped by province -- the dominant province opens
            expanded, everything else collapses so a handful of
            out-of-region finds don't dilute the primary list. */}
        <div className="mt-6 space-y-6">
          {sortedGroups.map(([prov, mods], i) => (
            <details key={prov} open={i === 0} className="group">
              <summary className="flex cursor-pointer list-none items-center gap-2 py-2">
                <i className="fa-solid fa-chevron-right text-xs text-ink-soft transition-transform group-open:rotate-90" />
                <h2 className="text-lg">{prov}</h2>
                <span className="rounded-full bg-ink/5 px-2 py-0.5 text-xs text-ink-soft">
                  {mods.length}
                </span>
              </summary>
              <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {mods.map((m) => {
                  const badge = HEALTH_BADGE[m.health];
                  return (
                    <li key={m.slug}>
                      <Link
                        href={`/module/${m.slug}`}
                        className="block rounded-lg bg-row px-3.5 py-2.5 transition-colors hover:bg-row-hover"
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={`h-2 w-2 shrink-0 rounded-full ${badge.dotClassName}`}
                            title={badge.label}
                          />
                          <span className="truncate font-semibold">{m.name}</span>
                        </div>
                        <div className="mt-0.5 truncate text-xs text-ink-soft">
                          {m.latestMeetingDate
                            ? `${m.latestMeetingDate} · ${m.latestMeetingTitle ?? "agenda"}`
                            : "no agenda found yet"}
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </details>
          ))}
        </div>

        {items.length === 0 && (
          <p className="mt-6 text-sm text-ink-soft">
            No councils found. Try a different search or{" "}
            <Link href="/" className="text-green hover:underline">
              clear filters
            </Link>
            .
          </p>
        )}
      </section>
    </main>
  );
}