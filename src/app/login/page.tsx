import Link from "next/link";
import { signInGoogle } from "@/app/actions";
import { SMS_ENABLED } from "@/lib/features";

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

        <form action={signInGoogle} className="mt-8">
          <button
            type="submit"
            className="flex w-full items-center justify-center gap-3 rounded-lg border border-black/15 bg-white/60 px-4 py-3 hover:border-green hover:bg-white"
          >
            <span className="font-semibold text-green">G</span>
            Continue with Google
          </button>
        </form>

        <div className="my-6 flex items-center gap-3 text-xs text-ink-soft">
          <span className="h-px flex-1 bg-black/10" /> or{" "}
          <span className="h-px flex-1 bg-black/10" />
        </div>

        <Link
          href="/signup"
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-black/15 bg-white/60 px-4 py-3 hover:border-green hover:bg-white"
        >
          Continue with email{SMS_ENABLED ? " or phone" : ""}
        </Link>

        <p className="mt-6 text-xs text-ink-soft">
          Open source, no dark patterns.
        </p>
      </div>
    </main>
  );
}
