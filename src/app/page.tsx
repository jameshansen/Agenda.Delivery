import Link from "next/link";
import RotatingWord from "@/components/RotatingWord";
import { allModules } from "@/data/modules";

export default function Home() {
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
            <strong className="text-ink">214</strong> councils monitored
          </span>
          <span>
            <strong className="text-ink">3</strong> provinces live
          </span>
          <span>
            <strong className="text-ink">11,904</strong> agendas tracked
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
            self-healing
          </span>
        </div>
      </section>

      {/* Newest agendas */}
      <section className="mx-auto max-w-3xl px-6 pb-24">
        <div className="flex items-center justify-between">
          <h2 className="text-lg">newest agendas monitored</h2>
          <Link
            href="/map"
            className="text-sm text-ink-soft hover:text-green"
          >
            view all →
          </Link>
        </div>

        <ul className="mt-4 space-y-3">
          {allModules.map((m) => (
            <li
              key={m.slug}
              className="rounded-xl bg-row px-5 py-4 transition-colors hover:bg-row-hover"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/module/${m.slug}`}
                      className="text-lg font-semibold hover:text-green"
                    >
                      {m.name}
                    </Link>
                    {m.health === "healthy" ? (
                      <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-700">
                        healthy
                      </span>
                    ) : (
                      <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-700">
                        self-repaired
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-sm text-ink-soft">
                    {m.region} · Last updated {m.lastUpdated} · {m.followers}{" "}
                    followers
                  </div>
                </div>
                <div className="flex items-center gap-5 text-sm">
                  <Link href={`/module/${m.slug}`} className="hover:text-green">
                    View
                  </Link>
                  <Link
                    href={`/module/${m.slug}#subscribe`}
                    className="hover:text-green"
                  >
                    Subscribe
                  </Link>
                  <Link
                    href={`/module/${m.slug}#summary`}
                    className="hover:text-green"
                  >
                    Summarize
                  </Link>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
