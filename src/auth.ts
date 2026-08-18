import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db } from "@/db";
import { users, accounts, sessions, verificationTokens } from "@/db/schema";

const IS_HTTPS = (process.env.NEXTAUTH_URL ?? process.env.AUTH_URL ?? "").startsWith("https://");

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  providers: [Google],
  pages: { signIn: "/login" },
  // Required for self-hosted deployments behind a reverse proxy (nginx here):
  // without it, auth() rejects every request as "UntrustedHost" because it
  // can't otherwise verify the incoming Host header matches NEXTAUTH_URL.
  trustHost: true,
  session: {
    // Use secure cookies in production
    strategy: "database",
  },
  cookies: {
    sessionToken: {
      name: "next-auth.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        // Derived from NEXTAUTH_URL's protocol, not NODE_ENV: this app runs
        // with NODE_ENV=production in docker-compose even for local
        // HTTP-only testing (nginx does no TLS locally), and a browser
        // silently drops a Secure cookie set over plain HTTP -- see the
        // matching fix in src/lib/session.ts for the OTP sign-in path.
        secure: IS_HTTPS,
      },
    },
    callbackUrl: {
      name: "next-auth.callback-url",
      options: {
        sameSite: "lax",
        path: "/",
        secure: IS_HTTPS,
      },
    },
    csrfToken: {
      name: "next-auth.csrf-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: IS_HTTPS,
      },
    },
  },
  callbacks: {
    session({ session, user }) {
      session.user.id = user.id;
      // @ts-expect-error -- phone isn't part of NextAuth's default User shape.
      session.user.phone = (user as typeof users.$inferSelect).phone ?? null;
      return session;
    },
  },
});
