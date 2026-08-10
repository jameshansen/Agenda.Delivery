"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { subscribe } from "@/app/actions";
import { EMAIL_RE, PHONE_RE } from "@/lib/contact";

export default function SubscribeCard({
  moduleName,
  moduleSlug,
  rss,
  isLoggedIn,
  accountEmail,
  accountPhone,
}: {
  moduleName: string;
  moduleSlug: string;
  rss: string;
  /** Signed-in users subscribe with their already-verified account contact
   * in one click. Guests go through /signup to verify a new contact first
   * rather than silently recording an unverified email/phone. */
  isLoggedIn: boolean;
  accountEmail: string | null;
  accountPhone: string | null;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [done, setDone] = useState<"email" | "text" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleAccount(channel: "email" | "text") {
    const contact = channel === "email" ? accountEmail : accountPhone;
    if (!contact) return;
    setPending(true);
    setError(null);
    try {
      await subscribe({ slug: moduleSlug, channel, contact });
      setDone(channel);
    } catch (err) {
      console.error("[SubscribeCard] subscribe failed:", err);
      setError("Couldn't subscribe just now. Try again.");
    } finally {
      setPending(false);
    }
  }

  async function handle(channel: "email" | "text") {
    const contact = channel === "email" ? email : phone;
    if (!contact) {
      setError(`Enter ${channel === "email" ? "an email" : "a phone number"}.`);
      return;
    }
    if (!(channel === "email" ? EMAIL_RE : PHONE_RE).test(contact)) {
      setError(
        channel === "email"
          ? "Please enter a valid email address."
          : "Please enter a valid phone number (e.g. +1 604 555 0134).",
      );
      return;
    }

    if (!isLoggedIn) {
      // Guest: verify the contact via signup/OTP before it's ever recorded
      // as a subscription, rather than trusting an unverified address.
      const params = new URLSearchParams({ contact, channel, module: moduleSlug });
      router.push(`/signup?${params.toString()}`);
      return;
    }

    setPending(true);
    setError(null);
    try {
      await subscribe({ slug: moduleSlug, channel, contact });
      setDone(channel);
    } catch (err) {
      console.error("[SubscribeCard] subscribe failed:", err);
      const msg = err instanceof Error ? err.message : "Unknown error";
      setError(
        msg.includes("Unknown module")
          ? "This module could not be found. Please refresh and try again."
          : "Couldn't subscribe just now. Try again.",
      );
    } finally {
      setPending(false);
    }
  }

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

  if (isLoggedIn && (accountEmail || accountPhone)) {
    return (
      <div className="rounded-xl border border-black/10 bg-white/50 p-5">
        <p className="text-lg">Subscribe</p>
        <p className="mt-1 text-sm text-ink-soft">
          Get every new agenda summarized, sent to your account.
        </p>
        {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {accountEmail && (
            <button
              onClick={() => handleAccount("email")}
              disabled={pending}
              className="rounded-lg bg-green px-4 py-2 text-sm text-paper hover:opacity-90 disabled:opacity-50"
            >
              Subscribe by email ({accountEmail})
            </button>
          )}
          {accountPhone && (
            <button
              onClick={() => handleAccount("text")}
              disabled={pending}
              className="rounded-lg border border-green px-4 py-2 text-sm text-green hover:bg-green hover:text-paper disabled:opacity-50"
            >
              Subscribe by text ({accountPhone})
            </button>
          )}
          <a
            href={rss}
            className="ml-auto flex items-center gap-1.5 text-sm text-ink-soft hover:text-green"
          >
            <span className="text-amber-500">●</span> RSS
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-black/10 bg-white/50 p-5">
      <p className="text-lg">Subscribe</p>
      <p className="mt-1 text-sm text-ink-soft">
        Get every new agenda summarized, by email or text.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@email.com"
          className="h-10 rounded-lg bg-field px-3 outline-none focus:ring-2 focus:ring-green/30"
        />
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+1 604 555 0134"
          className="h-10 rounded-lg bg-field px-3 outline-none focus:ring-2 focus:ring-green/30"
        />
      </div>

      {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          onClick={() => handle("email")}
          disabled={pending}
          className="rounded-lg bg-green px-4 py-2 text-sm text-paper hover:opacity-90 disabled:opacity-50"
        >
          Subscribe by email
        </button>
        <button
          onClick={() => handle("text")}
          disabled={pending}
          className="rounded-lg border border-green px-4 py-2 text-sm text-green hover:bg-green hover:text-paper disabled:opacity-50"
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
    </div>
  );
}