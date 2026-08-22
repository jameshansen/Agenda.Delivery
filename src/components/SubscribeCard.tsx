"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { subscribe, subscribeAndEmail } from "@/app/actions";
import { EMAIL_RE, PHONE_RE } from "@/lib/contact";
import { SMS_ENABLED } from "@/lib/features";

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
  const [choosing, setChoosing] = useState(false);

  // "Send the summary to my email" — creates the follow + a "Send to my email"
  // action, so email delivery lives in the same action system as the rest.
  async function handleEmailAction() {
    setPending(true);
    setError(null);
    try {
      const res = await subscribeAndEmail({ slug: moduleSlug });
      if (res.ok) setDone("email");
      else setError(res.error ?? "Couldn't set that up just now. Try again.");
    } catch (err) {
      console.error("[SubscribeCard] email action failed:", err);
      setError("Couldn't set that up just now. Try again.");
    } finally {
      setPending(false);
    }
  }

  // "Create an Action": ensure the module is in the user's subscriptions,
  // then send them to the account panel to build the flowchart rule.
  async function handleCreateAction() {
    if (!isLoggedIn) {
      router.push("/login");
      return;
    }
    setPending(true);
    setError(null);
    try {
      if (accountEmail) await subscribe({ slug: moduleSlug, channel: "email", contact: accountEmail });
      router.push("/account");
    } catch (err) {
      console.error("[SubscribeCard] create action failed:", err);
      setError("Couldn't set that up just now. Try again.");
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
          You&apos;re following <strong>{moduleName}</strong>
          {done === "email" ? ", summaries will land in your email." : "."}
        </p>
        <p className="mt-1 text-sm text-ink-soft">
          Manage or add more actions from your account.
        </p>
        <Link
          href="/account"
          className="mt-3 inline-block text-sm underline underline-offset-4 hover:text-green"
        >
          Manage in your account
        </Link>
      </div>
    );
  }

  if (isLoggedIn && (accountEmail || accountPhone)) {
    return (
      <div className="rounded-xl border border-black/10 bg-white/50 p-5">
        <p className="text-lg">Subscribe</p>
        <p className="mt-1 text-sm text-ink-soft">
          {choosing
            ? "How would you like to follow this agenda?"
            : "Get every new agenda from this source, your way."}
        </p>
        {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}

        {!choosing ? (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              onClick={() => { setError(null); setChoosing(true); }}
              className="rounded-lg bg-green px-4 py-2 text-sm text-paper hover:opacity-90"
            >
              Subscribe
            </button>
            <a
              href={rss}
              className="ml-auto flex items-center gap-1.5 text-sm text-ink-soft hover:text-green"
            >
              <span className="text-amber-500">●</span> RSS
            </a>
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            <button
              onClick={handleEmailAction}
              disabled={pending}
              className="flex w-full items-center gap-3 rounded-lg border border-green bg-green/5 px-4 py-3 text-left hover:bg-green/10 disabled:opacity-50"
            >
              <i className="fa-solid fa-envelope text-green-dark" />
              <span>
                <span className="block text-sm font-medium">Send the summary to my email</span>
                <span className="block text-xs text-ink-soft">{accountEmail}</span>
              </span>
            </button>
            <button
              onClick={handleCreateAction}
              disabled={pending}
              className="flex w-full items-center gap-3 rounded-lg border border-black/15 px-4 py-3 text-left hover:border-green disabled:opacity-50"
            >
              <i className="fa-solid fa-diagram-project text-sky-600" />
              <span>
                <span className="block text-sm font-medium">Create an action</span>
                <span className="block text-xs text-ink-soft">Push to Discord, a script, or a mailing list</span>
              </span>
            </button>
            <button
              onClick={() => setChoosing(false)}
              className="text-xs text-ink-soft underline underline-offset-2 hover:text-green"
            >
              cancel
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-black/10 bg-white/50 p-5">
      <p className="text-lg">Subscribe</p>
      <p className="mt-1 text-sm text-ink-soft">
        Get every new agenda summarized, by email{SMS_ENABLED ? " or text" : ""}.
      </p>

      <div className={`mt-4 grid gap-3 ${SMS_ENABLED ? "sm:grid-cols-2" : ""}`}>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@email.com"
          className="h-10 rounded-lg bg-field px-3 outline-none focus:ring-2 focus:ring-green/30"
        />
        {SMS_ENABLED && (
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+1 604 555 0134"
            className="h-10 rounded-lg bg-field px-3 outline-none focus:ring-2 focus:ring-green/30"
          />
        )}
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
        {SMS_ENABLED && (
          <button
            onClick={() => handle("text")}
            disabled={pending}
            className="rounded-lg border border-green px-4 py-2 text-sm text-green hover:bg-green hover:text-paper disabled:opacity-50"
          >
            Subscribe by text
          </button>
        )}
        <a
          href={rss}
          className="ml-auto flex items-center gap-1.5 text-sm text-ink-soft hover:text-green"
        >
          <span className="text-amber-500">●</span> RSS
        </a>
      </div>
      <p className="mt-3 text-sm text-ink-soft">
        Want to push updates to Discord, a script, or a mailing list instead?{" "}
        <button onClick={handleCreateAction} className="text-green underline underline-offset-2 hover:text-green-dark">
          Create an action
        </button>
      </p>
    </div>
  );
}