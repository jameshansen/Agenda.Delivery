"use client";

import { useState, useTransition } from "react";
import { addCustomPrompt, deleteCustomPrompt } from "@/app/actions";

type Prompt = { id: string; promptText: string; pushUrl: string };

const MAX_PROMPTS = 5;

/** Up to 5 custom summary prompts, each run against every subscribed module's new agenda. */
export default function CustomPromptsPanel({ prompts: initial }: { prompts: Prompt[] }) {
  const [prompts, setPrompts] = useState(initial);
  const [promptText, setPromptText] = useState("");
  const [pushUrl, setPushUrl] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      {prompts.map((p) => (
        <div key={p.id} className="flex items-start justify-between gap-3 rounded-lg bg-row px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm">{p.promptText}</p>
            <p className="mt-1 truncate text-xs text-ink-soft">
              {p.pushUrl ? `→ ${p.pushUrl}` : "No push URL set — results have nowhere to go yet."}
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              startTransition(async () => {
                await deleteCustomPrompt({ id: p.id });
                setPrompts((cur) => cur.filter((x) => x.id !== p.id));
              })
            }
            className="shrink-0 rounded-lg border border-rose-300 px-2 py-1 text-xs text-rose-600 hover:bg-rose-50"
          >
            Remove
          </button>
        </div>
      ))}

      {prompts.length < MAX_PROMPTS ? (
        <div className="space-y-2 rounded-lg border border-dashed border-black/15 p-3">
          <textarea
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            placeholder="e.g. Flag anything related to zoning changes near downtown"
            rows={2}
            className="w-full rounded-lg border border-black/15 bg-white/60 px-3 py-1.5 text-sm"
          />
          <input
            type="url"
            value={pushUrl}
            onChange={(e) => setPushUrl(e.target.value)}
            placeholder="Push URL (optional)"
            className="w-full rounded-lg border border-black/15 bg-white/60 px-3 py-1.5 text-sm"
          />
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                const res = await addCustomPrompt({ promptText, pushUrl });
                if (!res.ok) {
                  setError(res.error ?? "Couldn't add prompt.");
                  return;
                }
                setPrompts((cur) => [...cur, { id: res.id!, promptText, pushUrl }]);
                setPromptText("");
                setPushUrl("");
              })
            }
            className="rounded-lg border border-black/15 px-3 py-1.5 text-xs hover:border-green hover:text-green disabled:opacity-50"
          >
            {pending ? "…" : "Add prompt"}
          </button>
          {error && <p className="text-xs text-rose-600">{error}</p>}
        </div>
      ) : (
        <p className="text-xs text-ink-soft">You&apos;ve used all {MAX_PROMPTS} custom prompts.</p>
      )}
    </div>
  );
}
