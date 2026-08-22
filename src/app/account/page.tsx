import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getAccountData } from "@/db/queries";
import { signOutAction } from "@/app/actions";
import ApiKeyPanel from "@/components/ApiKeyPanel";
import AccountManager from "@/components/AccountManager";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const data = await getAccountData(session.user.id);
  const firstName = session.user.name?.split(" ")[0];

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-3xl sm:text-4xl">
            Welcome back{firstName ? `, ${firstName}` : ""}
          </h1>
          <p className="mt-1 break-all text-ink-soft">{session.user.email}</p>
        </div>
        <form action={signOutAction}>
          <button className="shrink-0 rounded-lg border border-black/15 px-3 py-1.5 text-sm hover:border-green hover:text-green">
            Sign out
          </button>
        </form>
      </div>

      <p className="mt-6 max-w-2xl text-sm text-ink-soft">
        Build a pipeline: pick a <span className="text-green-dark">subscription</span>, optionally shape it with an{" "}
        <span className="text-rust">artifact</span>, then choose an <span className="text-sky-700">action</span> to
        deliver it: a script, a Discord channel, or a mailing list.
      </p>

      <div className="mt-6">
        <AccountManager
          subscriptions={data.subscriptions}
          targets={data.targets}
          artifacts={data.artifacts}
          rules={data.rules}
          mailingLists={data.mailingLists}
        />
      </div>

      <section className="mt-12 max-w-xl">
        <h2 className="text-xl">API access</h2>
        <p className="mt-1 text-sm text-ink-soft">
          Fetch your subscription updates programmatically with{" "}
          <code className="text-xs">GET /api/me/updates</code>.
        </p>
        <div className="mt-3">
          <ApiKeyPanel prefix={data.apiKeyPrefix} />
        </div>
      </section>
    </main>
  );
}
