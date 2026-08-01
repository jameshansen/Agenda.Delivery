# agenda.delivery

Never miss an update from your local **council, committee, organization, non-profit, charity, or business.**

An open-source, AI-enabled service that monitors public agendas around the world, summarizes them, and delivers the parts you care about by email, text, or RSS. Agenda "Modules" are self-healing AI scrapers: they discover new councils, build their own scraping logic, detect when a site breaks, and repair themselves, with every step visible in the UI.

This is also a **demo / portfolio project**, so the agents work in the open, the logs are meant to look good, and the whole thing is designed to show off a modern, scalable, observable cloud architecture.

## Stack

- **Web:** Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4
- **Brand font:** Gelica (local, `src/app/fonts`)
- Backend, data, and infra are later phases (see roadmap).

## Run

```bash
npm run dev
```

Open http://localhost:3000.

## Roadmap

Building front-to-back: UI and site first, backend after.

- **Phase 0 — Foundation** ✅ repo, Next+TS+Tailwind, brand palette + Gelica font.
- **Phase 1 — Landing page** ✅ logo, rotating tagline, search, view-map link, "newest agendas monitored" list.
- **Phase 2 — Rest of the site (UI, mock data):** module/agenda detail (AI summary, highlights, per-keyword summaries, RSS, subscribe, **live agent-activity log bubbles**), map page, live spider page, account dashboard, Google-login UI.
- **Phase 3 — Backend foundation:** API, DB schema, real auth/OAuth, accounts.
- **Phase 4 — Agent system:** Spider · Scraper Create/Repair · Checking · Summary · Keyword agents; run-logging that feeds the UI; self-healing scraping.
- **Phase 5 — Data & storage:** S3 historical store, high compression, PDF image stripping; data-engineering pipeline.
- **Phase 6 — Notifications:** email + Twilio SMS + RSS.
- **Phase 7 — Infra & observability:** Docker/compose/nginx, Kubernetes, AWS, Datadog/OpenTelemetry/Prometheus/Grafana, CI/CD.

## License

Open source (license TBD).
