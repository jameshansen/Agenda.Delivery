-- ─────────────────────────────────────────────────────────────
-- agenda.delivery — canonical Postgres schema (no ORM)
--
-- Applied automatically by the postgres container on first boot
-- (mounted into /docker-entrypoint-initdb.d). Idempotent: safe to
-- re-run. Replaces the old Drizzle migrations.
--
-- Owners:
--   - agents (Python) write agent_event, agent_run, meeting, highlight,
--     keyword, scrape_config, spider_candidate, and module fields.
--   - ui (Next.js) reads everything; writes only subscription + auth tables.
--   - orchestrator (Python) writes agent_run + agent_config + reads schedules.
-- ─────────────────────────────────────────────────────────────

-- gen_random_uuid() is built in on Postgres 13+.

-- ---- Enums ---------------------------------------------------
DO $$ BEGIN
  CREATE TYPE health AS ENUM ('healthy', 'repairing', 'broken');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE channel AS ENUM ('email', 'text');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE run_status AS ENUM ('pending', 'running', 'completed', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE agent_type AS ENUM (
    'spider', 'scraper_create', 'scraper_repair', 'checking',
    'categorization', 'summary', 'keyword'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE spider_candidate_status AS ENUM (
    'discovered', 'geo_located', 'queued', 'created', 'rejected'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE push_target_kind AS ENUM ('discord', 'webhook');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---- Auth.js tables (adapter-managed; finalized during UI port) ----
CREATE TABLE IF NOT EXISTS "user" (
  id             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name           TEXT,
  email          TEXT UNIQUE,
  email_verified TIMESTAMP,
  phone          TEXT UNIQUE,
  phone_verified TIMESTAMP,
  image          TEXT,
  -- Phase 6: hashed API key for GET /api/me/updates.
  api_key_hash   TEXT UNIQUE,
  api_key_prefix TEXT
);
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS api_key_hash TEXT UNIQUE;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS api_key_prefix TEXT;

CREATE TABLE IF NOT EXISTS account (
  user_id             TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  type                TEXT NOT NULL,
  provider            TEXT NOT NULL,
  provider_account_id TEXT NOT NULL,
  refresh_token       TEXT,
  access_token        TEXT,
  expires_at          INTEGER,
  token_type          TEXT,
  scope               TEXT,
  id_token            TEXT,
  session_state       TEXT,
  PRIMARY KEY (provider, provider_account_id)
);

CREATE TABLE IF NOT EXISTS session (
  session_token TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  expires       TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS verification_token (
  identifier TEXT NOT NULL,
  token      TEXT NOT NULL,
  expires    TIMESTAMP NOT NULL,
  PRIMARY KEY (identifier, token)
);

-- ---- App tables ----------------------------------------------
CREATE TABLE IF NOT EXISTS module (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  slug          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  region        TEXT NOT NULL,
  source_url    TEXT NOT NULL,
  health        health NOT NULL DEFAULT 'healthy',
  followers     INTEGER NOT NULL DEFAULT 0,
  last_updated  TIMESTAMP,
  next_expected TIMESTAMP,
  summary       TEXT,
  last_checked  TIMESTAMP,
  lat           REAL,
  lng           REAL,
  -- Broad entity kind for filtering ("council" | "organization"); set by the
  -- Spider Agent from sources.toml's optional `kind` field, defaults to council.
  gov_type      TEXT NOT NULL DEFAULT 'council',
  -- Seeded reference module, never touched by agents (Task 2 demo module).
  is_demo       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS highlight (
  id        TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  module_id TEXT NOT NULL REFERENCES module(id) ON DELETE CASCADE,
  tag       TEXT NOT NULL,
  text      TEXT NOT NULL,
  sort      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS keyword (
  id        TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  module_id TEXT NOT NULL REFERENCES module(id) ON DELETE CASCADE,
  keyword   TEXT NOT NULL,
  followers INTEGER NOT NULL DEFAULT 0,
  related   TEXT[] NOT NULL DEFAULT '{}',
  summary   TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS meeting (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  module_id   TEXT NOT NULL REFERENCES module(id) ON DELETE CASCADE,
  date        TIMESTAMP NOT NULL,
  title       TEXT NOT NULL,
  kind        TEXT NOT NULL,
  pages       INTEGER NOT NULL DEFAULT 0,
  pdf_url     TEXT,
  meeting_url TEXT
);
CREATE INDEX IF NOT EXISTS meeting_module_date_idx ON meeting (module_id, date);
CREATE UNIQUE INDEX IF NOT EXISTS meeting_module_date_title_uniq
  ON meeting (module_id, date, title);

CREATE TABLE IF NOT EXISTS agent_event (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  module_id  TEXT REFERENCES module(id) ON DELETE CASCADE,
  run_id     TEXT,
  agent      TEXT NOT NULL,
  action     TEXT NOT NULL,
  tool       TEXT,
  detail     TEXT,
  sort       INTEGER NOT NULL DEFAULT 0,
  -- Resized JPEG data URI of the browser at this nav step (demo/activity-
  -- feed purposes only -- see tools._capture_screenshot). NULL for
  -- non-browser-driven steps (most static-path agent actions).
  screenshot TEXT,
  -- Full system+user prompt / raw LLM response for this step, when it was
  -- an actual LLM call -- lets the UI offer an "expand to view full
  -- prompt/response" affordance without cluttering the short human-
  -- readable action/detail fields most events use. NULL for non-LLM steps.
  prompt TEXT,
  response TEXT,
  -- The Ollama model that actually served this step's LLM call (e.g.
  -- "glm-5.3", "gemma4:31b"), when it was an LLM call. NULL otherwise.
  model TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);
ALTER TABLE agent_event ADD COLUMN IF NOT EXISTS screenshot TEXT;
ALTER TABLE agent_event ADD COLUMN IF NOT EXISTS prompt TEXT;
ALTER TABLE agent_event ADD COLUMN IF NOT EXISTS response TEXT;
ALTER TABLE agent_event ADD COLUMN IF NOT EXISTS model TEXT;
CREATE INDEX IF NOT EXISTS agent_event_run_idx ON agent_event (run_id);
CREATE INDEX IF NOT EXISTS agent_event_module_idx ON agent_event (module_id, created_at);

CREATE TABLE IF NOT EXISTS subscription (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id    TEXT REFERENCES "user"(id) ON DELETE CASCADE,
  module_id  TEXT NOT NULL REFERENCES module(id) ON DELETE CASCADE,
  channel    channel NOT NULL,
  contact    TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_run (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  module_id   TEXT REFERENCES module(id) ON DELETE CASCADE,
  agent       agent_type NOT NULL,
  status      run_status NOT NULL DEFAULT 'pending',
  trigger     TEXT NOT NULL,
  started_at  TIMESTAMP,
  finished_at TIMESTAMP,
  error       TEXT,
  created_at  TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_run_module_idx ON agent_run (module_id, created_at DESC);

CREATE TABLE IF NOT EXISTS scrape_config (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  module_id     TEXT NOT NULL UNIQUE REFERENCES module(id) ON DELETE CASCADE,
  agenda_url    TEXT NOT NULL,
  link_selector TEXT,
  file_types    TEXT[] NOT NULL DEFAULT '{pdf}',
  hints         TEXT,
  version       INTEGER NOT NULL DEFAULT 1,
  verified      BOOLEAN NOT NULL DEFAULT TRUE,
  -- Best-effort guess at the meeting-portal platform (escribe/legistar/civicweb/...),
  -- set once the browser nav loop has visited the site. NULL = unknown/static site.
  platform      TEXT,
  -- The click/goto trail the browser nav loop took to reach the latest agenda,
  -- as a JSON array. Diagnostic + a starting point for repair; the cheap path
  -- (agenda_url) is tried first on every recurring check, this is the fallback.
  nav_recipe    TEXT,
  -- LLM-authored Python `extract()` function, self-tested before saving,
  -- that reproduces the browser-discovered path as a direct HTTP fetch
  -- (no browser session needed). The fast path: run this first on every
  -- check; only fall back to the browser nav loop when it fails, which
  -- then regenerates it. See agenda_shared.script_runner.
  extract_script TEXT,
  script_updated_at TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT now()
);
ALTER TABLE scrape_config ADD COLUMN IF NOT EXISTS platform TEXT;
ALTER TABLE scrape_config ADD COLUMN IF NOT EXISTS nav_recipe TEXT;
ALTER TABLE scrape_config ADD COLUMN IF NOT EXISTS extract_script TEXT;
ALTER TABLE scrape_config ADD COLUMN IF NOT EXISTS script_updated_at TIMESTAMP;

CREATE TABLE IF NOT EXISTS spider_candidate (
  id                     TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name                   TEXT NOT NULL,
  url                    TEXT NOT NULL UNIQUE,
  region                 TEXT,
  -- Where the spider found this candidate (registry name / search / seed).
  source                 TEXT,
  geo                    TEXT,
  status                 spider_candidate_status NOT NULL DEFAULT 'discovered',
  discovered_by_run_id   TEXT,
  -- Why it was rejected, if it was (surfaced on the spider admin page).
  reject_reason          TEXT,
  created_at             TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS spider_candidate_status_idx ON spider_candidate (status);

-- ---- Phase 6: push integrations & custom prompts --------------
CREATE TABLE IF NOT EXISTS push_target (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id    TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  kind       push_target_kind NOT NULL,
  url        TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS push_target_user_kind_uniq ON push_target (user_id, kind);

-- Capped at 5 per account by the server action, not a DB constraint.
CREATE TABLE IF NOT EXISTS custom_prompt (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id     TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  prompt_text TEXT NOT NULL,
  push_url    TEXT,
  created_at  TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS keyword_follow (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id    TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  keyword_id TEXT NOT NULL REFERENCES keyword(id) ON DELETE CASCADE,
  push_url   TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS keyword_follow_user_keyword_uniq ON keyword_follow (user_id, keyword_id);

-- ---- Orchestrator / admin config -----------------------------
-- One row per agent. Prompts + params + schedule are editable in the
-- admin panel; agents read their prompt/model from here at run time so
-- prompt edits take effect without a redeploy.
CREATE TABLE IF NOT EXISTS agent_config (
  agent          agent_type PRIMARY KEY,
  display_name   TEXT NOT NULL,
  system_prompt  TEXT NOT NULL,
  model          TEXT NOT NULL DEFAULT 'glm-5.3',
  -- Free-form knobs (temperature, max chars, retry counts, ...).
  params         JSONB NOT NULL DEFAULT '{}',
  -- Seconds between scheduled runs; NULL = not scheduled (triggered only).
  schedule_secs  INTEGER,
  enabled        BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at     TIMESTAMP NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────
-- Accounts redesign: Subscriptions → Artifacts → Actions flowchart,
-- plus mailing lists. Retires the push_target / custom_prompt /
-- keyword_follow model (those tables are left in place but unused).
-- Idempotent, safe to re-run against a live DB.
-- ─────────────────────────────────────────────────────────────

-- Per-agenda summary, preserved indefinitely (meeting rows are never
-- deleted). The module page's per-meeting Summary button expands to this.
ALTER TABLE meeting ADD COLUMN IF NOT EXISTS summary TEXT;

-- Backfill: the newest meeting per module inherits the module's current summary.
UPDATE meeting mt SET summary = m.summary
  FROM module m
 WHERE mt.module_id = m.id
   AND m.summary IS NOT NULL
   AND mt.summary IS NULL
   AND mt.id = (SELECT id FROM meeting x WHERE x.module_id = m.id
                ORDER BY x.date DESC LIMIT 1);

-- Reusable delivery targets (scripts + Discord hooks), created and reused
-- in the actions dialog.
CREATE TABLE IF NOT EXISTS automation_target (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id    TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,              -- 'script' | 'discord'
  name       TEXT NOT NULL,
  url        TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Reusable content transforms. kind 'custom_prompt' runs prompt_text against
-- the agenda; 'keywords' filters/summarizes by keywords; 'summary' is the
-- default AI summary.
CREATE TABLE IF NOT EXISTS automation_artifact (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id     TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,             -- 'summary' | 'custom_prompt' | 'keywords'
  name        TEXT NOT NULL,
  prompt_text TEXT,
  keywords    TEXT,
  created_at  TIMESTAMP NOT NULL DEFAULT now()
);

-- Mailing lists: header/footer/emails + send policy.
CREATE TABLE IF NOT EXISTS mailing_list (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id      TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  header       TEXT NOT NULL DEFAULT '',
  footer       TEXT NOT NULL DEFAULT '',
  emails       TEXT NOT NULL DEFAULT '',   -- newline/comma separated
  send_policy  TEXT NOT NULL DEFAULT 'threshold',  -- 'threshold' | 'schedule'
  threshold    INTEGER NOT NULL DEFAULT 5,
  frequency    TEXT NOT NULL DEFAULT 'weekly',      -- 'daily' | 'weekly'
  last_sent_at TIMESTAMP,
  created_at   TIMESTAMP NOT NULL DEFAULT now()
);

-- Items queued for a mailing list, drained on threshold or schedule.
CREATE TABLE IF NOT EXISTS mailing_queue (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  list_id    TEXT NOT NULL REFERENCES mailing_list(id) ON DELETE CASCADE,
  subject    TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  sent_at    TIMESTAMP
);
CREATE INDEX IF NOT EXISTS mailing_queue_list_unsent_idx ON mailing_queue (list_id) WHERE sent_at IS NULL;

-- The flowchart rule: subscription trigger → optional artifact transform → action.
CREATE TABLE IF NOT EXISTS automation_rule (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id      TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  module_id    TEXT NOT NULL REFERENCES module(id) ON DELETE CASCADE,
  trigger      TEXT NOT NULL DEFAULT 'new_agenda',   -- 'new_agenda' | 'new_summary'
  artifact_id  TEXT REFERENCES automation_artifact(id) ON DELETE SET NULL,
  content_mode TEXT NOT NULL DEFAULT 'summary',      -- 'summary' | 'link' | 'full_text' (when no artifact)
  action_kind  TEXT NOT NULL,                         -- 'script' | 'discord' | 'mailing_list'
  target_id    TEXT REFERENCES automation_target(id) ON DELETE CASCADE,
  list_id      TEXT REFERENCES mailing_list(id) ON DELETE CASCADE,
  created_at   TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS automation_rule_module_idx ON automation_rule (module_id);
CREATE INDEX IF NOT EXISTS automation_rule_user_idx ON automation_rule (user_id);

-- Output of a user's keyword artifact against a module's latest agenda.
-- Drives the module page's "Keyword summaries" section, which now shows ONLY
-- keyword presets that are actually referenced by an action on that module.
CREATE TABLE IF NOT EXISTS module_keyword_output (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  module_id   TEXT NOT NULL REFERENCES module(id) ON DELETE CASCADE,
  artifact_id TEXT NOT NULL REFERENCES automation_artifact(id) ON DELETE CASCADE,
  summary     TEXT NOT NULL,
  updated_at  TIMESTAMP NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS module_keyword_output_uniq ON module_keyword_output (module_id, artifact_id);

-- ─────────────────────────────────────────────────────────────
-- GLM 5.3 (Ollama Cloud retired the 5.2 tag). Existing agent_config
-- rows still point at the old tag; move them.
-- ─────────────────────────────────────────────────────────────
UPDATE agent_config SET model = 'glm-5.3' WHERE model = 'glm-5.2';

-- ─────────────────────────────────────────────────────────────
-- Escalation Agent — watches for failures and escalates to the admin.
-- ─────────────────────────────────────────────────────────────
ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'escalation';

-- Errors reported by the Next.js UI (error boundary + server catch points).
-- The escalation agent reads this table; nothing else writes it.
CREATE TABLE IF NOT EXISTS site_error (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  source     TEXT NOT NULL DEFAULT 'ui',   -- 'ui' | 'server' | 'api'
  level      TEXT NOT NULL DEFAULT 'error',
  message    TEXT NOT NULL,
  detail     TEXT,
  path       TEXT,
  digest     TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS site_error_created_idx ON site_error (created_at DESC);

-- One row per distinct problem the escalation agent found. `fingerprint`
-- is what stops the same failure being emailed on every tick.
CREATE TABLE IF NOT EXISTS escalation (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  kind        TEXT NOT NULL,               -- 'agent_run' | 'bad_output' | 'site_error' | 'module_broken'
  fingerprint TEXT NOT NULL UNIQUE,
  severity    TEXT NOT NULL DEFAULT 'warning',  -- 'info' | 'warning' | 'critical'
  subject     TEXT NOT NULL,
  body        TEXT NOT NULL,
  module_id   TEXT REFERENCES module(id) ON DELETE SET NULL,
  run_id      TEXT,
  notified_at TIMESTAMP,
  created_at  TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS escalation_unsent_idx ON escalation (created_at) WHERE notified_at IS NULL;

-- ─────────────────────────────────────────────────────────────
-- Mailing list manager: global subscribers, templates, sending settings.
-- ─────────────────────────────────────────────────────────────

-- Subscribers are per ACCOUNT, not per list — one address, reusable across
-- every list the account owns (the Substack model).
CREATE TABLE IF NOT EXISTS subscriber (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id    TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  email      TEXT NOT NULL,
  name       TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'unsubscribed'
  -- Per-subscriber merge-field overrides, keyed by merge_field.key.
  fields     JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS subscriber_user_email_uniq ON subscriber (user_id, lower(email));

-- Which subscribers a list sends to when its audience is 'selected'.
CREATE TABLE IF NOT EXISTS mailing_list_subscriber (
  list_id       TEXT NOT NULL REFERENCES mailing_list(id) ON DELETE CASCADE,
  subscriber_id TEXT NOT NULL REFERENCES subscriber(id) ON DELETE CASCADE,
  PRIMARY KEY (list_id, subscriber_id)
);

-- HTML email templates. user_id NULL = the built-in agenda.delivery default,
-- seeded once and shared by every account (read-only in the UI; users
-- duplicate it to edit). One source of truth for the UI and the sender.
CREATE TABLE IF NOT EXISTS email_template (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id    TEXT REFERENCES "user"(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  html       TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_template_user_idx ON email_template (user_id);

-- Template placeholder values, e.g. key 'organization_name'. Built-in keys
-- are defined in code; rows here hold the user's value plus any custom key.
CREATE TABLE IF NOT EXISTS merge_field (
  id      TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  key     TEXT NOT NULL,
  label   TEXT NOT NULL,
  value   TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS merge_field_user_key_uniq ON merge_field (user_id, key);

-- How an account's mailing lists actually leave the building. 'default'
-- relays through agenda.delivery's own Postfix as update@agenda.delivery.
CREATE TABLE IF NOT EXISTS sender_settings (
  user_id      TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  provider     TEXT NOT NULL DEFAULT 'default',   -- 'default' | 'sendgrid' | 'smtp'
  from_email   TEXT NOT NULL DEFAULT '',
  from_name    TEXT NOT NULL DEFAULT '',
  sendgrid_key TEXT,
  smtp_host    TEXT,
  smtp_port    INTEGER NOT NULL DEFAULT 587,
  smtp_user    TEXT,
  smtp_pass    TEXT,
  smtp_secure  BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at   TIMESTAMP NOT NULL DEFAULT now()
);

-- Mailing list: audience, template, and the new schedule shape.
ALTER TABLE mailing_list ADD COLUMN IF NOT EXISTS audience    TEXT NOT NULL DEFAULT 'all';    -- 'all' | 'selected'
ALTER TABLE mailing_list ADD COLUMN IF NOT EXISTS template_id TEXT REFERENCES email_template(id) ON DELETE SET NULL;
ALTER TABLE mailing_list ADD COLUMN IF NOT EXISTS weekday     INTEGER NOT NULL DEFAULT 0;      -- 0 = Monday .. 6 = Sunday
ALTER TABLE mailing_list ADD COLUMN IF NOT EXISTS month_day   TEXT NOT NULL DEFAULT 'first';   -- 'first' | 'last' | '2'..'28'

-- send_policy is now 'threshold' | 'weekly' | 'monthly'. The old 'schedule'
-- policy carried the cadence in `frequency`; fold it into the new shape.
UPDATE mailing_list SET send_policy = 'weekly' WHERE send_policy = 'schedule';

-- Lift the old newline/comma `emails` blob into real subscriber rows so
-- existing lists keep sending to exactly who they were sending to.
INSERT INTO subscriber (user_id, email)
SELECT ml.user_id, lower(trim(e))
  FROM mailing_list ml,
       LATERAL regexp_split_to_table(ml.emails, '[\n,;]+') AS e
 WHERE trim(e) <> ''
ON CONFLICT (user_id, lower(email)) DO NOTHING;

INSERT INTO mailing_list_subscriber (list_id, subscriber_id)
SELECT ml.id, s.id
  FROM mailing_list ml
  JOIN LATERAL regexp_split_to_table(ml.emails, '[\n,;]+') AS e ON TRUE
  JOIN subscriber s ON s.user_id = ml.user_id AND lower(s.email) = lower(trim(e))
 WHERE trim(e) <> ''
ON CONFLICT DO NOTHING;

-- A list that had an explicit address blob was never an "everyone" list.
UPDATE mailing_list SET audience = 'selected'
 WHERE audience = 'all' AND coalesce(trim(emails), '') <> '';
