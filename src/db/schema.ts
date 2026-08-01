import {
  pgTable,
  pgEnum,
  text,
  integer,
  timestamp,
  primaryKey,
} from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";

/* ---- Auth.js (Drizzle adapter) tables ---- */

export const users = pgTable("user", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("email_verified", { mode: "date" }),
  image: text("image"),
});

export const accounts = pgTable(
  "account",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => [
    primaryKey({ columns: [account.provider, account.providerAccountId] }),
  ],
);

export const sessions = pgTable("session", {
  sessionToken: text("session_token").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_token",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (vt) => [primaryKey({ columns: [vt.identifier, vt.token] })],
);

/* ---- App tables ---- */

export const healthEnum = pgEnum("health", ["healthy", "repairing", "broken"]);
export const channelEnum = pgEnum("channel", ["email", "text"]);

export const modules = pgTable("module", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  region: text("region").notNull(),
  sourceUrl: text("source_url").notNull(),
  health: healthEnum("health").notNull().default("healthy"),
  followers: integer("followers").notNull().default(0),
  lastUpdated: timestamp("last_updated", { mode: "date" }),
  nextExpected: timestamp("next_expected", { mode: "date" }),
  summary: text("summary"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const highlights = pgTable("highlight", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  moduleId: text("module_id")
    .notNull()
    .references(() => modules.id, { onDelete: "cascade" }),
  tag: text("tag").notNull(),
  text: text("text").notNull(),
  sort: integer("sort").notNull().default(0),
});

export const keywords = pgTable("keyword", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  moduleId: text("module_id")
    .notNull()
    .references(() => modules.id, { onDelete: "cascade" }),
  keyword: text("keyword").notNull(),
  followers: integer("followers").notNull().default(0),
  related: text("related").array().notNull(),
  summary: text("summary").notNull(),
});

export const meetings = pgTable("meeting", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  moduleId: text("module_id")
    .notNull()
    .references(() => modules.id, { onDelete: "cascade" }),
  date: timestamp("date", { mode: "date" }).notNull(),
  title: text("title").notNull(),
  kind: text("kind").notNull(),
  pages: integer("pages").notNull().default(0),
});

export const agentEvents = pgTable("agent_event", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  moduleId: text("module_id")
    .notNull()
    .references(() => modules.id, { onDelete: "cascade" }),
  agent: text("agent").notNull(),
  action: text("action").notNull(),
  tool: text("tool"),
  detail: text("detail"),
  sort: integer("sort").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const subscriptions = pgTable("subscription", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
  moduleId: text("module_id")
    .notNull()
    .references(() => modules.id, { onDelete: "cascade" }),
  channel: channelEnum("channel").notNull(),
  contact: text("contact").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
