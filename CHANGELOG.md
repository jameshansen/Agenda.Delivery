# Changelog

All notable changes to agenda.delivery will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] — Production Readiness

### Fixed (Round 2 — User-Facing Logic)

- **Seed script no longer erases agent progress**: The seed script now
  skips existing modules entirely by default. Use `--reset` to force a
  full wipe: `npm run db:seed:reset`. The `start-dev.ps1` script now
  clarifies this behavior.
- **"Self-repaired" label corrected to "repairing"**: The `repairing`
  health state is a transient "currently being repaired" status, not a
  past-tense "has been self-repaired" label. Fixed all UI label maps
  across the homepage, module page, and map page.
- **City of Langley seed health fixed**: The sample data was stuck at
  `repairing` even though the narrative says the repair succeeded.
  Changed to `healthy`.
- **Scraper Create Agent now populates agenda immediately**: After
  building and verifying the scrape config, the agent now runs
  `agenda.find_latest` to find and record the latest meeting, and
  generates an initial summary. This means modules have visible agendas
  right after the scraper runs, not only on the next checking cycle.
- **Scraper Repair Agent now re-fetches agenda after repair**: After a
  successful repair, the agent finds and records the latest meeting and
  regenerates the summary, so the module has fresh content immediately.
- **Meeting title extraction improved**: The `agenda.find_latest` tool
  now uses a 5-strategy title extraction (og:title → `<title>` tag →
  filtered `<h1>` → filtered `<h2>` → date-based fallback) instead of
  blindly taking the first `<h1>`, which was picking up generic page
  headings like "Council Calendar".
- **Generic calendar entries filtered out**: Both `getModulesPaged` and
  `getModuleBySlug` now filter out generic "Council Calendar" /
  "Meetings and Agendas" entries when looking for the latest council
  meeting, so these don't appear as the "latest meeting" on the
  homepage or module page.
- **`lastChecked` timestamp added**: Modules now track when the Checking
  Agent last ran, displayed on the module page as "Last checked".

### Fixed (P0 Critical Bugs)
- **Categorization Agent crash**: Fixed `findData.meetingTitle` ReferenceError by
  fetching the latest meeting title from the DB before passing to the LLM.
- **Spider Agent race condition**: Added `onConflictDoNothing()` to module and
  spider candidate inserts, plus a unique constraint on `spider_candidate.url`,
  to prevent duplicate modules under concurrent spider runs.
- **Pipeline stale data bug**: `runFullPipeline` now uses
  `recheckAgent.latestAgendaText` (not the stale `mod.summary`) after a
  repair, and never falls back to the DB summary in the non-repair path.
- **Scheduler fire-and-forget repair**: The scheduler now calls the synchronous
  `runScraperRepairAgent()` and awaits completion before continuing, preventing
  wasted checking runs on still-broken modules.
- **RSS feed date parsing**: Added `dateRaw` (raw `Date`) to the meeting query
  result so the RSS route formats from the actual date object, not the
  pre-formatted display string.
- **Geolocation hallucination**: The `geo.locate` tool now queries the real
  Nominatim (OpenStreetMap) geocoding API first, falling back to the LLM only
  with an explicit "approximate" disclaimer.

### Fixed (P1 Agent Flow)
- **Summary Agent empty content guard**: Skips summarization when agenda text
  is under 100 characters.
- **Keyword Agent limit**: Now limits to 5 keywords per module (product spec).
- **Agent run timeout**: `runAgent()` now races the agent against a 10-minute
  timeout to prevent stuck agents blocking the scheduler.

### Fixed (P1 Usability & UX)
- **Map page**: Replaced hardcoded pins with real lat/lng data from modules,
  projected onto an equirectangular North America bounding box. Health status
  is reflected in pin color.
- **LiveAgentLog replay logic**: Simplified the convoluted replay logic that
  could replace all events — now always appends replayed events, capping at 50.
- **Search highlighting**: Search results now highlight matched terms in
  `<mark>` elements.
- **SubscribeCard validation**: Added email/phone format validation with
  specific error messages. Errors are now logged to console.
- **Unsubscribe**: Added unsubscribe action and `UnsubscribeButton` client
  component with confirmation dialog on the account page.

### Fixed (P1 Data Integrity)
- **Meeting deduplication**: Added unique index on `(moduleId, date, title)` and
  `onConflictDoNothing()` on meeting inserts to prevent duplicates.
- **Spider candidate URL uniqueness**: Added unique constraint on
  `spider_candidate.url`.

### Added (P2 Infrastructure)
- **Health check endpoint**: `GET /api/health` checks DB connectivity and env
  var validity. Returns 503 if unhealthy. Dockerfile healthcheck updated.
- **Sitemap**: `GET /sitemap.xml` lists all module pages and static pages.
- **robots.txt**: Allows all crawlers, disallows `/api/`, `/account`, `/login`.
- **Error pages**: Custom `not-found.tsx` (404) and `error.tsx` (500) pages.
- **RSS feed discovery**: Module pages now include `<link rel="alternate">`
  for RSS auto-discovery.
- **Structured logging**: `src/lib/logger.ts` with JSON format in production
  and readable format in dev.
- **Environment variable validation**: `src/lib/env.ts` validates required
  env vars on startup and in the health check.
- **Constants file**: `src/lib/constants.ts` centralizes all magic numbers.

### Added (P2 Security)
- **Rate limiting on agent trigger**: 10 runs per minute per IP on
  `/api/agents/run`.
- **PDF URL validation**: The `agenda.find_latest` tool blocks non-HTTP(S)
  URLs and private/internal IP ranges to prevent SSRF.
- **Secure cookies**: Auth.js cookies now set `secure: true` in production.
- **Content Security Policy**: Added CSP and security headers via
  `next.config.ts`.

### Fixed (P3 Code Quality)
- **Duplicate import**: Removed duplicate `import { eq }` in `seed.ts`.
- **Unused imports**: Cleaned up unused imports across spider.ts, checking.ts,
  scheduler.ts, agents page, GeoLocate, and debug-spider.ts.
- **Lint fixes**: Fixed ref-during-render error in LiveAgentLog,
  `prefer-const` in queries.ts, and removed unused eslint-disable directives.

## [0.1.0] — Initial Release

- Next.js 16 App Router with React 19, TypeScript, Tailwind v4
- Postgres + Drizzle ORM with migrations and seed data
- Auth.js Google OAuth
- 6-agent system: Spider, Scraper Create/Repair, Checking, Summary, Keyword,
  Categorization
- SSE live agent activity streaming
- Module pages with AI summaries, highlights, keyword summaries, RSS feeds
- Landing page with search, province filter, geolocation
- Coverage map, spider page, agents dashboard
- Docker multi-stage build, nginx reverse proxy, GitHub Actions CI/CD