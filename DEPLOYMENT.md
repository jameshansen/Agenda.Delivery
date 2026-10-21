# Deployment

agenda.delivery runs as one Docker Compose stack, `docker-compose.yml`, on a single VPS. The host's Caddy terminates TLS and proxies to the stack's nginx; the host's Postfix relays outbound mail and DKIM-signs it for agenda.delivery.

## On the server

- A git checkout of `master`.
- `env.production` holds every secret and setting; there is no `.env`. Back it up before editing. The stack reads `POSTGRES_PASSWORD`, `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `NEXTAUTH_URL`, `OLLAMA_BASE_URL`, `OLLAMA_API_KEY`, `AGENT_MODEL`, `SUMMARY_MODEL`, `BASE_URL`, `ADMIN_EMAIL` (escalation mail), `ADMIN_EMAILS` (who may use /admin and queue runs), `TESTCOUNCIL_TOKEN`, and the `SMTP_*` and `MAIL_FROM` settings; `.env.example` lists them with defaults.
- `docker-compose.override.yml`, which exists only on the server, binds nginx to a loopback port instead of port 80.
- Caddy proxies `agenda.delivery` to that nginx port and `testcouncil.agenda.delivery` to the test council's loopback port (8083), and obtains certificates on its own.
- Inside the stack, `mailhost` resolves to the host, where Postfix accepts mail from the Docker network.

## Deploying

```bash
git pull --ff-only
```

```bash
docker compose --env-file env.production -f docker-compose.yml -f docker-compose.override.yml up -d --build
```

- The `schema` service applies `db/schema.sql` to the existing database before the orchestrator and UI start. Postgres runs it by itself only when the database is first created, so the file must stay safe to re-run; CI applies it twice to prove that.
- nginx is not recreated when only its mounted config changes. After a change under `nginx/`, restart it:

```bash
docker compose --env-file env.production -f docker-compose.yml -f docker-compose.override.yml restart nginx
```

- Restarting the orchestrator queues a check of every module about two minutes later. A change to the agents alone can skip it (and the schema step) by rebuilding just them:

```bash
docker compose --env-file env.production -f docker-compose.yml -f docker-compose.override.yml up -d --build --no-deps spider scraper checking categorization summary keyword escalation
```

- The spider reads `sources.toml` through a single-file mount, which keeps the old file after a pull replaces it; restart the spider after changing the registry.
- Check that the queue is empty before a deploy that restarts the orchestrator or agents, since a run in flight is cut off (the orchestrator closes it as failed when it starts again).

## CI

`.github/workflows/ci.yml` runs on every push to `master` and every pull request against it: lint, type-check, build, `db/schema.sql` applied twice plus `db/seed.sql` on a fresh Postgres, and the Python self-checks.

## After a deploy

[TESTING.md](TESTING.md) walks through checking every feature against the test council.
