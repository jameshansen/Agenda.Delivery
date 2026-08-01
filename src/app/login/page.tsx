import Link from "next/link";

// ponytail: UI only. Real Google/OAuth wiring is Phase 3.
const providers = [
  { name: "Continue with Google", mark: "G" },
  { name: "Continue with GitHub", mark: "" },
  { name: "Continue with Microsoft", mark: "▦" },
];

export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm text-center">
        <Link href="/" className="text-3xl tracking-tight">
          <span className="text-green-dark">agenda</span>
          <span className="text-green">.delivery</span>
        </Link>
        <p className="mt-3 text-ink-soft">
          Sign in to subscribe to agendas and follow keywords.
        </p>

        <div className="mt-8 space-y-3">
          {providers.map((p) => (
            <Link
              key={p.name}
              href="/account"
              className="flex items-center justify-center gap-3 rounded-lg border border-black/15 bg-white/60 px-4 py-3 hover:border-green hover:bg-white"
            >
              <span className="font-semibold">{p.mark}</span>
              {p.name}
            </Link>
          ))}
        </div>

        <div className="my-6 flex items-center gap-3 text-xs text-ink-soft">
          <span className="h-px flex-1 bg-black/10" /> or <span className="h-px flex-1 bg-black/10" />
        </div>

        <form action="/account" className="space-y-3">
          <input
            type="email"
            required
            placeholder="you@email.com"
            className="h-11 w-full rounded-lg bg-field px-4 outline-none focus:ring-2 focus:ring-green/30"
          />
          <button className="h-11 w-full rounded-lg bg-green text-paper hover:opacity-90">
            Continue with email
          </button>
        </form>

        <p className="mt-6 text-xs text-ink-soft">
          By continuing you agree to the terms. Open source, no dark patterns.
        </p>
      </div>
    </main>
  );
}
