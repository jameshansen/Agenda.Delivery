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

-- ---- Auth.js tables (adapter-managed; finalized during UI port) ----
CREATE TABLE IF NOT EXISTS "user" (
  id             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name           TEXT,
  email          TEXT UNIQUE,
  email_verified TIMESTAMP,
  phone          TEXT UNIQUE,
  phone_verified TIMESTAMP,
  image          TEXT
);

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
  -- "glm-5.2", "gemma4:31b"), when it was an LLM call. NULL otherwise.
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

-- ---- Orchestrator / admin config -----------------------------
-- One row per agent. Prompts + params + schedule are editable in the
-- admin panel; agents read their prompt/model from here at run time so
-- prompt edits take effect without a redeploy.
CREATE TABLE IF NOT EXISTS agent_config (
  agent          agent_type PRIMARY KEY,
  display_name   TEXT NOT NULL,
  system_prompt  TEXT NOT NULL,
  model          TEXT NOT NULL DEFAULT 'glm-5.2',
  -- Free-form knobs (temperature, max chars, retry counts, ...).
  params         JSONB NOT NULL DEFAULT '{}',
  -- Seconds between scheduled runs; NULL = not scheduled (triggered only).
  schedule_secs  INTEGER,
  enabled        BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at     TIMESTAMP NOT NULL DEFAULT now()
);
