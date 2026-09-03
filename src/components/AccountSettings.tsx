"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  updateAccountName,
  requestEmailChange,
  confirmEmailChange,
  signOutAction,
} from "@/app/actions";
import ApiKeyPanel from "@/components/ApiKeyPanel";
import { SectionHeading, inputCls, labelCls, btnCls, primaryBtnCls } from "@/components/account-ui";

export type Profile = { name: string; email: string; providers: string[] };

export default function AccountSettings({
  profile,
  apiKeyPrefix,
}: {
  profile: Profile;
  apiKeyPrefix: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const [name, setName] = useState(profile.name);
  const [email, setEmail] = useState(profile.email);
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);

  const isGoogle = profile.providers.includes("google");

  function run<T extends { ok: boolean; error?: string }>(fn: () => Promise<T>, done?: string) {
    setErr(null);
    setNote(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) {
        setErr(res.error ?? "Something went wrong.");
        return;
      }
      if (done) setNote(done);
      router.refresh();
    });
  }

  return (
    <div className="space-y-10">
      {err && <div className="rounded-lg bg-rose-500/10 px-4 py-2 text-sm text-rose-700">{err}</div>}
      {note && <div className="rounded-lg bg-green/10 px-4 py-2 text-sm text-green-dark">{note}</div>}

      <section className="max-w-xl">
        <SectionHeading title="Account" hint="How you sign in and how you're addressed in emails." />

        <div className="mt-4 space-y-4">
          <div>
            <label className={labelCls}>Name</label>
            <div className="flex gap-2">
              <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
              <button
                disabled={pending || name.trim() === profile.name}
                onClick={() => run(() => updateAccountName({ name }), "Name updated.")}
                className={primaryBtnCls}
              >
                Save
              </button>
            </div>
          </div>

          <div>
            <label className={labelCls}>Email address</label>
            {isGoogle ? (
              <>
                <input value={profile.email} readOnly className={`${inputCls} opacity-70`} />
                <p className="mt-1 text-xs text-ink-soft">
                  <i className="fa-brands fa-google mr-1" />
                  This account signs in with Google, so the address is managed there.
                </p>
              </>
            ) : (
              <>
                <div className="flex gap-2">
                  <input
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); setCodeSent(false); }}
                    className={inputCls}
                  />
                  <button
                    disabled={pending || !email.trim() || email.trim().toLowerCase() === profile.email}
                    onClick={() =>
                      run(async () => {
                        const res = await requestEmailChange({ email });
                        if (res.ok) setCodeSent(true);
                        return res;
                      }, "Code sent to the new address.")
                    }
                    className={btnCls}
                  >
                    Send code
                  </button>
                </div>
                {codeSent && (
                  <div className="mt-2 flex gap-2">
                    <input
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      inputMode="numeric"
                      maxLength={6}
                      placeholder="6-digit code"
                      className={`${inputCls} max-w-[10rem] tracking-widest`}
                    />
                    <button
                      disabled={pending || code.length < 6}
                      onClick={() =>
                        run(async () => {
                          const res = await confirmEmailChange({ email, code });
                          if (res.ok) { setCodeSent(false); setCode(""); }
                          return res;
                        }, "Email address updated.")
                      }
                      className={primaryBtnCls}
                    >
                      Confirm
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          <div>
            <label className={labelCls}>Password</label>
            <p className="text-sm text-ink-soft">
              {isGoogle
                ? "Signing in goes through Google, so there is no password here to change."
                : "This account has no password — sign-in sends a one-time code to your email address instead."}
            </p>
          </div>
        </div>
      </section>

      <section className="max-w-xl">
        <SectionHeading
          title="API access"
          hint="Fetch your subscription updates programmatically with GET /api/me/updates."
        />
        <div className="mt-3">
          <ApiKeyPanel prefix={apiKeyPrefix} />
        </div>
      </section>

      <section className="max-w-xl">
        <SectionHeading title="Session" />
        <form action={signOutAction} className="mt-3">
          <button className={btnCls}>
            <i className="fa-solid fa-arrow-right-from-bracket mr-1.5" />
            Sign out
          </button>
        </form>
      </section>
    </div>
  );
}
