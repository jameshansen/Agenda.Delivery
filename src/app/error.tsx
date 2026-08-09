"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function Error({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("[error.tsx]", error);
  }, [error]);

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
      <p className="text-6xl font-bold text-rust">500</p>
      <h1 className="mt-4 text-2xl">Something went wrong</h1>
      <p className="mt-2 text-ink-soft">
        An unexpected error occurred. Our agents have been notified.
      </p>
      {error.digest && (
        <p className="mt-1 font-mono text-xs text-ink-soft">
          Error ID: {error.digest}
        </p>
      )}
      <div className="mt-6 flex items-center gap-3">
        <button
          onClick={() => unstable_retry()}
          className="rounded-lg bg-green px-5 py-2.5 text-paper transition-opacity hover:opacity-90"
        >
          Try again
        </button>
        <Link
          href="/"
          className="rounded-lg border border-black/15 px-5 py-2.5 text-sm hover:border-green hover:text-green"
        >
          ← Home
        </Link>
      </div>
    </main>
  );
}