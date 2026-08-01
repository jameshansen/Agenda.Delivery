"use client";

import { useState } from "react";

// ponytail: local-only fake success. Wires to email/Twilio in Phase 6.
export default function SubscribeCard({
  moduleName,
  rss,
}: {
  moduleName: string;
  rss: string;
}) {
  const [done, setDone] = useState<"email" | "text" | null>(null);

  if (done) {
    return (
      <div className="rounded-xl border border-green/30 bg-row/60 p-5">
        <p className="text-lg">
          You&apos;re subscribed to <strong>{moduleName}</strong> by {done}.
        </p>
        <p className="mt-1 text-sm text-ink-soft">
          New agendas and summaries will arrive automatically.
        </p>
        <button
          onClick={() => setDone(null)}
          className="mt-3 text-sm underline underline-offset-4 hover:text-green"
        >
          Manage
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const submitter = (e.nativeEvent as SubmitEvent)
          .submitter as HTMLButtonElement | null;
        setDone(submitter?.value === "text" ? "text" : "email");
      }}
      className="rounded-xl border border-black/10 bg-white/50 p-5"
    >
      <p className="text-lg">Subscribe</p>
      <p className="mt-1 text-sm text-ink-soft">
        Get every new agenda summarized, by email or text.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <input
          type="email"
          required
          placeholder="you@email.com"
          className="h-10 rounded-lg bg-field px-3 outline-none focus:ring-2 focus:ring-green/30"
        />
        <input
          type="tel"
          placeholder="+1 604 555 0134"
          className="h-10 rounded-lg bg-field px-3 outline-none focus:ring-2 focus:ring-green/30"
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          value="email"
          className="rounded-lg bg-green px-4 py-2 text-sm text-paper hover:opacity-90"
        >
          Subscribe by email
        </button>
        <button
          type="submit"
          value="text"
          className="rounded-lg border border-green px-4 py-2 text-sm text-green hover:bg-green hover:text-paper"
        >
          Subscribe by text
        </button>
        <a
          href={rss}
          className="ml-auto flex items-center gap-1.5 text-sm text-ink-soft hover:text-green"
        >
          <span className="text-amber-500">●</span> RSS
        </a>
      </div>
    </form>
  );
}
