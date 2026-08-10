import crypto from "crypto";
import { cookies, headers } from "next/headers";
import { db } from "@/db";
import { sessions } from "@/db/schema";

const SESSION_COOKIE = "next-auth.session-token";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, matches Auth.js's default.

/**
 * Create a database session row (same table/shape Auth.js's DrizzleAdapter
 * uses for its "database" session strategy) and set the session cookie,
 * so an OTP-verified sign-in produces a real `auth()`-readable session
 * without needing a NextAuth Credentials provider.
 */
export async function createSession(userId: string): Promise<void> {
  const sessionToken = crypto.randomUUID();
  const expires = new Date(Date.now() + SESSION_TTL_MS);

  await db.insert(sessions).values({ sessionToken, userId, expires });

  // NODE_ENV alone isn't reliable here: this app runs with NODE_ENV=production
  // in docker-compose even for local HTTP-only testing (nginx does no TLS
  // termination locally). A browser silently drops a Secure cookie set over
  // plain HTTP, so trusting NODE_ENV would break every sign-in in that setup.
  // x-forwarded-proto (set by nginx/any real reverse proxy) reflects what the
  // client actually connected over; fall back to NODE_ENV only if it's absent
  // (e.g. `next dev` with no proxy in front of it).
  const forwardedProto = (await headers()).get("x-forwarded-proto");
  const isSecure = forwardedProto ? forwardedProto === "https" : process.env.NODE_ENV === "production";

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: isSecure,
    expires,
  });
}
