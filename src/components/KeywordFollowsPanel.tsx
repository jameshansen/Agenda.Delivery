"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { updateKeywordFollowPushUrl, unfollowKeyword } from "@/app/actions";

type Follow = {
  keywordId: string;
  keyword: string;
  moduleSlug: string;
  moduleName: string;
  pushUrl: string;
};

/** Push-URL config for keywords followed from module pages (the Follow button lives there). */
export default function KeywordFollowsPanel({ follows: initial }: { follows: Follow[] }) {
  const [follows, setFollows] = useState(initial);

  if (follows.length === 0) {
    return (
      <p className="text-sm text-ink-soft">
        You&apos;re not following any keywords yet — follow one from a module page.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {follows.map((f) => (
        <FollowRow key={f.keywordId} follow={f} onRemove={() => setFollows((cur) => cur.filter((x) => x.keywordId !== f.keywordId))} />
      ))}
    </div>
  );
}

function FollowRow({ follow, onRemove }: { follow: Follow; onRemove: () => void }) {
  const [pushUrl, setPushUrl] = useState(follow.pushUrl);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="rounded-lg bg-row px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <Link href={`/module/${follow.moduleSlug}`} className="text-sm font-medium hover:text-green">
          {follow.keyword} <span className="text-ink-soft">— {follow.moduleName}</span>
        </Link>
        <button
          type="button"
          onClick={() => startTransition(async () => { await unfollowKeyword({ keywordId: follow.keywordId }); onRemove(); })}
          className="shrink-0 rounded-lg border border-rose-300 px-2 py-1 text-xs text-rose-600 hover:bg-rose-50"
        >
          Unfollow
        </button>
      </div>
      <div className="mt-2 flex gap-2">
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
              const res = await updateKeywordFollowPushUrl({ keywordId: follow.keywordId, pushUrl });
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
