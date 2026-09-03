"use client";

// Shared bits for the account tabs. Extracted from AccountManager when the
// account page grew from one panel to three.

export const inputCls =
  "w-full rounded-lg border border-black/15 bg-white/70 px-3 py-2 text-sm outline-none focus:border-green";
export const labelCls = "block text-xs font-medium text-ink-soft mb-1";
export const btnCls =
  "rounded-lg border border-black/15 px-3 py-1.5 text-sm hover:border-green hover:text-green disabled:opacity-40";
export const primaryBtnCls =
  "rounded-lg bg-green px-3 py-1.5 text-sm text-paper hover:opacity-90 disabled:opacity-50";

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-black/10 bg-white/60 p-3 ${className}`}>{children}</div>;
}

export function Dialog({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className={`max-h-[92vh] w-full overflow-y-auto rounded-2xl bg-paper p-5 shadow-xl ${wide ? "max-w-4xl" : "max-w-md"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg">{title}</h3>
          <button onClick={onClose} className="text-ink-soft hover:text-ink" aria-label="Close">
            <i className="fa-solid fa-xmark" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function SectionHeading({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-xl">{title}</h2>
        {hint && <p className="mt-1 max-w-2xl text-sm text-ink-soft">{hint}</p>}
      </div>
      {action}
    </div>
  );
}
