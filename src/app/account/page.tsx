import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import { allModules } from "@/data/modules";

// ponytail: signed-in mock. Real accounts + auth arrive in Phase 3.
const subscriptions = [
  { slug: "township-of-langley", channel: "email" },
  { slug: "city-of-langley", channel: "text" },
];

const updates = [
  { slug: "township-of-langley", when: "2 days ago", text: "Willoughby plan amendment approved: +1,900 units." },
  { slug: "city-of-langley", when: "1 week ago", text: "Scraper auto-repaired after portal migration; June 18 agenda summarized." },
  { slug: "township-of-langley", when: "1 week ago", text: "200 Street protected bike lane contract awarded." },
];

const keywords = ["cycling", "housing", "parking", "parks"];

export default function AccountPage() {
  const byslug = Object.fromEntries(allModules.map((m) => [m.slug, m]));

  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-4xl px-6 py-8">
        <h1 className="text-3xl sm:text-4xl">Welcome back, James</h1>
        <p className="mt-1 text-ink-soft">jameshansen.bc@gmail.com</p>

        <div className="mt-8 grid gap-8 md:grid-cols-2">
          {/* Subscriptions */}
          <section>
            <h2 className="text-xl">Your subscriptions</h2>
            <ul className="mt-3 space-y-2">
              {subscriptions.map((s) => {
                const m = byslug[s.slug];
                return (
                  <li
                    key={s.slug}
                    className="flex items-center justify-between rounded-lg bg-row px-4 py-3"
                  >
                    <Link href={`/module/${s.slug}`} className="font-medium hover:text-green">
                      {m?.name ?? s.slug}
                    </Link>
                    <span className="rounded-full bg-green/10 px-2 py-0.5 text-xs text-green-dark">
                      by {s.channel}
                    </span>
                  </li>
                );
              })}
            </ul>

            <h3 className="mt-6 text-lg">Followed keywords</h3>
            <div className="mt-2 flex flex-wrap gap-2">
              {keywords.map((k) => (
                <span
                  key={k}
                  className="rounded-full bg-rust/10 px-3 py-1 text-sm text-rust"
                >
                  {k}
                </span>
              ))}
            </div>
          </section>

          {/* Recent updates */}
          <section>
            <h2 className="text-xl">Recent updates</h2>
            <ul className="mt-3 space-y-3">
              {updates.map((u, i) => {
                const m = byslug[u.slug];
                return (
                  <li key={i} className="rounded-lg border border-black/10 bg-white/40 p-4">
                    <div className="flex items-center justify-between">
                      <Link href={`/module/${u.slug}`} className="font-medium hover:text-green">
                        {m?.name ?? u.slug}
                      </Link>
                      <span className="text-xs text-ink-soft">{u.when}</span>
                    </div>
                    <p className="mt-1 text-sm">{u.text}</p>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      </main>
    </>
  );
}
