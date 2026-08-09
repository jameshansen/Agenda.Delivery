import { db } from "@/db";
import { spiderCandidates } from "@/db/schema";
import { desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export default async function SpiderPage() {
  const candidates = await db
    .select()
    .from(spiderCandidates)
    .orderBy(desc(spiderCandidates.createdAt))
    .limit(20);

  const discovered = candidates.length;
  const queued = candidates.filter((c) => c.status === "queued").length;
  const created = candidates.filter((c) => c.status === "created").length;

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-8">
      <div className="flex items-center gap-3">
        <h1 className="text-3xl sm:text-4xl">The Spider</h1>
        <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-sm text-emerald-700">
          <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
          autonomous
        </span>
      </div>
      <p className="mt-2 text-ink-soft">
        The Spider Agent processes the council source registry
        (<code className="rounded bg-ink/5 px-1 text-xs">sources.toml</code> at the
        project root). When it finds a new source, it locates it on the map and
        hands it to the Scraper Create Agent to build a module. The spider is
        currently <strong>disabled</strong> — sources are managed via the
        version-controlled <code className="rounded bg-ink/5 px-1 text-xs">sources.toml</code> file.
      </p>

      <div className="mt-6 grid grid-cols-3 gap-4">
        <Stat label="candidates discovered" value={discovered} />
        <Stat label="queued for creation" value={queued} />
        <Stat label="modules created" value={created} />
      </div>

      {candidates.length > 0 && (
        <div className="mt-10">
          <h2 className="text-lg">Recent discoveries</h2>
          <ul className="mt-3 space-y-2">
            {candidates.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between rounded-lg bg-row px-4 py-3"
              >
                <div>
                  <span className="block font-medium">{c.name}</span>
                  <span className="block text-xs text-ink-soft">
                    {c.region ?? "Location pending"} ·{" "}
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:text-green"
                    >
                      source ↗
                    </a>
                  </span>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    c.status === "created"
                      ? "bg-emerald-500/10 text-emerald-700"
                      : c.status === "queued"
                        ? "bg-amber-500/10 text-amber-700"
                        : "bg-ink/5 text-ink-soft"
                  }`}
                >
                  {c.status.replace("_", " ")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-10 rounded-xl border border-black/10 bg-white/40 p-5 text-sm text-ink-soft">
        <p className="text-ink">How it works</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>Spider Agent discovers a candidate agenda source.</li>
          <li>It resolves the geographic location for the coverage map.</li>
          <li>It enqueues the source to the Scraper Create Agent.</li>
          <li>The Scraper Create Agent builds and self-verifies a module.</li>
        </ol>
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-black/5 bg-white/50 p-4">
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-ink-soft">{label}</div>
    </div>
  );
}