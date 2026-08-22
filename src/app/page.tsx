import Link from "next/link";
import Image from "next/image";
import RotatingWord from "@/components/RotatingWord";
import RecentAgendasTicker from "@/components/RecentAgendasTicker";
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
    type?: string;
  }>;
}) {
  const sp = await searchParams;
  const page = parseInt(sp.page ?? "1", 10) || 1;
  const province = sp.province;
  const query = sp.q;
  const near = sp.near;
  const selectedTypes = sp.type ? sp.type.split(",").filter(Boolean) : undefined;

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

  const { items, total, provinces, govTypes } = await getModulesPaged({
    page,
    perPage: 100,
    province: province && province !== "all" ? province : undefined,
    query,
    lat,
    lng,
    radiusKm: lat != null ? 200 : undefined, // 200km default radius
    govTypes: selectedTypes,
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
        {/* inline-block wrapper shrink-wraps to the wordmark width, so the icon
            can be sized as a fraction of the hero text at every breakpoint */}
        <div className="mx-auto inline-block">
          {/* eslint-disable-next-line @next/next/no-img-element -- small local logo, % width tracks the wordmark */}
          <img
            src="/images/icon.png"
            alt="agenda.delivery logo"
            className="mx-auto mb-4 block h-auto w-[65%]"
          />
          <h1 className="text-[10vw] leading-none tracking-tight sm:text-6xl lg:text-7xl">
            <span className="text-green-dark">agenda</span>
            <span className="text-green">.delivery</span>
          </h1>
        </div>
        <p className="mx-auto mt-5 max-w-2xl text-xl text-ink sm:text-2xl">
          never miss an update from your local <RotatingWord />
        </p>
        <p className="mx-auto mt-3 max-w-xl text-base text-ink-soft">
          Track council and community agendas, get plain-language summaries, and
          route what matters to Discord, a script, or your own mailing list.
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
            <strong className="text-ink">{total}</strong> agendas monitored
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
            self-healing
          </span>
        </div>
      </section>

      {/* Who it's for */}
      <section className="mx-auto max-w-5xl px-6 pb-16">
        <h2 className="text-center text-2xl sm:text-3xl">Built for anyone who needs to stay in the loop</h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-ink-soft">
          The meetings that shape your street, your sector, and your city are public, but scattered
          across dozens of sites. agenda.delivery watches them for you.
        </p>
        <div className="mt-8 grid gap-8 sm:grid-cols-3">
          {[
            {
              img: "/images/civic-1.jpg",
              alt: "A town hall building facade",
              title: "Individuals",
              body: "Keep an eye on your own neighbourhood, council, or school board. Get a summary the moment a new agenda drops, so a rezoning or budget vote never slips past you.",
            },
            {
              img: "/images/civic-2.jpg",
              alt: "A historic council building",
              title: "Community groups",
              body: "Watch every council and organization that touches your work, then fan the highlights out to your members through a Discord channel or a curated mailing list.",
            },
            {
              img: "/images/civic-3.jpg",
              alt: "A modern city hall building",
              title: "Advocates & journalists",
              body: "Follow specific keywords across many jurisdictions at once, run your own prompts against each agenda, and pull everything through the API into your existing tools.",
            },
          ].map((f) => (
            <div key={f.title} className="overflow-hidden rounded-2xl border border-black/8 bg-row/40">
              <div className="relative h-36 w-full">
                <Image
                  src={f.img}
                  alt={f.alt}
                  fill
                  sizes="(min-width: 640px) 33vw, 100vw"
                  className="object-cover"
                />
              </div>
              <div className="p-5">
                <h3 className="font-semibold text-ink">{f.title}</h3>
                <p className="mt-1.5 text-sm text-ink-soft">{f.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* What you get */}
      <section className="mx-auto max-w-5xl px-6 pb-20">
        <h2 className="text-center text-2xl sm:text-3xl">Everything the agents do for you</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { icon: "fa-robot", color: "text-emerald-600", title: "Agents watch every page", body: "Autonomous agents crawl council, board, and organization sites around the clock for newly posted agendas." },
            { icon: "fa-comment-dots", color: "text-violet-600", title: "Plain-language summaries", body: "Every agenda is summarized with key highlights and topic tags, so you skim what matters in seconds." },
            { icon: "fa-diagram-project", color: "text-sky-600", title: "Automated actions", body: "Build simple rules: when a subscription updates, deliver the summary, a link, or the full text wherever you want." },
            { icon: "fa-discord", color: "text-indigo-500", brand: true, title: "Discord & webhooks", body: "Push updates straight into a Discord channel or your own script endpoint, reusable across all your rules." },
            { icon: "fa-envelope", color: "text-rose-500", title: "Mailing lists", body: "Collect updates into a digest with your own header and footer, sent on a schedule or when the queue fills up." },
            { icon: "fa-wand-magic-sparkles", color: "text-amber-600", title: "Custom prompts & keywords", body: "Run your own instructions against each agenda, or track specific keywords across every council you follow." },
            { icon: "fa-code", color: "text-slate-600", title: "Developer API", body: "Fetch your subscription updates programmatically and wire agenda.delivery into whatever you already use." },
            { icon: "fa-heart-pulse", color: "text-emerald-600", title: "Self-healing", body: "When a council redesigns its site or moves its portal, the agents notice, adapt, and keep tracking, no manual fixes." },
            { icon: "fa-location-dot", color: "text-teal-600", title: "Find agendas near you", body: "Browse by region or by your location, across councils and community organizations alike." },
          ].map((f) => (
            <div key={f.title} className="rounded-2xl border border-black/8 bg-white/50 p-5">
              <i className={`${f.brand ? "fa-brands" : "fa-solid"} ${f.icon} ${f.color} text-xl`} />
              <h3 className="mt-3 font-semibold text-ink">{f.title}</h3>
              <p className="mt-1.5 text-sm text-ink-soft">{f.body}</p>
            </div>
          ))}
        </div>
        <div className="mt-8 text-center">
          <Link
            href="/login"
            className="inline-block rounded-full bg-green px-6 py-3 text-paper transition-opacity hover:opacity-90"
          >
            Create a free account
          </Link>
        </div>
      </section>

      {/* Filters bar + council list */}
      <section className="mx-auto max-w-5xl px-6 pb-24">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg">display regions</h2>

          {/* Province filter */}
          <form action="/" method="get" className="flex items-center gap-2">
            {query && <input type="hidden" name="q" value={query} />}
            {near && <input type="hidden" name="near" value={near} />}
            {selectedTypes && <input type="hidden" name="type" value={selectedTypes.join(",")} />}
            <AutoSubmitSelect
              name="province"
              defaultValue={province ?? "all"}
              options={[
                { value: "all", label: "all regions" },
                ...provinces.map((p) => ({ value: p, label: p })),
              ]}
            />
          </form>

          {/* Gov-type checkbox filters, agents-page-style */}
          {govTypes.length > 1 && (
            <div className="flex items-center gap-2">
              {govTypes.map((t) => {
                const active = !selectedTypes || selectedTypes.includes(t);
                const next = selectedTypes
                  ? active
                    ? selectedTypes.filter((x) => x !== t)
                    : [...selectedTypes, t]
                  : govTypes.filter((x) => x !== t);
                const params = new URLSearchParams();
                if (province) params.set("province", province);
                if (query) params.set("q", query);
                if (near) params.set("near", near);
                if (next.length > 0 && next.length < govTypes.length) {
                  params.set("type", next.join(","));
                }
                const href = `/?${params.toString()}`;
                return (
                  <Link
                    key={t}
                    href={href}
                    className={`rounded-full border px-3 py-1 text-xs capitalize transition-colors ${
                      active
                        ? "border-green bg-green/10 text-green-dark"
                        : "border-black/10 text-ink-soft hover:border-green/50"
                    }`}
                  >
                    {t === "council" ? "Councils" : "Organizations"}
                  </Link>
                );
              })}
            </div>
          )}

          <div className="ml-auto">
            <GeoLocate label="Near Me" />
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
          {items.length} of {total} agenda{total !== 1 ? "s" : ""}
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

        {/* Recent agendas -- a bottom-to-top auto-scrolling ticker of the freshest finds */}
        {recentActivity.length > 0 && (
          <div className="mt-6">
            <div className="flex items-center justify-between">
              <h3 className="text-sm text-ink-soft">recent agendas</h3>
              <Link
                href="/agents"
                className="flex items-center gap-1.5 text-xs text-ink-soft hover:text-green"
              >
                view all activity <i className="fa-solid fa-arrow-right text-xs" />
              </Link>
            </div>
            <div className="mt-2">
              <RecentAgendasTicker items={recentActivity} />
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