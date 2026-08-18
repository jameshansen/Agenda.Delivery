"use client";

import { useState, useTransition } from "react";
import { savePushTarget, deletePushTarget } from "@/app/actions";

function TargetField({
  kind,
  label,
  placeholder,
  initialUrl,
}: {
  kind: "discord" | "webhook";
  label: string;
  placeholder: string;
  initialUrl: string;
}) {
  const [url, setUrl] = useState(initialUrl);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <label className="text-sm font-medium">{label}</label>
      <div className="mt-1 flex gap-2">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-lg border border-black/15 bg-white/60 px-3 py-1.5 text-sm"
        />
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              if (!url.trim()) {
                await deletePushTarget({ kind });
                return;
              }
              const res = await savePushTarget({ kind, url: url.trim() });
              if (!res.ok) setError(res.error ?? "Couldn't save.");
            })
          }
          className="shrink-0 rounded-lg border border-black/15 px-3 py-1.5 text-xs hover:border-green hover:text-green disabled:opacity-50"
        >
          {pending ? "…" : "Save"}
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
    </div>
  );
}

/** Account-level Discord webhook + custom URL — fires for every subscribed module's updates. */
export default function PushTargetsForm({
  discordUrl,
  webhookUrl,
}: {
  discordUrl: string;
  webhookUrl: string;
}) {
  return (
    <div className="space-y-4">
      <TargetField
        kind="discord"
        label="Discord webhook"
        placeholder="https://discord.com/api/webhooks/…"
        initialUrl={discordUrl}
      />
      <TargetField
        kind="webhook"
        label="Custom URL"
        placeholder="https://your-server.example/webhook"
        initialUrl={webhookUrl}
      />
    </div>
  );
}
