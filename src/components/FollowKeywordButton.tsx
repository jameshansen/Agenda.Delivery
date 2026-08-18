"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { followKeyword, unfollowKeyword } from "@/app/actions";

/** Follow/unfollow a keyword. Push-URL config for it lives on the account page. */
export default function FollowKeywordButton({
  keywordId,
  signedIn,
  initiallyFollowed,
}: {
  keywordId: string;
  signedIn: boolean;
  initiallyFollowed: boolean;
}) {
  const [followed, setFollowed] = useState(initiallyFollowed);
  const [pending, startTransition] = useTransition();

  if (!signedIn) {
    return (
      <Link href="/login" className="text-xs text-ink-soft hover:text-green">
        Sign in to follow
      </Link>
    );
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        startTransition(async () => {
          if (followed) {
            await unfollowKeyword({ keywordId });
          } else {
            await followKeyword({ keywordId });
          }
          setFollowed((f) => !f);
        });
      }}
      className={`rounded-full px-2 py-0.5 text-xs ${
        followed
          ? "bg-green/10 text-green-dark hover:bg-rose-50 hover:text-rose-600"
          : "border border-black/15 text-ink-soft hover:border-green hover:text-green"
      } disabled:opacity-50`}
    >
      {pending ? "…" : followed ? "Following" : "Follow"}
    </button>
  );
}
