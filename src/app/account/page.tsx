import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getSubscriptionsForUser } from "@/db/queries";
import { signOutAction } from "@/app/actions";
import UnsubscribeButton from "@/components/UnsubscribeButton";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const subs = await getSubscriptionsForUser(session.user.id);
  const firstName = session.user.name?.split(" ")[0];

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl sm:text-4xl">
            Welcome back{firstName ? `, ${firstName}` : ""}
          </h1>
          <p className="mt-1 text-ink-soft">{session.user.email}</p>
        </div>
        <form action={signOutAction}>
          <button className="rounded-lg border border-black/15 px-3 py-1.5 text-sm hover:border-green hover:text-green">
            Sign out
          </button>
        </form>
      </div>

      <div className="mt-8 grid gap-8 md:grid-cols-2">
        {/* Subscriptions */}
        <section>
          <h2 className="text-xl">Your subscriptions</h2>
          {subs.length === 0 ? (
            <p className="mt-3 text-sm text-ink-soft">
              No subscriptions yet.{" "}
              <Link href="/" className="hover:text-green">
                Find an agenda →
              </Link>
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {subs.map((s) => (
                <li
                  key={s.slug}
                  className="flex items-center justify-between rounded-lg bg-row px-4 py-3"
                >
                  <Link
                    href={`/module/${s.slug}`}
                    className="font-medium hover:text-green"
                  >
                    {s.name}
                  </Link>
                  <div className="flex items-center gap-3">
                    <span className="rounded-full bg-green/10 px-2 py-0.5 text-xs text-green-dark">
                      by {s.channel}
                    </span>
                    <UnsubscribeButton slug={s.slug} name={s.name} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Recent updates */}
        <section>
          <h2 className="text-xl">Recent updates</h2>
          {subs.length === 0 ? (
            <p className="mt-3 text-sm text-ink-soft">
              Updates from agendas you subscribe to will show here.
            </p>
          ) : (
            <ul className="mt-3 space-y-3">
              {subs.map((s) => (
                <li
                  key={s.slug}
                  className="rounded-lg border border-black/10 bg-white/40 p-4"
                >
                  <div className="flex items-center justify-between">
                    <Link
                      href={`/module/${s.slug}`}
                      className="font-medium hover:text-green"
                    >
                      {s.name}
                    </Link>
                    <span className="text-xs text-ink-soft">
                      {s.lastUpdated}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-ink-soft">
                    {s.summary.slice(0, 160)}
                    {s.summary.length > 160 ? "…" : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}