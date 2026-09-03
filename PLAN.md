# agenda.delivery — Status & Plan

_Last updated: 2026-08-07_

---

## 1. Project status

### What's built and working (verified end-to-end)

| Area | Status | Notes |
|------|--------|-------|
| **Web UI** | ✅ | Landing, module detail, map, spider, agents, account, login, search |
| **Backend** | ✅ | Postgres + Drizzle, Auth.js Google OAuth, server actions, subscriptions |
| **Agent system** | ✅ | 7 agents, tool registry, SSE event streaming, live UI |
| **LLM** | ✅ | Ollama cloud (glm-5.3 reasoning, gemma4 summaries) + dev mock |
| **Self-healing scraper** | ✅ | Detects 404, web-searches, finds correct agenda page autonomously |
| **Real agenda extraction** | ✅ | `agenda.find_latest` finds latest meeting, downloads PDF, extracts text |
| **Summary termination** | ✅ | Summary/Keyword agents detect end-of-meeting before summarizing |
| **RSS feed** | ✅ | `/module/[slug]/rss.xml` |
| **Search** | ✅ | `/search?q=...` |
| **Spider queue** | ✅ | Pre-seeded with 200+ Canadian + US municipalities |
| **Scheduler** | ✅ | In-process cron: checking every 6h, spider hourly, auto-repair |
| **Infra** | ✅ | Docker, nginx, CI/CD, DEPLOYMENT.md |

### Enterprise architecture assessment

The concept doc calls for: AWS, Kubernetes, Docker, nginx, CI/CD, Datadog,
OpenTelemetry, Prometheus/Grafana, PySpark, dbt, ClickHouse, Flink, Go/Scala.

| Technology | Status | What we have | What's missing |
|-----------|--------|-------------|----------------|
| **Docker** | ✅ Done | Multi-stage Dockerfile, docker-compose.prod (app+db+nginx) | — |
| **nginx** | ✅ Done | Reverse proxy, rate-limiting, gzip, SSE-aware, security headers | — |
| **CI/CD** | ✅ Done | GitHub Actions: lint+typecheck+build on PR, auto-deploy on main | — |
| **AWS** | ❌ Not started | — | EC2/ECS deployment, S3 for agenda storage, RDS for Postgres |
| **Kubernetes** | ❌ Not started | — | K8s manifests, Helm chart, horizontal pod autoscaling |
| **Observability** | ❌ Not started | — | OpenTelemetry tracing, Prometheus metrics, Grafana dashboards |
| **Data engineering** | ❌ Not started | — | ClickHouse for agenda analytics, dbt for transforms |
| **Go/Scala backend** | ❌ Not started | — | Worker service in Go for high-throughput scraping |

**Assessment:** The containerization + CI/CD layer is solid. The next
enterprise step is observability (OpenTelemetry + Prometheus/Grafana) because
it's the most visible "enterprise" signal and directly useful for monitoring
the autonomous agents. AWS/K8s migration can follow once the app is proven on
the VPS.

---

## 2. Current autonomous pipeline

The system now runs itself:

```
┌─────────────────────────────────────────────────────────┐
│  Scheduler (in-process, started on server boot)         │
│                                                         │
│  ┌──────────────┐  every 6h   ┌──────────────────────┐ │
│  │ Checking     │────────────▶│ For each module:     │ │
│  │ Agent        │             │  1. Verify config    │ │
│  └──────────────┘             │  2. Find latest mtg  │ │
│       │                       │  3. Download PDF     │ │
│       │ broken?               │  4. → Summary Agent  │ │
│       ▼                       │  5. → Keyword Agent  │ │
│  ┌──────────────┐             │  6. → Categorize    │ │
│  │ Scraper      │◀────────────│                      │ │
│  │ Repair Agent  │  auto-dispatch when broken        │ │
│  └──────────────┘                                    │ │
│                                                       │
│  ┌──────────────┐  every 1h    ┌──────────────────────┐ │
│  │ Spider Agent │────────────▶│ Next queued candidate:│ │
│  └──────────────┘             │  1. Crawl website    │ │
│                               │  2. Find agenda page │ │
│  Queue: 200+ municipalities    │  3. Geolocate        │ │
│  (Canada + US)                │  4. Create module    │ │
│                               └──────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

All runs stream events to the live `/agents` page and the per-module activity
sidebar.

---

## 3. Remaining work

| Priority | Item | Effort | Notes |
|----------|------|--------|-------|
| **1** | ✅ Scheduler + autonomy | Done | In-process cron, visible in UI |
| **1** | ✅ Spider queue | Done | 200+ municipalities pre-seeded |
| **2** | Admin panel (Phase 8) | Medium | `/admin` route, manage modules/runs/configs |
| **3** | Map geodata | Small | Wire `geo.locate` to real lat/lng + Leaflet |
| **3** | OpenTelemetry + Prometheus | Medium | First enterprise observability step |
| **4** | Notifications (Phase 6) | Medium | Email (Resend) + SMS (Twilio) |
| **4** | AWS deployment | Medium | EC2/ECS + S3 + RDS |
| **5** | Kubernetes | Large | Helm chart, autoscaling |
| **5** | Data engineering | Large | ClickHouse, dbt, PySpark |

---

## 4. Recommended next steps

1. **Admin panel** — `/admin` route to manage modules, view run history, approve
   spider candidates, edit scrape configs, and monitor the scheduler. Reuses
   the live SSE components.

2. **Map geodata** — add `lat`/`lng` to the module schema, populate from the
   Spider Agent's `geo.locate` results, render real pins with Leaflet + OSM.

3. **OpenTelemetry + Prometheus/Grafana** — instrument the agent runs, API
   routes, and database queries. This is the highest-impact enterprise
   architecture piece because it makes the autonomous system observable.

4. **Notifications** — email + SMS delivery for subscribed users.

5. **AWS + K8s** — migrate from VPS Docker to managed AWS (ECS or EKS).

---

## 5. How we work

- **Test scripts** (`npm run test:*`) drive agents against the real DB
- **`npm run test:e2e`** runs the full autonomous pipeline on a module
- **`npm run db:seed-spider`** populates the spider queue with 200+ municipalities
- Agents are fully transparent — every step streams to the live UI
- We build front-to-back, keeping the demo/portfolio angle in mind