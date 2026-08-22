import Link from "next/link";
import { auth } from "@/auth";
import { signOutAction } from "@/app/actions";

export default async function SiteHeader() {
  const session = await auth();

  return (
    <header className="border-b border-black/5">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-4 py-4 sm:px-6">
        <Link href="/" className="shrink-0 whitespace-nowrap text-xl tracking-tight sm:text-2xl">
          <span className="text-green-dark">agenda</span>
          <span className="text-green">.delivery</span>
        </Link>
        <nav className="flex items-center gap-3 whitespace-nowrap text-sm sm:gap-6">
          <Link href="/map" className="hover:text-green">
            Map
          </Link>
          <Link href="/spider" className="hover:text-green">
            Spider
          </Link>
          <Link href="/agents" className="hover:text-green">
            Agents
          </Link>
          {session?.user ? (
            <>
              <Link href="/account" className="hover:text-green">
                Account
              </Link>
              <form action={signOutAction}>
                <button className="whitespace-nowrap rounded-lg border border-black/15 px-3 py-1.5 hover:border-green hover:text-green">
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <Link
              href="/login"
              className="whitespace-nowrap rounded-lg bg-green px-3 py-1.5 text-paper transition-opacity hover:opacity-90"
            >
              Sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
