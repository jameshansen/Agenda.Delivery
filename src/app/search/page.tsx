import type { ReactNode } from "react";
import Link from "next/link";
import { getModulesPaged } from "@/db/queries";

export const dynamic = "force-dynamic";

/**
 * Highlight matched terms in a string, returning React fragments.
 * Case-insensitive, escapes nothing (input is from DB, not user HTML).
 */
function highlight(text: string, query: string) {
  if (!query) return text;
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const parts: Array<string | ReactNode> = [];
  let i = 0;
  let idx = lower.indexOf(q);
  let key = 0;
  while (idx !== -1) {
    if (idx > i) parts.push(text.slice(i, idx));
    parts.push(
      <mark key={`hl-${key++}`} className="rounded bg-amber-200/70 px-0.5">
        {text.slice(idx, idx + query.length)}
      </mark>,
    );
    i = idx + query.length;
    idx = lower.indexOf(q, i);
  }
  if (i < text.length) parts.push(text.slice(i));
  return <>{parts}</>;
}

/**
 * GET /search?q=... — search modules by name, region, or keyword.
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = "" } = await searchParams;
  const query = q.trim();
  const { items: results } = await getModulesPaged({
    query: query.toLowerCase(),
    perPage: 50,
  });

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-8">
      <h1 className="text-3xl sm:text-4xl">Search</h1>

      <form
        action="/search"
        method="get"
        className="mt-6 flex items-center gap-2 rounded-full border border-black/10 bg-white/70 p-2 pl-5 shadow-sm focus-within:border-green/50"
        role="search"
      >
        <input
          type="search"
          name="q"
          defaultValue={q}
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

      {query && (
        <p className="mt-4 text-sm text-ink-soft">
          {results.length} result{results.length !== 1 ? "s" : ""} for{" "}
          <strong className="text-ink">“{q}”</strong>
        </p>
      )}

      <ul className="mt-4 space-y-3">
        {results.map((m) => (
          <li
            key={m.slug}
            className="rounded-xl bg-row px-5 py-4 transition-colors hover:bg-row-hover"
          >
            <Link
              href={`/module/${m.slug}`}
              className="text-lg font-semibold hover:text-green"
            >
              {highlight(m.name, query)}
            </Link>
            <div className="mt-0.5 text-sm text-ink-soft">
              {highlight(m.region, query)} · {m.followers} followers
            </div>
            {m.summary && (
              <p className="mt-2 text-sm text-ink-soft line-clamp-2">
                {highlight(m.summary, query)}
              </p>
            )}
          </li>
        ))}
      </ul>

      {query && results.length === 0 && (
        <p className="mt-6 text-sm text-ink-soft">
          No modules matched “{q}”. Try a different search.
        </p>
      )}
    </main>
  );
}