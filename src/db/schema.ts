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
  phone: text("phone").unique(),
  phoneVerified: timestamp("phone_verified", { mode: "date" }),
  image: text("image"),
  // Hashed (sha256) API key for GET /api/me/updates; apiKeyPrefix (first 8
  // chars of the raw key) is shown in the account UI so a user can tell
  // which key they're looking at without ever storing the raw value.
  apiKeyHash: text("api_key_hash").unique(),
  apiKeyPrefix: text("api_key_prefix"),
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
  // Broad entity kind for filtering ("council" | "organization").
  govType: text("gov_type").notNull().default("council"),
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
    /** Per-agenda AI summary, preserved indefinitely (the "artifact"). */
    summary: text("summary"),
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
  /** Resized JPEG data URI of the browser at this nav step, demo purposes only. */
  screenshot: text("screenshot"),
  /** Full system+user LLM prompt / raw response for this step, when it was an LLM call. */
  prompt: text("prompt"),
  response: text("response"),
  /** The Ollama model that served this step's LLM call (e.g. "glm-5.2"). */
  model: text("model"),
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

/* ---- Phase 6: push integrations & custom prompts ---- */

export const pushTargetKindEnum = pgEnum("push_target_kind", ["discord", "webhook"]);

/** One Discord webhook + one custom-URL push target per account. */
export const pushTargets = pgTable(
  "push_target",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: pushTargetKindEnum("kind").notNull(),
    url: text("url").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("push_target_user_kind_uniq").on(t.userId, t.kind)],
);

/** Up to 5 per account (enforced in the server action, not the schema). */
export const customPrompts = pgTable("custom_prompt", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  promptText: text("prompt_text").notNull(),
  pushUrl: text("push_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** Per-user follow of a module's keyword, with its own optional push URL. */
export const keywordFollows = pgTable(
  "keyword_follow",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    keywordId: text("keyword_id")
      .notNull()
      .references(() => keywords.id, { onDelete: "cascade" }),
    pushUrl: text("push_url"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("keyword_follow_user_keyword_uniq").on(t.userId, t.keywordId)],
);

/* ---- Accounts redesign: Subscriptions → Artifacts → Actions flowchart ---- */

/** Reusable delivery targets (scripts + Discord hooks), reused across rules. */
export const automationTargets = pgTable("automation_target", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // "script" | "discord"
  name: text("name").notNull(),
  url: text("url").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** Reusable content transforms: default summary, custom prompt, or keywords. */
export const automationArtifacts = pgTable("automation_artifact", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // "summary" | "custom_prompt" | "keywords"
  name: text("name").notNull(),
  promptText: text("prompt_text"),
  keywords: text("keywords"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** Mailing lists: header/footer/emails + send policy. */
export const mailingLists = pgTable("mailing_list", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  header: text("header").notNull().default(""),
  footer: text("footer").notNull().default(""),
  emails: text("emails").notNull().default(""),
  sendPolicy: text("send_policy").notNull().default("threshold"), // "threshold" | "schedule"
  threshold: integer("threshold").notNull().default(5),
  frequency: text("frequency").notNull().default("weekly"), // "daily" | "weekly"
  lastSentAt: timestamp("last_sent_at", { mode: "date" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** Items queued for a mailing list, drained on threshold or schedule. */
export const mailingQueue = pgTable("mailing_queue", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  listId: text("list_id").notNull().references(() => mailingLists.id, { onDelete: "cascade" }),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  sentAt: timestamp("sent_at", { mode: "date" }),
});

/** The flowchart rule: subscription trigger → optional artifact → action. */
export const automationRules = pgTable(
  "automation_rule",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    moduleId: text("module_id").notNull().references(() => modules.id, { onDelete: "cascade" }),
    trigger: text("trigger").notNull().default("new_agenda"), // "new_agenda" | "new_summary"
    artifactId: text("artifact_id").references(() => automationArtifacts.id, { onDelete: "set null" }),
    contentMode: text("content_mode").notNull().default("summary"), // "summary" | "link" | "full_text"
    actionKind: text("action_kind").notNull(), // "script" | "discord" | "mailing_list"
    targetId: text("target_id").references(() => automationTargets.id, { onDelete: "cascade" }),
    listId: text("list_id").references(() => mailingLists.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("automation_rule_module_idx").on(t.moduleId), index("automation_rule_user_idx").on(t.userId)],
);

/** Output of a keyword artifact against a module's latest agenda. Drives the
 * module page's keyword section (shown only for presets used by an action). */
export const moduleKeywordOutputs = pgTable(
  "module_keyword_output",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    moduleId: text("module_id").notNull().references(() => modules.id, { onDelete: "cascade" }),
    artifactId: text("artifact_id").notNull().references(() => automationArtifacts.id, { onDelete: "cascade" }),
    summary: text("summary").notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("module_keyword_output_uniq").on(t.moduleId, t.artifactId)],
);

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
