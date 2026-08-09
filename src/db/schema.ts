import {
  pgTable,
  pgEnum,
  text,
  integer,
  boolean,
  timestamp,
  primaryKey,
  real,
  index,
  uniqueIndex,
  jsonb,
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
  /** When the Checking Agent last ran for this module. */
  lastChecked: timestamp("last_checked", { mode: "date" }),
  // Geolocation from the Spider Agent's geo.locate tool
  lat: real("lat"),
  lng: real("lng"),
  // Seeded reference module (never touched by agents).
  isDemo: boolean("is_demo").notNull().default(false),
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

export const meetings = pgTable(
  "meeting",
  {
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
    /** Direct URL to the agenda PDF (the first / primary PDF link found). */
    pdfUrl: text("pdf_url"),
    /** URL of the meeting detail page where the agenda was found. */
    meetingUrl: text("meeting_url"),
  },
  (t) => [
    index("meeting_module_date_idx").on(t.moduleId, t.date),
    // Prevent duplicate meetings: same module + date + title
    uniqueIndex("meeting_module_date_title_uniq").on(
      t.moduleId,
      t.date,
      t.title,
    ),
  ],
);

export const agentEvents = pgTable("agent_event", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  moduleId: text("module_id")
    .references(() => modules.id, { onDelete: "cascade" }),
  /** Links to the agent_run this event belongs to (Phase 4). */
  runId: text("run_id"),
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

/* ---- Phase 4: Agent system tables ---- */

export const runStatusEnum = pgEnum("run_status", [
  "pending",
  "running",
  "completed",
  "failed",
]);

export const agentTypeEnum = pgEnum("agent_type", [
  "spider",
  "scraper_create",
  "scraper_repair",
  "checking",
  "categorization",
  "summary",
  "keyword",
]);

/**
 * A single invocation of an agent. Groups all agent_event rows that belong
 * to one logical run (e.g. "check module X for new agendas").
 */
export const agentRuns = pgTable("agent_run", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  moduleId: text("module_id").references(() => modules.id, {
    onDelete: "cascade",
  }),
  agent: agentTypeEnum("agent").notNull(),
  status: runStatusEnum("status").notNull().default("pending"),
  trigger: text("trigger").notNull(), // "manual" | "schedule" | "spider" | "repair"
  startedAt: timestamp("started_at", { mode: "date" }),
  finishedAt: timestamp("finished_at", { mode: "date" }),
  error: text("error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/**
 * The scraping configuration an agent builds for a module. Stores the
 * extraction logic (selectors / patterns) so the Checking Agent can
 * re-use it and the Repair Agent can rewrite it.
 */
export const scrapeConfigs = pgTable("scrape_config", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  moduleId: text("module_id")
    .notNull()
    .unique()
    .references(() => modules.id, { onDelete: "cascade" }),
  // The entry-point URL the agent determined agendas live on.
  agendaUrl: text("agenda_url").notNull(),
  // CSS selector or XPath the agent uses to find agenda links.
  linkSelector: text("link_selector"),
  // File types to look for: ["pdf", "html", "docx"]
  fileTypes: text("file_types").array().notNull().default(["pdf"]),
  // JSON blob of additional extraction hints the agent discovered.
  hints: text("hints"),
  // What version of the scraping logic this is (incremented on repair).
  version: integer("version").notNull().default(1),
  // Whether the config was last verified working.
  verified: boolean("verified").notNull().default(true),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
});

/**
 * A candidate source the Spider Agent discovered but hasn't been turned
 * into a module yet. Moves through a pipeline: discovered → geo_located →
 * queued → created.
 */
export const spiderCandidateStatusEnum = pgEnum("spider_candidate_status", [
  "discovered",
  "geo_located",
  "queued",
  "created",
  "rejected",
]);

export const spiderCandidates = pgTable("spider_candidate", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  // Unique URL so concurrent spider runs can't create duplicate candidates.
  url: text("url").notNull().unique(),
  region: text("region"),
  // Where the spider found this candidate (registry / search / seed).
  source: text("source"),
  // lat,lng string once geo-located by the agent.
  geo: text("geo"),
  status: spiderCandidateStatusEnum("status").notNull().default("discovered"),
  // Which spider run discovered this candidate.
  discoveredByRunId: text("discovered_by_run_id"),
  // Why it was rejected, if it was (shown on the spider admin page).
  rejectReason: text("reject_reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/**
 * Editable per-agent configuration (admin panel). Agents read their prompt +
 * model from here at run time; the orchestrator reads schedule_secs + enabled.
 */
export const agentConfig = pgTable("agent_config", {
  agent: agentTypeEnum("agent").primaryKey(),
  displayName: text("display_name").notNull(),
  systemPrompt: text("system_prompt").notNull(),
  model: text("model").notNull().default("glm-5.2"),
  params: jsonb("params").notNull().default({}),
  scheduleSecs: integer("schedule_secs"),
  enabled: boolean("enabled").notNull().default(true),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
});
