# agenda.delivery

**Live at [agenda.delivery](https://agenda.delivery).**

Never miss an update from your local **council, committee, organization, non-profit, charity, or business.**

agenda.delivery is an open-source, AI-enabled service that watches public meeting agendas, summarizes them in plain language, and routes what matters to wherever you work. A network of self-healing AI agents discovers sources, builds its own scraping logic, notices when a site changes, and repairs itself, with every step visible in the UI.

## What you can do

- **Follow any agenda** by council, committee, or community organization, and browse by region or by your location.
- **Read plain-language summaries** with key highlights and topic tags, generated for every new agenda and preserved indefinitely.
- **Build actions**, a flowchart of Subscriptions, Artifacts, and Actions. When a source you follow publishes a new agenda, optionally shape it with an artifact (the AI summary, a custom prompt, or your own keywords) and deliver it to your email, a Discord channel, a script endpoint, or a mailing list. Script and Discord targets are reusable across actions.
- **Run mailing lists** with your own header and footer, sent on a schedule or once the queue reaches a threshold, so a community group can keep its members informed automatically.
- **Track keywords** across every source you follow, and pull everything through a developer API.

## Origins

agenda.delivery grew out of community work. It started with the [Langley Urbanist Society's council summaries](https://langleyurbanistsociety.ca/council-summaries), where I summarized Township of Langley and City of Langley council meetings for the group to keep members informed and to flag upcoming issues and opportunities to speak. This system expands that idea and opens the same ability to everyone, from individuals keeping an eye on their own community to other community groups staying aware of the decisions that affect their work.

## Stack

- **Web:** Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4
- **Backend:** Next.js Route Handlers + Server Actions (BFF)
- **Data:** Postgres · Drizzle ORM
- **Auth:** Auth.js (NextAuth v5) with Google OAuth
- **LLM:** Ollama cloud (glm-5.3-flash for agents, gemma4 for summaries) — OpenAI-compatible endpoint
- **Agents:** Custom framework (base class, tool registry, SSE event streaming) — no external agent library
- **Brand font:** Gelica (local, `src/app/fonts`)
- Agents, data-engineering, and infra are later phases (see roadmap).

## Run

```bash
npm install
```

Copy the environment template:

```bash
cp .env.example .env
```

Bring up the whole stack: Postgres (with the schema and sample modules on first start), Redis, the orchestrator and agents, the test council, and the UI behind nginx:

```bash
docker compose up -d --build
```

Open http://localhost.

`db/schema.sql` is the schema of record. Postgres applies it with `db/seed.sql` when the database is first created, and the `schema` service re-applies it on every `docker compose up`, so an existing database picks up schema changes.

**Google sign-in** is optional: add `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` to
`.env` (redirect URI `http://localhost/api/auth/callback/google`). Without
them, browsing, search, module pages, and email/text subscribe all still work;
only the account area needs sign-in.

`npm run db:studio` opens Drizzle Studio on the running database.

## Roadmap

Building front-to-back: UI and site first, backend after.

- **Phase 0 — Foundation** ✅ repo, Next+TS+Tailwind, brand palette + Gelica font.
- **Phase 1 — Landing page** ✅ logo, rotating tagline, search, view-map link, "newest agendas monitored" list.
- **Phase 2 — Rest of the site (UI, mock data):** module/agenda detail (AI summary, highlights, per-keyword summaries, RSS, subscribe, **live agent-activity log bubbles**), map page, live spider page, account dashboard, Google-login UI.
- **Phase 3 — Backend foundation** ✅ Postgres + Drizzle schema/migrations, seed,
  Auth.js Google OAuth, accounts, subscriptions. All pages read live data from
  the DB (verified end-to-end on Docker Postgres).
- **Phase 4 — Agent system** ✅ Agent framework (base class, tool registry,
  event emitter, SSE streaming); 7 agents (Spider, Scraper Create/Repair,
  Checking, Summary, Keyword, Categorization, Escalation); Ollama cloud LLM
  client (glm-5.3-flash for reasoning, gemma4 for summaries); API routes to trigger runs
  and stream events; live agent-activity UI with run buttons; `agent_run`,
  `scrape_config`, `spider_candidate` tables; dev mock LLM so it works
  without an API key.
- **Phase 5 — Data & storage:** S3 historical store, high compression, PDF image stripping; data-engineering pipeline.
- **Phase 6 — Notifications:** email + Twilio SMS + RSS.
- **Phase 7 — Infra & observability:** Docker/compose/nginx, Kubernetes, AWS, Datadog/OpenTelemetry/Prometheus/Grafana, CI/CD.
  ✅ Docker (multi-stage standalone), one compose stack (UI, orchestrator, agents, Postgres, Redis, nginx),
  nginx reverse proxy (rate-limiting, gzip, security headers), GitHub Actions CI on master
  (lint, type-check, build, schema, self-checks). See [DEPLOYMENT.md](DEPLOYMENT.md).
- **Phase 8 — Admin panel:** Admin UI, open to the signed-in accounts in `ADMIN_EMAILS`, for manually triggering agent
  runs, managing modules, viewing agent run history, editing scrape configs, approving
  spider candidates, and monitoring system health. Includes a cron/scheduler to run
  agents on a fixed cadence (checking agent every 6h, spider daily).

## Test scripts

```bash
# Run individual agents against the DB (requires Postgres + .env)
npm run test:scraper                # Scraper Create Agent (defaults to township-of-langley)
npm run test:checking               # Checking Agent
npm run test:summary                # Summary Agent (uses gemma4:31b)
npm run test:spider                 # Spider Agent (discovers new sources)
npm run test:pipeline               # Full pipeline: Check → Repair → Summarize → Keywords → Categorize

# Pass a module slug as an argument:
npm run test:scraper -- city-of-langley
```

End-to-end checks run against a fictional council, the City of Testville at [testcouncil.agenda.delivery](https://testcouncil.agenda.delivery), which publishes a new agenda on demand. [TESTING.md](TESTING.md) walks through every feature with it.

## License

[GNU General Public License v3.0 or later](LICENSE) (GPL-3.0-or-later).
