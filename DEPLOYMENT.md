# Deployment

The project ships with a production Docker setup (app + Postgres + nginx)
and CI/CD via GitHub Actions.

## Quick start (local production test)

```bash
# 1. Create .env from the production template
cp .env.example .env
# Fill in AUTH_SECRET (npx auth secret), Google OAuth, Ollama cloud keys

# 2. Build and start
docker compose -f docker-compose.prod.yml up -d --build

# 3. Run migrations + seed
docker compose -f docker-compose.prod.yml run --rm app npx drizzle-kit migrate
docker compose -f docker-compose.prod.yml run --rm app npm run db:seed
```

The app is available at `http://localhost` (nginx on port 80).

## Architecture

```
                    ┌─────────┐
     :80            │  nginx  │  rate-limiting, gzip, SSE proxy,
  ─────────────────▶│         │  security headers, static caching
                    └────┬────┘
                         │ :3000
                    ┌────▼────┐
                    │  Next.js│  standalone server.js
                    │  app    │  (node, non-root)
                    └────┬────┘
                         │ :5432
                    ┌────▼────┐
                    │Postgres │  pgdata volume
                    │  16     │
                    └─────────┘
```

### nginx

- Reverse proxy with security headers (`X-Frame-Options`, `X-Content-Type-Options`, etc.)
- Gzip compression for text-based assets
- Rate limiting: 10 r/s for API, 30 r/s for general traffic
- SSE-aware: `proxy_buffering off` + `X-Accel-Buffering: no` for `/api/agents/events`
- Long-cache headers for `_next/static/` and static assets

### Docker

- **Multi-stage build**: deps → builder → runner (Alpine, ~150MB final image)
- **Non-root user** (`nextjs:nodejs`) for security
- **Healthcheck** on `/` every 30s
- **Standalone output**: Next.js traces only needed `node_modules`, no full install in production
- **Drizzle migration files** included in the image for `db:migrate` in deploy

### Docker Compose (production)

`docker-compose.prod.yml` defines three services:

| Service | Purpose | Port |
|---------|---------|------|
| `app` | Next.js standalone server | 3000 (internal) |
| `db` | PostgreSQL 16 | 5432 (internal) |
| `nginx` | Reverse proxy + TLS termination | 80 (or `${NGINX_PORT}`) |

## CI/CD (GitHub Actions)

### CI (`.github/workflows/ci.yml`)
Runs on every push/PR to `main`:
1. `npm ci` → `npm run lint` → `tsc --noEmit` → `npm run build`
2. Starts a Postgres service container
3. Runs migrations + seed against it

### Deploy (`.github/workflows/deploy.yml`)
Runs on push to `main`:
1. Builds the Docker image
2. SCPs the image + compose/nginx files to the VPS
3. Loads the image, runs migrations, deploys via `docker compose up -d`
4. Health-checks the deployment

**Required GitHub secrets:**

| Secret | Description |
|--------|-------------|
| `SSH_HOST` | VPS IP or hostname |
| `SSH_USER` | SSH user (e.g. `deploy`) |
| `SSH_PRIVATE_KEY` | Private key for SSH access |
| `POSTGRES_PASSWORD` | Production DB password |
| `AUTH_SECRET` | Auth.js secret (`npx auth secret`) |
| `AUTH_GOOGLE_ID` | Google OAuth client ID |
| `AUTH_GOOGLE_SECRET` | Google OAuth client secret |
| `OLLAMA_BASE_URL` | Ollama cloud endpoint (optional) |
| `OLLAMA_API_KEY` | Ollama cloud API key (optional) |

## VPS setup (one-time)

```bash
# On the VPS:
mkdir -p /opt/agenda-delivery
# Install Docker + Docker Compose if not already present
# Set up the SSH key for the deploy user
# Configure firewall: allow 80 (and 443 when TLS is added)
```

## TLS / HTTPS

For production with HTTPS, add certificates to nginx. The simplest approach:

```bash
# On the VPS, install certbot
certbot --nginx -d agenda.delivery
```

Or mount Let's Encrypt certs into the nginx container and update `default.conf`
to listen on 443 with `ssl_certificate`.

## Environment variables

See [`.env.example`](.env.example) for all required and optional variables.

Key production variables:

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `DATABASE_URL` | yes | — | Postgres connection string |
| `AUTH_SECRET` | yes | — | `npx auth secret` to generate |
| `AUTH_GOOGLE_ID` | no | — | Without it, sign-in is disabled |
| `AUTH_GOOGLE_SECRET` | no | — | |
| `OLLAMA_BASE_URL` | no | — | Ollama cloud endpoint; empty = mock LLM |
| `OLLAMA_API_KEY` | no | — | |
| `AGENT_MODEL` | no | `glm-4.6` | Model for agent reasoning |
| `SUMMARY_MODEL` | no | `gemma3` | Lighter model for summaries |
| `NEXTAUTH_URL` | no | `http://localhost` | Canonical URL for callbacks |
| `NGINX_PORT` | no | `80` | External nginx port |