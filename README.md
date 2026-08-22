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
- **LLM:** Ollama cloud (glm-5.2 for agents, gemma4 for summaries) — OpenAI-compatible endpoint
- **Agents:** Custom framework (base class, tool registry, SSE event streaming) — no external agent library
- **Brand font:** Gelica (local, `src/app/fonts`)
- Agents, data-engineering, and infra are later phases (see roadmap).

## Run

```bash
npm install
```

Start Postgres (needs Docker), apply the schema, and seed the sample modules:

```bash
docker compose up -d
```

```bash
cp .env.example .env
```

```bash
npm run db:migrate && npm run db:seed
```

Then the app:

```bash
npm run dev
```

Open http://localhost:3000.

**Google sign-in** is optional: add `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` to
`.env` (redirect URI `http://localhost:3000/api/auth/callback/google`). Without
them, browsing, search, module pages, and email/text subscribe all still work;
only the account area needs sign-in.

DB scripts: `db:migrate` (apply committed migrations), `db:seed` (load samples),
`db:generate` (new migration after a schema change), `db:studio` (Drizzle
Studio). `db:push` also exists but is interactive — use `db:migrate` in scripts.

## Roadmap

Building front-to-back: UI and site first, backend after.

- **Phase 0 — Foundation** ✅ repo, Next+TS+Tailwind, brand palette + Gelica font.
- **Phase 1 — Landing page** ✅ logo, rotating tagline, search, view-map link, "newest agendas monitored" list.
- **Phase 2 — Rest of the site (UI, mock data):** module/agenda detail (AI summary, highlights, per-keyword summaries, RSS, subscribe, **live agent-activity log bubbles**), map page, live spider page, account dashboard, Google-login UI.
- **Phase 3 — Backend foundation** ✅ Postgres + Drizzle schema/migrations, seed,
  Auth.js Google OAuth, accounts, subscriptions. All pages read live data from
  the DB (verified end-to-end on Docker Postgres).
- **Phase 4 — Agent system** ✅ Agent framework (base class, tool registry,
  event emitter, SSE streaming); 6 agents (Spider, Scraper Create/Repair,
  Checking, Summary, Keyword, Categorization); Ollama cloud LLM client
  (glm-5.2 for reasoning, gemma4 for summaries); API routes to trigger runs
  and stream events; live agent-activity UI with run buttons; `agent_run`,
  `scrape_config`, `spider_candidate` tables; dev mock LLM so it works
  without an API key.
- **Phase 5 — Data & storage:** S3 historical store, high compression, PDF image stripping; data-engineering pipeline.
- **Phase 6 — Notifications:** email + Twilio SMS + RSS.
- **Phase 7 — Infra & observability:** Docker/compose/nginx, Kubernetes, AWS, Datadog/OpenTelemetry/Prometheus/Grafana, CI/CD.
  ✅ Docker (multi-stage standalone), production docker-compose (app+Postgres+nginx),
  nginx reverse proxy (rate-limiting, gzip, SSE-aware, security headers), GitHub Actions
  CI/CD (lint+typecheck+build+test on PR, auto-deploy on main). See [DEPLOYMENT.md](DEPLOYMENT.md).
- **Phase 8 — Admin panel:** Password-protected admin UI for manually triggering agent
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

## License

[GNU General Public License v3.0 or later](LICENSE) (GPL-3.0-or-later).
