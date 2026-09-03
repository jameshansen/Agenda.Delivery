import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { subscribers } from "@/db/schema";

export const dynamic = "force-dynamic";

/**
 * POST /api/unsubscribe/[id] — RFC 8058 one-click unsubscribe.
 *
 * This is the URI in the List-Unsubscribe header. Gmail and Outlook POST to
 * it directly when someone hits their native "Unsubscribe" button, with no
 * browser and no confirmation step, so it has to be a plain route handler —
 * the /unsubscribe/[id] page's server action would reject an unadorned POST.
 *
 * The subscriber id is the token: it's a UUID, so it isn't guessable, and
 * the only thing this can ever do is opt someone out. RFC 8058 forbids
 * requiring any further interaction, so there is deliberately no
 * confirmation here — the human-facing page is what asks.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) return NextResponse.json({ ok: false }, { status: 400 });

  await db
    .update(subscribers)
    .set({ status: "unsubscribed" })
    .where(eq(subscribers.id, id));

  // Always 200: telling a caller whether an id exists would leak whether an
  // address is on someone's list, and mail clients only care that it worked.
  return NextResponse.json({ ok: true });
}
