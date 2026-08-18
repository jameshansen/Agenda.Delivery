"use client";

import { useState, useTransition } from "react";
import { generateApiKey } from "@/app/actions";

/**
 * Shows the API key prefix if one exists. Generating (or regenerating) shows
 * the raw key once in-page — it's never recoverable after that, since only
 * its hash is stored.
 */
export default function ApiKeyPanel({ prefix }: { prefix: string | null }) {
  const [pending, startTransition] = useTransition();
  const [revealed, setRevealed] = useState<string | null>(null);
  const [currentPrefix, setCurrentPrefix] = useState(prefix);

  return (
    <div className="rounded-lg bg-row px-4 py-3">
      {revealed ? (
        <>
          <p className="text-sm text-ink-soft">
            Your new key (copy it now — it won&apos;t be shown again):
          </p>
          <code className="mt-1 block break-all rounded bg-black/5 px-2 py-1.5 text-xs">
            {revealed}
          </code>
        </>
      ) : currentPrefix ? (
        <p className="text-sm text-ink-soft">
          Active key: <code className="text-xs">{currentPrefix}…</code>
        </p>
      ) : (
        <p className="text-sm text-ink-soft">
          No API key yet. Generate one to fetch your subscription updates programmatically.
        </p>
      )}
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const { key, prefix } = await generateApiKey();
            setRevealed(key);
            setCurrentPrefix(prefix);
          })
        }
        className="mt-2 rounded-lg border border-black/15 px-3 py-1.5 text-xs hover:border-green hover:text-green disabled:opacity-50"
      >
        {pending ? "…" : currentPrefix ? "Regenerate key" : "Generate key"}
      </button>
    </div>
  );
}
