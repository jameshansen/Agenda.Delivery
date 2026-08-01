"use server";

import { eq } from "drizzle-orm";
import { auth, signIn, signOut } from "@/auth";
import { db } from "@/db";
import { modules, subscriptions } from "@/db/schema";

export async function signInGoogle() {
  await signIn("google", { redirectTo: "/account" });
}

export async function signOutAction() {
  await signOut({ redirectTo: "/" });
}

export async function subscribe(input: {
  slug: string;
  channel: "email" | "text";
  contact: string;
}) {
  const [m] = await db
    .select({ id: modules.id })
    .from(modules)
    .where(eq(modules.slug, input.slug))
    .limit(1);
  if (!m) throw new Error("Unknown module");

  const session = await auth();
  await db.insert(subscriptions).values({
    moduleId: m.id,
    channel: input.channel,
    contact: input.contact,
    userId: session?.user?.id ?? null,
  });
}
