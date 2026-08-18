import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/db";
import { users, subscriptions, modules, meetings } from "@/db/schema";

export const dynamic = "force-dynamic";

/**
 * GET /api/me/updates — a user's own subscription updates, authenticated by
 * their API key (Authorization: Bearer agd_...), generated from the account
 * page. Returns the 10 most recent meetings per subscribed module.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const key = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!key) {
    return NextResponse.json({ error: "Missing Authorization: Bearer <api key> header" }, { status: 401 });
  }

  const hash = crypto.createHash("sha256").update(key).digest("hex");
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.apiKeyHash, hash)).limit(1);
  if (!user) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }

  const subs = await db
    .select({ slug: modules.slug, name: modules.name, moduleId: modules.id })
    .from(subscriptions)
    .innerJoin(modules, eq(subscriptions.moduleId, modules.id))
    .where(eq(subscriptions.userId, user.id));

  const results = await Promise.all(
    subs.map(async (s) => ({
      slug: s.slug,
      name: s.name,
      meetings: await db
        .select({ date: meetings.date, title: meetings.title, kind: meetings.kind, pdfUrl: meetings.pdfUrl, meetingUrl: meetings.meetingUrl })
        .from(meetings)
        .where(eq(meetings.moduleId, s.moduleId))
        .orderBy(desc(meetings.date))
        .limit(10),
    })),
  );

  return NextResponse.json({ modules: results });
}
