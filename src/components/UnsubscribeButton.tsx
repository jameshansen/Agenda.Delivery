"use client";

import { useState, useTransition } from "react";
import { unsubscribe } from "@/app/actions";

/**
 * Unsubscribe button with a confirmation dialog. Calls the server
 * action only after the user confirms.
 */
export default function UnsubscribeButton({
  slug,
  name,
}: {
  slug: string;
  name: string;
}) {
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-lg border border-rose-300 px-2 py-1 text-xs text-rose-600 hover:bg-rose-50"
      >
        Unsubscribe
      </button>
    );
  }

  return (
    <span className="flex items-center gap-1">
      <span className="text-xs text-ink-soft">Unsubscribe from {name}?</span>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            await unsubscribe({ slug });
          })
        }
        className="rounded-lg bg-rose-500 px-2 py-1 text-xs text-white hover:bg-rose-600 disabled:opacity-50"
      >
        {pending ? "…" : "Yes"}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => setConfirming(false)}
        className="rounded-lg border border-black/15 px-2 py-1 text-xs hover:border-green hover:text-green disabled:opacity-50"
      >
        No
      </button>
    </span>
  );
}