import { eq } from "drizzle-orm";
import { db } from "@/db";
import { subscribers } from "@/db/schema";
import { confirmUnsubscribe } from "@/app/actions";

export const dynamic = "force-dynamic";

/**
 * The {{unsubscribe_url}} landing page. The subscriber id is the token — it's
 * a UUID, so it isn't guessable — and the actual opt-out is a POST behind a
 * button, because mail scanners follow every link in a message and a GET
 * would unsubscribe people who never clicked anything.
 */
export default async function UnsubscribePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [sub] = await db
    .select({ email: subscribers.email, status: subscribers.status })
    .from(subscribers)
    .where(eq(subscribers.id, id))
    .limit(1);

  return (
    <main className="mx-auto w-full max-w-lg px-6 py-24 text-center">
      {!sub ? (
        <>
          <h1 className="text-2xl">Link not recognised</h1>
          <p className="mt-2 text-ink-soft">
            This unsubscribe link has expired or the address was already removed.
          </p>
        </>
      ) : sub.status === "unsubscribed" ? (
        <>
          <h1 className="text-2xl">You&apos;re unsubscribed</h1>
          <p className="mt-2 break-all text-ink-soft">
            {sub.email} will not receive any more of these emails.
          </p>
        </>
      ) : (
        <>
          <h1 className="text-2xl">Unsubscribe?</h1>
          <p className="mt-2 break-all text-ink-soft">
            Stop sending mailing list emails to {sub.email}.
          </p>
          <form action={confirmUnsubscribe} className="mt-6">
            <input type="hidden" name="id" value={id} />
            <button className="rounded-lg bg-green px-5 py-2.5 text-paper transition-opacity hover:opacity-90">
              Yes, unsubscribe me
            </button>
          </form>
        </>
      )}
    </main>
  );
}
