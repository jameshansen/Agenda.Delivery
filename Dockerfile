# ─────────────────────────────────────────────────────────────
# Multi-stage Dockerfile for agenda.delivery (Next.js 16 standalone)
# ─────────────────────────────────────────────────────────────

# 1. Dependencies — install once, cached
FROM node:22-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

# 2. Builder — compile the Next.js standalone output
FROM node:22-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Next.js telemetry off in CI
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# 3. Runner — minimal production image
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy the standalone server (includes traced node_modules + server.js)
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
# Static assets are NOT included in standalone by default
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs

EXPOSE 3000

# Use 127.0.0.1, not localhost -- alpine resolves localhost to ::1 (IPv6)
# first, and Node's HOSTNAME=0.0.0.0 only binds the IPv4 wildcard, so
# `wget http://localhost:.../` gets "connection refused" even though the
# server is up and reachable from other containers on the docker network.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --quiet --spider http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]