# agenda.delivery

Never miss an update from your local **council, committee, organization, non-profit, charity, or business.**

An open-source, AI-enabled service that monitors public agendas around the world, summarizes them, and delivers the parts you care about by email, text, or RSS. Agenda "Modules" are self-healing AI scrapers: they discover new councils, build their own scraping logic, detect when a site breaks, and repair themselves, with every step visible in the UI.

This is also a **demo / portfolio project**, so the agents work in the open, the logs are meant to look good, and the whole thing is designed to show off a modern, scalable, observable cloud architecture.

## Stack

- **Web:** Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4
- **Backend:** Next.js Route Handlers + Server Actions (BFF)
- **Data:** Postgres · Drizzle ORM
- **Auth:** Auth.js (NextAuth v5) with Google OAuth
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
npm run db:push && npm run db:seed
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

DB scripts: `db:push` (apply schema), `db:seed` (load samples), `db:generate` +
`db:migrate` (versioned migrations), `db:studio` (Drizzle Studio).

## Roadmap

Building front-to-back: UI and site first, backend after.

- **Phase 0 — Foundation** ✅ repo, Next+TS+Tailwind, brand palette + Gelica font.
- **Phase 1 — Landing page** ✅ logo, rotating tagline, search, view-map link, "newest agendas monitored" list.
- **Phase 2 — Rest of the site (UI, mock data):** module/agenda detail (AI summary, highlights, per-keyword summaries, RSS, subscribe, **live agent-activity log bubbles**), map page, live spider page, account dashboard, Google-login UI.
- **Phase 3 — Backend foundation** 🚧 Postgres + Drizzle schema, seed, Auth.js
  Google OAuth, accounts, subscriptions. Pages now read live data from the DB.
  (Verifying end-to-end needs Docker running locally.)
- **Phase 4 — Agent system:** Spider · Scraper Create/Repair · Checking · Summary · Keyword agents; run-logging that feeds the UI; self-healing scraping.
- **Phase 5 — Data & storage:** S3 historical store, high compression, PDF image stripping; data-engineering pipeline.
- **Phase 6 — Notifications:** email + Twilio SMS + RSS.
- **Phase 7 — Infra & observability:** Docker/compose/nginx, Kubernetes, AWS, Datadog/OpenTelemetry/Prometheus/Grafana, CI/CD.

## License

Open source (license TBD).
