import Link from "next/link";
import RotatingWord from "@/components/RotatingWord";
import { newestAgendas } from "@/data/agendas";

export default function Home() {
  return (
    <main className="flex-1 w-full">
      <div className="mx-auto max-w-2xl px-6 py-16 sm:py-24">
        {/* Logo + tagline */}
        <header className="text-center">
          <h1 className="text-5xl sm:text-6xl tracking-tight">
            <span className="text-green-dark">agenda</span>
            <span className="text-green">.delivery</span>
          </h1>
          <p className="mt-4 text-lg sm:text-xl text-ink">
            never miss an update from your local <RotatingWord />
          </p>
        </header>

        {/* Search */}
        <section className="mt-16">
          <label htmlFor="search" className="block text-lg">
            search agendas
          </label>
          <input
            id="search"
            type="search"
            placeholder="Township of Langley, HUB Cycling…"
            className="mt-2 h-11 w-full max-w-md rounded-lg bg-field px-4 text-ink placeholder:text-ink-soft outline-none ring-green/30 focus:ring-2"
          />
        </section>

        {/* Map link */}
        <div className="mt-6">
          <Link
            href="/map"
            className="text-lg text-ink underline-offset-4 hover:text-green hover:underline"
          >
            view map
          </Link>
        </div>

        {/* Newest agendas */}
        <section className="mt-10">
          <h2 className="text-lg">newest agendas monitored</h2>
          <ul className="mt-3 space-y-3">
            {newestAgendas.map((a) => (
              <li
                key={a.slug}
                className="flex flex-col gap-3 rounded-lg bg-row px-6 py-4 transition-colors hover:bg-row-hover sm:flex-row sm:items-center sm:justify-between sm:px-10"
              >
                <div>
                  <div className="text-lg font-semibold">{a.name}</div>
                  <div className="text-sm text-ink-soft">
                    Last updated {a.lastUpdated}
                  </div>
                </div>
                <div className="flex items-center gap-5 text-sm">
                  <Link href={`/module/${a.slug}`} className="hover:text-green">
                    View
                  </Link>
                  <Link
                    href={`/module/${a.slug}#subscribe`}
                    className="hover:text-green"
                  >
                    Subscribe
                  </Link>
                  <Link
                    href={`/module/${a.slug}#summary`}
                    className="hover:text-green"
                  >
                    Summarize
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
