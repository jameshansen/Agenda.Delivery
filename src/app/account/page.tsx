import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getAccountData } from "@/db/queries";
import AccountTabs from "@/components/AccountTabs";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const data = await getAccountData(session.user.id);
  const firstName = (data.profile.name || session.user.name)?.split(" ")[0];

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-8">
      {/* Sign out lives in the site header, and again under Account and API. */}
      <div className="min-w-0">
        <h1 className="text-3xl sm:text-4xl">
          Welcome back{firstName ? `, ${firstName}` : ""}
        </h1>
        <p className="mt-1 break-all text-ink-soft">{data.profile.email || session.user.email}</p>
      </div>

      <div className="mt-8">
        <AccountTabs data={data} />
      </div>
    </main>
  );
}
