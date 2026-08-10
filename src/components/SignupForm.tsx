"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { requestOtpAction, verifyOtpAction } from "@/app/actions";
import { isValidContact } from "@/lib/contact";

export default function SignupForm({
  initialChannel,
  initialContact,
  moduleSlug,
}: {
  initialChannel: "email" | "text";
  initialContact: string;
  moduleSlug?: string;
}) {
  const router = useRouter();
  const [channel, setChannel] = useState<"email" | "text">(initialChannel);
  const [contact, setContact] = useState(initialContact);
  const [step, setStep] = useState<"contact" | "code">("contact");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function sendCode() {
    if (!isValidContact(channel, contact)) {
      setError(
        channel === "email"
          ? "Please enter a valid email address."
          : "Please enter a valid phone number (e.g. +1 604 555 0134).",
      );
      return;
    }
    setPending(true);
    setError(null);
    const res = await requestOtpAction({ channel, contact });
    setPending(false);
    if (!res.ok) {
      setError(res.error ?? "Couldn't send a code.");
      return;
    }
    setStep("code");
  }

  async function verify() {
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit code.");
      return;
    }
    setPending(true);
    setError(null);
    const res = await verifyOtpAction({ channel, contact, code, moduleSlug });
    setPending(false);
    if (!res.ok) {
      setError(res.error ?? "Verification failed.");
      return;
    }
    router.push(moduleSlug ? `/module/${moduleSlug}` : "/account");
    router.refresh();
  }

  if (step === "code") {
    return (
      <div className="mt-8 space-y-3">
        <p className="text-sm text-ink-soft">
          Enter the 6-digit code sent to <strong className="text-ink">{contact}</strong>.
        </p>
        <input
          type="text"
          inputMode="numeric"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          placeholder="000000"
          className="h-11 w-full rounded-lg bg-field px-3 text-center text-lg tracking-[0.3em] outline-none focus:ring-2 focus:ring-green/30"
        />
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <button
          onClick={verify}
          disabled={pending}
          className="h-11 w-full rounded-lg bg-green text-paper hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Verifying…" : "Verify & continue"}
        </button>
        <button
          onClick={() => setStep("contact")}
          className="w-full text-center text-xs text-ink-soft underline underline-offset-2 hover:text-green"
        >
          Use a different email or phone
        </button>
      </div>
    );
  }

  return (
    <div className="mt-8 space-y-3">
      <div className="flex rounded-lg bg-field p-1 text-sm">
        <button
          onClick={() => setChannel("email")}
          className={`flex-1 rounded-md py-1.5 ${channel === "email" ? "bg-white shadow-sm" : "text-ink-soft"}`}
        >
          Email
        </button>
        <button
          onClick={() => setChannel("text")}
          className={`flex-1 rounded-md py-1.5 ${channel === "text" ? "bg-white shadow-sm" : "text-ink-soft"}`}
        >
          Phone
        </button>
      </div>
      <input
        type={channel === "email" ? "email" : "tel"}
        value={contact}
        onChange={(e) => setContact(e.target.value)}
        placeholder={channel === "email" ? "you@email.com" : "+1 604 555 0134"}
        className="h-11 w-full rounded-lg bg-field px-3 outline-none focus:ring-2 focus:ring-green/30"
      />
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <button
        onClick={sendCode}
        disabled={pending}
        className="h-11 w-full rounded-lg bg-green text-paper hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "Sending…" : "Send code"}
      </button>
    </div>
  );
}
