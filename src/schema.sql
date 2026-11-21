-- agenda.delivery v2 schema. Applied on every connect, so every statement is idempotent.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS user (
  id          INTEGER PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name        TEXT NOT NULL DEFAULT '',
  google_sub  TEXT UNIQUE,
  theme       TEXT NOT NULL DEFAULT 'light',   -- light | dark, chosen in Settings
  org_name    TEXT NOT NULL DEFAULT '',        -- the organization its custom-branded mailing lists send as, set in Settings
  logo        TEXT NOT NULL DEFAULT '',        -- that organization's logo: a file name under data_dir/media
  mail_colours TEXT NOT NULL DEFAULT '',       -- that organization's email colours, "#fg,#bg1,#bg2"; '' is the default
  monitor_seq INTEGER NOT NULL DEFAULT 0,      -- the last monitor number this account was given; numbers are never reused
  status      TEXT NOT NULL DEFAULT 'new',     -- new | pending | approved | declined: new accounts join with a code or an approved request
  signup_code TEXT,                            -- the code they joined with, if any
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen   TEXT
);

-- Recent attempts at rate-limited actions (sign-ins, codes, reports, previews), by key such as "report:<ip>".
CREATE TABLE IF NOT EXISTS hit (
  key  TEXT NOT NULL,
  at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS hit_key ON hit (key, at);

-- Sign-in links sent when an account is let in; opening one confirms the email address.
CREATE TABLE IF NOT EXISTS login_link (
  token_hash  TEXT PRIMARY KEY,
  email       TEXT NOT NULL COLLATE NOCASE,
  expires_at  TEXT NOT NULL
);

-- Codes that let a new account straight in. uses_left NULL means no limit.
CREATE TABLE IF NOT EXISTS signup_code (
  code        TEXT PRIMARY KEY COLLATE NOCASE,
  note        TEXT NOT NULL DEFAULT '',
  uses_left   INTEGER,
  used        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Problems people report from /report, signed in or not, seen in the admin panel.
CREATE TABLE IF NOT EXISTS problem_report (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER REFERENCES user(id) ON DELETE SET NULL,
  email       TEXT NOT NULL,
  kind        TEXT NOT NULL,                -- signup | prompt | bug | summary | other
  details     TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);

-- The registration form a new account fills in without a code, approved or declined in the admin panel.
CREATE TABLE IF NOT EXISTS join_request (
  user_id      INTEGER PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  organization TEXT NOT NULL DEFAULT '',
  community    TEXT NOT NULL,
  about        TEXT NOT NULL,
  use_for      TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at   TEXT
);

CREATE TABLE IF NOT EXISTS login_code (
  email       TEXT NOT NULL COLLATE NOCASE,
  code_hash   TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  tries       INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS login_code_email ON login_code (email);

-- A site is one organization's agenda page and video page. Every account that entered the same two has its own
-- monitor and agent, and they all share the site's record of how the pages work, so they learn and repair it once.
-- Sharing needs both pages to match, so no account's agent reads a page another account chose.
CREATE TABLE IF NOT EXISTS site (
  id             INTEGER PRIMARY KEY,
  agenda_url     TEXT NOT NULL COLLATE NOCASE,
  video_url      TEXT NOT NULL DEFAULT '' COLLATE NOCASE,
  name           TEXT NOT NULL,                      -- the name the first account gave it
  layout_notes   TEXT NOT NULL DEFAULT '',           -- what the agents learned about how the site is laid out
  members        TEXT NOT NULL DEFAULT '',           -- member names, one per line, for correcting transcripts
  meeting_types  TEXT NOT NULL DEFAULT '[]',         -- JSON [{"key","name","default"}] found at setup
  setup_state    TEXT NOT NULL DEFAULT 'pending',    -- pending | running | ready | failed
  setup_monitor  INTEGER,                            -- the monitor whose agent is doing the setup
  health         TEXT NOT NULL DEFAULT 'ok',         -- ok | repairing
  repair_monitor INTEGER,                            -- the monitor whose agent is repairing it
  repair_note    TEXT NOT NULL DEFAULT '',           -- what the repairing agent said had changed
  repair_started TEXT,
  fixed_at       TEXT,
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (agenda_url, video_url)
);

-- One monitor = one account watching one site = one agent. The account chooses which meeting types it
-- tracks and writes the prompt its summaries are made with.
-- A voice: named instructions for how summaries are written, which any of the account's monitors can use.
-- Every account has one default, which new monitors get.
CREATE TABLE IF NOT EXISTS voice (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  prompt      TEXT NOT NULL,
  markdown    INTEGER NOT NULL DEFAULT 1,
  is_default  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS monitor (
  id             INTEGER PRIMARY KEY,
  slug           TEXT NOT NULL UNIQUE,               -- the agent's internal key, "m-<id>": its folder, gateway and log
  num            INTEGER NOT NULL DEFAULT 0,         -- the account's own number for it, in its address /m/<num>/<name>
  user_id        INTEGER NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  site_id        INTEGER NOT NULL REFERENCES site(id),
  name           TEXT NOT NULL,
  kind           TEXT NOT NULL DEFAULT 'council',    -- council | regional_district | school_board | committee | organization | other
  visibility     TEXT NOT NULL DEFAULT 'public',     -- public | private (private needs the login teacher, not yet supported)
  video_url      TEXT NOT NULL DEFAULT '',
  video_source   TEXT NOT NULL DEFAULT 'page',       -- page | youtube
  state          TEXT NOT NULL DEFAULT 'setup',      -- setup (site being learned) | choose (pick types and summary) | ready
  meeting_types  TEXT NOT NULL DEFAULT '[]',         -- JSON list of the site's meeting type keys this account tracks
  summary_prompt TEXT NOT NULL DEFAULT '',           -- how this account's summaries are written
  summary_markdown INTEGER NOT NULL DEFAULT 1,       -- summaries are written in Markdown rather than plain text
  voice_id       INTEGER REFERENCES voice(id) ON DELETE SET NULL,  -- the voice it writes in; NULL uses summary_prompt above
  voice_note     TEXT NOT NULL DEFAULT '',          -- added to the voice for this monitor only
  -- Set when the first check finishes with the site working. Until then the agent is catching up on meetings
  -- already posted, which are saved but not sent: notifications are for what appears after the monitor is added.
  notify_from    TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, site_id),
  UNIQUE (user_id, num)
);

-- The agent behind a monitor: a NullClaw gateway the agenda delivery service keeps running.
-- desired_state is what the website asked for; the service makes it so and writes back what it finds.
CREATE TABLE IF NOT EXISTS agent (
  monitor_id     INTEGER PRIMARY KEY REFERENCES monitor(id) ON DELETE CASCADE,
  home           TEXT NOT NULL,
  unit           TEXT NOT NULL,                    -- a label, e.g. "agent:m-42"
  desired_state  TEXT NOT NULL DEFAULT 'enabled',  -- enabled | paused | removed
  actual_state   TEXT NOT NULL DEFAULT 'pending',  -- pending | enabled | paused | removed | error
  run_requested  INTEGER NOT NULL DEFAULT 0,      -- 1 Check now, 2 woken after another agent repaired the site
  last_run_start TEXT,
  last_run_end   TEXT,
  last_exit      INTEGER,
  next_run       TEXT,
  last_error     TEXT NOT NULL DEFAULT '',
  checked_at     TEXT,
  port           INTEGER,                          -- the gateway's loopback port
  pid            INTEGER,                          -- the gateway's process, while it runs
  started_at     TEXT,                             -- when the gateway last started
  restarts       INTEGER NOT NULL DEFAULT 0,       -- unplanned restarts since the service started it
  rss_kb         INTEGER                           -- the gateway's memory at the last check
);

-- One row per agent run: what started it, how it ended, and the agent's closing reply.
CREATE TABLE IF NOT EXISTS agent_run (
  id          INTEGER PRIMARY KEY,
  monitor_id  INTEGER NOT NULL REFERENCES monitor(id) ON DELETE CASCADE,
  trigger     TEXT NOT NULL,                -- setup | schedule | requested | repaired
  state       TEXT NOT NULL DEFAULT 'queued',  -- queued | running | completed | failed
  queued_at   TEXT NOT NULL DEFAULT (datetime('now')),
  started_at  TEXT,
  ended_at    TEXT,
  reply       TEXT NOT NULL DEFAULT '',
  error       TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS agent_run_monitor ON agent_run (monitor_id, id);

CREATE TABLE IF NOT EXISTS agenda (
  id          INTEGER PRIMARY KEY,
  monitor_id  INTEGER NOT NULL REFERENCES monitor(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  title       TEXT NOT NULL,
  meeting_date TEXT,
  meeting_type TEXT NOT NULL DEFAULT '',  -- a key from the site's meeting types
  summary     TEXT NOT NULL DEFAULT '',
  text        TEXT NOT NULL DEFAULT '',   -- the agenda's text, so summaries can be rewritten with a new prompt
  found_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (monitor_id, url)
);

CREATE TABLE IF NOT EXISTS video (
  id          INTEGER PRIMARY KEY,
  monitor_id  INTEGER NOT NULL REFERENCES monitor(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  title       TEXT NOT NULL,
  meeting_date TEXT,
  meeting_type TEXT NOT NULL DEFAULT '',  -- a key from the site's meeting types
  summary     TEXT NOT NULL DEFAULT '',
  transcript  TEXT NOT NULL DEFAULT '',
  found_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (monitor_id, url)
);

-- Every summary written for an agenda or video, newest last, with the instructions it was written from.
-- The agenda or video's own summary column is the newest of these.
-- Summaries waiting to be rewritten, such as the newest agenda of every monitor using a voice that was just
-- changed. The housekeeping tick works through a few each minute.
CREATE TABLE IF NOT EXISTS summary_job (
  id          INTEGER PRIMARY KEY,
  monitor_id  INTEGER NOT NULL REFERENCES monitor(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,                  -- agenda | video
  item_id     INTEGER NOT NULL,
  queued_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS summary (
  id          INTEGER PRIMARY KEY,
  monitor_id  INTEGER NOT NULL REFERENCES monitor(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,                  -- agenda | video
  item_id     INTEGER NOT NULL,
  prompt      TEXT,                           -- NULL for summaries written before the instructions were kept
  text        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS summary_item ON summary (monitor_id, kind, item_id, id);

-- Items still in motion: bylaws between readings, motions waiting on a staff report, deferred items.
CREATE TABLE IF NOT EXISTS pending_item (
  id          INTEGER PRIMARY KEY,
  monitor_id  INTEGER NOT NULL REFERENCES monitor(id) ON DELETE CASCADE,
  item_key    TEXT NOT NULL,          -- stable key the agent picks, e.g. "bylaw-2026-14"
  title       TEXT NOT NULL,
  status      TEXT NOT NULL,          -- e.g. "second reading", "awaiting staff report", "closed"
  detail      TEXT NOT NULL DEFAULT '',
  source_url  TEXT NOT NULL DEFAULT '',
  open        INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (monitor_id, item_key)
);

-- Every state a pending item has been in, so a summary can say where an item stood before the meeting it's about.
CREATE TABLE IF NOT EXISTS pending_history (
  monitor_id  INTEGER NOT NULL REFERENCES monitor(id) ON DELETE CASCADE,
  item_key    TEXT NOT NULL,
  title       TEXT NOT NULL,
  status      TEXT NOT NULL,
  detail      TEXT NOT NULL DEFAULT '',
  open        INTEGER NOT NULL,
  at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS pending_history_item ON pending_history (monitor_id, item_key, at);

-- Destinations live on the account, not the monitor, so one Discord webhook or mailing list serves many monitors.
-- Every account has one default destination, its own email address, which can be paused but not removed.
CREATE TABLE IF NOT EXISTS target (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,            -- email | discord | webhook | list (a mailing list, whose addresses are in list_member)
  name       TEXT NOT NULL,
  address    TEXT NOT NULL,            -- email address, URL or Pushover user key; empty for a list
  token      TEXT NOT NULL DEFAULT '', -- a Pushover app token of the account's own, in place of the site's
  mail_colours TEXT NOT NULL DEFAULT '', -- a list's own email colours, "#fg,#bg1,#bg2"; '' uses the account's
  -- WhatsApp: the state its bridge last reported (qr, connecting, open, closed, logged_out), since when, the linked
  -- number, whether it has ever been linked, and whether its owner has been told it dropped.
  wa_state   TEXT NOT NULL DEFAULT '',
  wa_since   TEXT,
  wa_me      TEXT NOT NULL DEFAULT '',
  wa_linked  INTEGER NOT NULL DEFAULT 0,
  wa_alerted INTEGER NOT NULL DEFAULT 0,
  wa_group   TEXT NOT NULL DEFAULT '',  -- the name of the WhatsApp group it sends to; the group's id is the address
  -- An email address other than the account's own gets nothing until its owner opens the link sent to it,
  -- so no one can use agenda.delivery to send mail to people who didn't ask for it.
  confirmed  INTEGER NOT NULL DEFAULT 1,
  confirm_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  is_default INTEGER NOT NULL DEFAULT 0,       -- 1 for the account's own email address
  paused     INTEGER NOT NULL DEFAULT 0,
  digest     TEXT NOT NULL DEFAULT 'now',      -- now | daily | weekly; email and lists only
  digest_day INTEGER NOT NULL DEFAULT 1,       -- the weekday a weekly digest goes out, 1 Monday to 7 Sunday
  unsub_token TEXT,                            -- the unsubscribe link sent to an address that isn't the account's own
  -- Mailing lists only: who the mail says it's from, whether replies go to the account, and text around each send.
  brand      TEXT NOT NULL DEFAULT 'agenda',   -- agenda (plain agenda.delivery) | account (the name and logo in Settings) | list (its own)
  sender_name TEXT NOT NULL DEFAULT '',        -- the list's own name to send as, when brand is list
  logo       TEXT NOT NULL DEFAULT '',         -- the list's own logo, a file name under data_dir/media
  reply_to_owner INTEGER NOT NULL DEFAULT 0,
  intro      TEXT NOT NULL DEFAULT '',
  footer     TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS target_default ON target (user_id) WHERE is_default = 1;

-- The addresses on a mailing list. Each gets nothing until its owner confirms from the link sent to it,
-- and every email carries its own unsubscribe link.
CREATE TABLE IF NOT EXISTS list_member (
  id           INTEGER PRIMARY KEY,
  target_id    INTEGER NOT NULL REFERENCES target(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  email        TEXT NOT NULL COLLATE NOCASE,
  name         TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'pending',   -- pending | active | unsubscribed
  confirm_hash TEXT,
  unsub_token  TEXT NOT NULL,
  invited_at   TEXT,
  confirmed_at TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (target_id, email)
);
CREATE INDEX IF NOT EXISTS list_member_unsub ON list_member (unsub_token);

-- Addresses that unsubscribed. They get no notification mail from that account again (user_id NULL: from any
-- account) and can't be added back by anyone but themselves, from the same unsubscribe link.
CREATE TABLE IF NOT EXISTS mail_block (
  email      TEXT NOT NULL COLLATE NOCASE,
  user_id    INTEGER REFERENCES user(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS mail_block_one ON mail_block (email, coalesce(user_id, 0));

-- A rule: when this monitor has news, send it to this target, shaped like this.
CREATE TABLE IF NOT EXISTS rule (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  monitor_id  INTEGER NOT NULL REFERENCES monitor(id) ON DELETE CASCADE,
  target_id   INTEGER NOT NULL REFERENCES target(id) ON DELETE CASCADE,
  content     TEXT NOT NULL DEFAULT 'summary',   -- summary | link | keywords | prompt
  keywords    TEXT NOT NULL DEFAULT '',
  prompt      TEXT NOT NULL DEFAULT '',
  events      TEXT NOT NULL DEFAULT 'agenda,video,pending',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Things that happened, waiting to be fanned out to rules. Filled by adtool, drained by bin/tick.php.
CREATE TABLE IF NOT EXISTS event (
  id          INTEGER PRIMARY KEY,
  monitor_id  INTEGER NOT NULL REFERENCES monitor(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,          -- agenda | video | pending
  title       TEXT NOT NULL,
  url         TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL DEFAULT '',
  text        TEXT NOT NULL DEFAULT '',   -- full agenda or transcript text for keyword and prompt rules, cleared once sent
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at     TEXT
);

-- What became of each event for each rule; the Notifications page shows these as the account's history.
CREATE TABLE IF NOT EXISTS delivery (
  event_id   INTEGER NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  rule_id    INTEGER NOT NULL REFERENCES rule(id) ON DELETE CASCADE,
  ok         INTEGER NOT NULL,
  error      TEXT NOT NULL DEFAULT '',
  sent_at    TEXT NOT NULL DEFAULT (datetime('now')),
  state      TEXT NOT NULL DEFAULT 'sent',   -- sent | quiet (nothing matched) | queued (waiting for a digest) | skipped | failed
  recipients INTEGER NOT NULL DEFAULT 0,     -- how many addresses a mailing list send reached
  PRIMARY KEY (event_id, rule_id)
);

-- Shaped notifications waiting for a destination's next daily or weekly digest.
CREATE TABLE IF NOT EXISTS digest_item (
  id         INTEGER PRIMARY KEY,
  target_id  INTEGER NOT NULL REFERENCES target(id) ON DELETE CASCADE,
  rule_id    INTEGER NOT NULL REFERENCES rule(id) ON DELETE CASCADE,
  event_id   INTEGER NOT NULL REFERENCES event(id) ON DELETE CASCADE,
  subject    TEXT NOT NULL,
  body       TEXT NOT NULL,
  url        TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS digest_item_target ON digest_item (target_id, id);

-- Every LLM call: the agents' own (read from each NullClaw token ledger) and the site's (custom prompts).
CREATE TABLE IF NOT EXISTS ai_usage (
  id          INTEGER PRIMARY KEY,
  monitor_id  INTEGER REFERENCES monitor(id) ON DELETE SET NULL,
  source      TEXT NOT NULL,          -- agent | prompt | summary | guard
  model       TEXT NOT NULL,
  prompt_tokens     INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  at          TEXT NOT NULL DEFAULT (datetime('now')),
  ledger_key  TEXT UNIQUE             -- dedupes ledger lines already imported
);

-- Every executable the service runs for an agent: Chrome, pdftotext, yt-dlp.
CREATE TABLE IF NOT EXISTS job (
  id          INTEGER PRIMARY KEY,
  monitor_id  INTEGER REFERENCES monitor(id) ON DELETE SET NULL,
  tool        TEXT NOT NULL,                   -- render | pdftotext | yt-dlp
  target      TEXT NOT NULL DEFAULT '',        -- the URL or file it worked on
  state       TEXT NOT NULL DEFAULT 'queued',  -- queued | running | done | failed
  slot        INTEGER,                         -- which browser slot, for render
  queued_at   TEXT NOT NULL DEFAULT (datetime('now')),
  started_at  TEXT,
  ended_at    TEXT,
  error       TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS job_state ON job (state, id);
