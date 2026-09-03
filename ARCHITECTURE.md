# Architecture

`docker compose up --build` brings up the whole system. Everything is a
container; the pieces talk over one docker network.

```
                    ┌─────────┐
   browser ───────▶ │  nginx  │  :80  (only public entry)
                    └────┬────┘
             ┌───────────┴───────────┐
             ▼                       ▼
        ┌─────────┐            ┌──────────────┐
        │   ui    │            │ orchestrator │  /trigger /events /status
        │ Next.js │            │ Python+Gunic.│
        │ (reader)│            └──────┬───────┘
        └────┬────┘                   │ HTTP dispatch
             │ reads                   ▼
             │            ┌─────────────────────────────────┐
             │            │ agent containers (Python+Gunic.) │
             │            │ spider scraper checking          │
             │            │ categorization summary keyword   │
             │            │ escalation                       │
             │            └───────────────┬─────────────────┘
             ▼                            ▼ writes results + events
        ┌──────────┐  ◀───────────  ┌──────────┐     ┌────────┐
        │ postgres │                │  redis   │     │        │
        │ (truth)  │                │ (glue)   │     │        │
        └──────────┘                └──────────┘     └────────┘
```

## Who does what

- **nginx** — the only container with a published port. Proxies `/` to the
  UI and `/orchestrator/*` to the orchestrator (incl. the `/orchestrator/events`
  SSE stream). Agents are **not** publicly reachable.
- **ui** (`ui/`, Next.js/TypeScript) — a **reader**. It renders from Postgres
  and never calls agents. For live logs it subscribes to the orchestrator's
  SSE relay. Manual "run now" buttons POST to the orchestrator.
- **orchestrator** (`orchestrator/`, Python) — the brain. Owns the job queue
  (Redis), the schedule, conditional flows, retries, parallel fan-out, and the
  `agent_run` lifecycle. **All agent invocation goes through here.**
- **agents** (`agents/<name>/`, Python+Gunicorn) — one container each. Dumb by
  design: given a job, do the work, emit events, write results, return. They
  never call each other — the orchestrator coordinates.
- **redis** — the glue: the orchestrator's job queue + the pub/sub bus that
  carries agent events to the UI.
- **postgres** — the single source of truth. Schema in `db/schema.sql`, seeded
  by `db/seed.sql` on first boot. No ORM (raw SQL via `psycopg`).

## The agent contract

Orchestrator → agent, HTTP:

```
POST /run   {run_id, agent, module_id?, slug?, trigger, inputs:{...}}
         → {ok, result, data}         (data feeds the next agent)
GET  /health → {ok, agent}
```

The orchestrator creates the `agent_run` row, POSTs the job, retries on
transient failure, and marks the run completed/failed. Agents emit progress via
`agenda_shared.bus.emit_event` (one `agent_event` row + one Redis publish each).

## Shared code (`agents/base/agenda_shared/`)

Baked into every agent image (and the orchestrator) — includes the Ollama Cloud
client + API key handling, the Postgres pool, the Redis event bus, the
`BaseAgent`/Flask factory, and the scrape tools.

| module | purpose |
|--------|---------|
| `settings.py` | env config (DB, Redis, Ollama) |
| `db.py` | Postgres pool + `query/one/execute` |
| `llm.py` | Ollama Cloud chat client (+ dev mock) |
| `bus.py` | `emit_event` → Postgres + Redis pub/sub |
| `agent.py` | `BaseAgent`, `create_agent_app` |
| `tools.py` | crawl / web-search / find-latest / verify / geo (SSRF-guarded) |
| `notify.py` | subscriber alerts, automation rules, mailing-list sends |
| `mailer.py` | outbound email: platform relay, SendGrid, or a user's own SMTP |
| `textutil.py` | agenda end-of-meeting detection |

## Flows (`orchestrator/flows.py`)

- **pipeline** — `checking` → (if broken: `scraper_repair` + re-check) → fan out
  `summary` + `keyword` + `categorization` in parallel.
- **spider** — `spider` discovers/creates a module → orchestrator hands it to
  `scraper_create` → first pipeline run.
- **escalation** — on its own schedule (15m), sweeps failed runs, output that
  reads like a coding error, `site_error` rows written by the UI, and modules
  stuck broken; emails anything new to `ADMIN_EMAIL`.

## Adding an agent

1. `agents/<name>/agent_impl.py` — subclass `BaseAgent`, implement `run(job)`.
2. `agents/<name>/app.py` — `create_agent_app(YourAgent)`.
3. Add a service to `docker-compose.yml` (build arg `AGENT=<name>`).
4. Register its URL + flow use in `orchestrator/core.py` / `flows.py`.
