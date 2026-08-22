"use client";

import { useState } from "react";

export type MeetingRow = {
  date: string;
  title: string;
  kind: string;
  pages: number;
  pdfUrl: string | null;
  meetingUrl: string | null;
  summary: string | null;
};

export default function MeetingsList({ meetings }: { meetings: MeetingRow[] }) {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <ul className="mt-3 divide-y divide-black/5 rounded-xl border border-black/10 bg-white/40">
      {meetings.map((mt, i) => {
        const isOpen = open === i;
        return (
          <li key={i} className="px-4 py-3">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{mt.title}</span>
                  <span className="rounded-full bg-ink/5 px-2 py-0.5 text-xs text-ink-soft">
                    {mt.kind}
                  </span>
                </div>
                <div className="text-sm text-ink-soft">
                  {mt.date}
                  {mt.pages > 0 && ` · ${mt.pages} page${mt.pages === 1 ? "" : "s"}`}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {mt.pdfUrl ? (
                  <a
                    href={mt.pdfUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-rust/40 bg-rust/5 px-2.5 py-1 text-xs font-medium text-rust transition-colors hover:bg-rust/10"
                  >
                    <i className="fa-solid fa-file-pdf" /> PDF
                  </a>
                ) : mt.meetingUrl ? (
                  <a
                    href={mt.meetingUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-black/15 bg-white/60 px-2.5 py-1 text-xs font-medium text-ink-soft transition-colors hover:border-green hover:text-green"
                  >
                    <i className="fa-solid fa-up-right-from-square" /> View
                  </a>
                ) : null}
                {mt.summary && (
                  <button
                    onClick={() => setOpen(isOpen ? null : i)}
                    aria-expanded={isOpen}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                      isOpen
                        ? "border-green bg-green/10 text-green-dark"
                        : "border-black/15 bg-white/60 text-ink-soft hover:border-green hover:text-green"
                    }`}
                  >
                    <i className={`fa-solid ${isOpen ? "fa-chevron-up" : "fa-align-left"}`} /> Summary
                  </button>
                )}
              </div>
            </div>
            {isOpen && mt.summary && (
              <p className="mt-3 rounded-lg bg-row/60 px-3 py-2 text-sm leading-relaxed text-ink">
                {mt.summary}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
