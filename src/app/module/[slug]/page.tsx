import Link from "next/link";
import { notFound } from "next/navigation";
import SiteHeader from "@/components/SiteHeader";
import AgentLog from "@/components/AgentLog";
import SubscribeCard from "@/components/SubscribeCard";
import { getModule, type Health } from "@/data/modules";

const HEALTH: Record<Health, { label: string; className: string }> = {
  healthy: { label: "● healthy", className: "text-emerald-700 bg-emerald-500/10" },
  repairing: { label: "● self-repaired", className: "text-amber-700 bg-amber-500/10" },
  broken: { label: "● broken", className: "text-rose-700 bg-rose-500/10" },
};

export default async function ModulePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const m = getModule(slug);
  if (!m) notFound();

  const health = HEALTH[m.health];

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl px-6 py-8">
        <Link href="/" className="text-sm text-ink-soft hover:text-green">
          ← all agendas
        </Link>

        {/* Title block */}
        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl sm:text-4xl">{m.name}</h1>
            <p className="mt-1 text-ink-soft">{m.region}</p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-sm ${health.className}`}
          >
            {health.label}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink-soft">
          <span>Last updated {m.lastUpdated}</span>
          <span>Next agenda expected {m.nextExpected}</span>
          <span>{m.followers} followers</span>
          <a
            href={m.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="hover:text-green"
          >
            source ↗
          </a>
        </div>

        <div className="mt-8 grid gap-8 lg:grid-cols-3">
          {/* Main column */}
          <div className="lg:col-span-2 space-y-10">
            {/* Summary */}
            <section id="summary" className="scroll-mt-20">
              <h2 className="text-xl">AI summary</h2>
              <p className="mt-2 leading-relaxed">{m.summary}</p>

              <div className="mt-4 space-y-2">
                {m.highlights.map((h, i) => (
                  <div key={i} className="flex gap-3 rounded-lg bg-row/60 px-4 py-2">
                    <span className="shrink-0 rounded bg-green/10 px-2 py-0.5 text-xs text-green-dark">
                      {h.tag}
                    </span>
                    <span className="text-sm">{h.text}</span>
                  </div>
                ))}
              </div>
            </section>

            {/* Keyword summaries */}
            <section>
              <h2 className="text-xl">Keyword summaries</h2>
              <p className="mt-1 text-sm text-ink-soft">
                Bespoke summaries for the topics people follow (up to 5).
              </p>
              <div className="mt-3 space-y-3">
                {m.keywords.map((k) => (
                  <details
                    key={k.keyword}
                    className="group rounded-xl border border-black/10 bg-white/50 p-4"
                  >
                    <summary className="flex cursor-pointer items-center gap-3 list-none">
                      <span className="rounded bg-rust/10 px-2 py-0.5 text-rust">
                        {k.keyword}
                      </span>
                      <span className="text-sm text-ink-soft">
                        {k.followers} people following
                      </span>
                      <span className="ml-auto text-ink-soft transition-transform group-open:rotate-180">
                        ⌄
                      </span>
                    </summary>
                    <p className="mt-3 text-sm leading-relaxed">{k.summary}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-soft">
                      followers also track:
                      {k.related.map((r) => (
                        <span
                          key={r}
                          className="rounded-full bg-ink/5 px-2 py-0.5"
                        >
                          {r}
                        </span>
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            </section>

            {/* Subscribe */}
            <section id="subscribe" className="scroll-mt-20">
              <SubscribeCard
                moduleName={m.name}
                rss={`/module/${m.slug}/rss.xml`}
              />
            </section>

            {/* Meetings */}
            <section>
              <h2 className="text-xl">Recent agendas</h2>
              <ul className="mt-3 divide-y divide-black/5 rounded-xl border border-black/10 bg-white/40">
                {m.meetings.map((mt, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between gap-4 px-4 py-3"
                  >
                    <div>
                      <div className="font-medium">{mt.title}</div>
                      <div className="text-sm text-ink-soft">
                        {mt.date} · {mt.kind} · {mt.pages} pages
                      </div>
                    </div>
                    <div className="flex gap-4 text-sm">
                      <button className="hover:text-green">PDF</button>
                      <button className="hover:text-green">Summary</button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          {/* Agent activity rail */}
          <aside className="lg:col-span-1">
            <div className="lg:sticky lg:top-6 rounded-2xl border border-black/10 bg-paper/60 p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg">Agent activity</h2>
                <span className="text-xs text-ink-soft">last scrape run</span>
              </div>
              <p className="mt-1 text-xs text-ink-soft">
                Everything the module did to fetch and self-verify this update.
              </p>
              <div className="mt-4">
                <AgentLog events={m.agentLog} />
              </div>
            </div>
          </aside>
        </div>
      </main>
    </>
  );
}
