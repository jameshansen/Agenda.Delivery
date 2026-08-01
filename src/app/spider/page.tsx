import SpiderFeed from "@/components/SpiderFeed";

export default function SpiderPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-8">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl sm:text-4xl">The Spider</h1>
          <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-sm text-emerald-700">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
            live
          </span>
        </div>
        <p className="mt-2 text-ink-soft">
          The Spider Agent crawls the web looking for councils, committees, and
          organizations that publish agendas. When it finds one, it locates it
          on the map and hands it to the Scraper Create Agent to build a module.
        </p>

        <div className="mt-8">
          <SpiderFeed />
        </div>

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
