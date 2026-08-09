import Link from "next/link";
import RotatingWord from "@/components/RotatingWord";
import GeoLocate from "@/components/GeoLocate";
import AutoSubmitSelect from "@/components/AutoSubmitSelect";
import { getModulesPaged } from "@/db/queries";
import type { Health } from "@/db/queries";

export const dynamic = "force-dynamic";

const HEALTH_BADGE: Record<Health, { label: string; className: string }> = {
  healthy: { label: "healthy", className: "bg-emerald-500/10 text-emerald-700" },
  repairing: { label: "repairing", className: "bg-amber-500/10 text-amber-700" },
  broken: { label: "broken", className: "bg-rose-500/10 text-rose-700" },
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
    perPage: 20,
    province: province && province !== "all" ? province : undefined,
    query,
    lat,
    lng,
    radiusKm: lat != null ? 200 : undefined, // 200km default radius
  });

  const totalPages = Math.max(1, Math.ceil(total / 20));

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

        {/* Results */}
        <p className="mt-3 text-sm text-ink-soft">
          {items.length} of {total} council{total !== 1 ? "s" : ""}
        </p>

        <ul className="mt-4 space-y-3">
          {items.map((m) => {
            const badge = HEALTH_BADGE[m.health];
            return (
              <li
                key={m.slug}
                className="rounded-xl bg-row px-5 py-4 transition-colors hover:bg-row-hover"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/module/${m.slug}`}
                        className="text-lg font-semibold hover:text-green"
                      >
                        {m.name}
                      </Link>
                      <span className={`rounded-full px-2 py-0.5 text-xs ${badge.className}`}>
                        {badge.label}
                      </span>
                    </div>
                    <div className="mt-0.5 text-sm text-ink-soft">
                      {m.region}
                      {m.latestMeetingDate && (
                        <span className="text-ink-soft/60">
                          {" "}· latest council meeting {m.latestMeetingDate}
                        </span>
                      )}
                    </div>
                    {m.latestMeetingTitle && (
                      <div className="mt-0.5 truncate text-sm text-ink-soft/80">
                        <i className="fa-solid fa-file-lines mr-1 text-rust/60" />
                        {m.latestMeetingTitle}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-5 text-sm">
                    <Link href={`/module/${m.slug}`} className="hover:text-green">
                      View
                    </Link>
                    <Link
                      href={`/module/${m.slug}#subscribe`}
                      className="hover:text-green"
                    >
                      Subscribe
                    </Link>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        {/* Pagination */}
        {totalPages > 1 && (
          <nav className="mt-8 flex items-center justify-center gap-2">
            {page > 1 && (
              <Link
                href={`/?${buildQuery({ page: page - 1, province, query, near })}`}
                className="rounded-lg border border-black/15 px-3 py-1.5 text-sm hover:border-green hover:text-green"
              >
                <i className="fa-solid fa-chevron-left" />
              </Link>
            )}
            <span className="px-3 py-1.5 text-sm text-ink-soft">
              page {page} of {totalPages}
            </span>
            {page < totalPages && (
              <Link
                href={`/?${buildQuery({ page: page + 1, province, query, near })}`}
                className="rounded-lg border border-black/15 px-3 py-1.5 text-sm hover:border-green hover:text-green"
              >
                <i className="fa-solid fa-chevron-right" />
              </Link>
            )}
          </nav>
        )}

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

/** Build a URL query string from the filter params. */
function buildQuery(opts: {
  page: number;
  province?: string;
  query?: string;
  near?: string;
}): string {
  const params = new URLSearchParams();
  if (opts.page > 1) params.set("page", String(opts.page));
  if (opts.province && opts.province !== "all") params.set("province", opts.province);
  if (opts.query) params.set("q", opts.query);
  if (opts.near) params.set("near", opts.near);
  return params.toString();
}