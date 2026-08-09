# Spider Agent Loop — Monitoring & Improvement

_This file describes the autonomous spider monitoring loop. Start a new conversation, read this file, and run the loop._

## Goal

Monitor the Spider Agent as it processes the 211-municipality queue. When a candidate fails (rejected by the spider), investigate the failure, fix the underlying issue in the agent code or tools, and re-queue the candidate. Stop the loop if a failure is unresolvable.

## Current state

- **Queue**: 211 candidates seeded (`npm run db:seed-spider`), ~4 already processed (Vancouver, Surrey, Burnaby, Richmond — all succeeded)
- **Spider design**: Picks next queued candidate → geolocates → creates module → hands to Scraper Create Agent → waits for success/failure → marks candidate created/rejected
- **Scraper Create Agent**: Crawls the candidate URL → if 404/no links, web-searches for the agenda page → crawls root domain if needed → LLM determines selectors → saves config → verifies
- **Scheduler**: In-process cron, spider runs every 5min (dev) / 1hr (prod)
- **DB**: Docker Postgres (`agenda-db` container), schema has `lat`/`lng` on modules

## How to run the loop

1. **Start the dev environment** (if not already running):
   ```powershell
   .\start-dev.ps1
   ```
   Or manually:
   ```powershell
   docker compose up -d
   npx drizzle-kit migrate
   npm run db:seed
   npx next dev
   ```

2. **In a new conversation**, read this file, then run the spider manually in a loop:
   ```bash
   npx tsx -e "import 'dotenv/config'; import { runSpiderAgent } from './src/agents/index'; (async () => { for (;;) { const r = await runSpiderAgent('loop'); console.log(new Date().toISOString(), r.result); } })().catch(e => { console.error(e); process.exit(1); })"
   ```

3. **After each run**, check the DB for failures:
   ```bash
   docker exec agenda-db psql -U agenda -d agenda -c "SELECT name, url, status FROM spider_candidate WHERE status = 'rejected' ORDER BY created_at DESC LIMIT 10"
   ```

4. **When a candidate is rejected**, investigate:
   - Check the agent events for that candidate:
     ```bash
     docker exec agenda-db psql -U agenda -d agenda -c "SELECT agent, action, tool, detail FROM agent_event WHERE created_at > NOW() - INTERVAL '5 minutes' ORDER BY sort"
     ```
   - Identify the failure reason (no agenda links found, web search found nothing, site blocks bot, etc.)
   - Fix the issue in the agent code or tools (e.g. improve `site.crawl` link patterns, add more `web.search` candidates, change User-Agent)
   - Re-queue the candidate:
     ```bash
     docker exec agenda-db psql -U agenda -d agenda -c "UPDATE spider_candidate SET status = 'queued' WHERE name = '<NAME>'"
     docker exec agenda-db psql -U agenda -d agenda -c "DELETE FROM module WHERE name = '<NAME>'"
     ```
   - Re-run the spider to verify the fix

5. **If a failure is unresolvable** (e.g. the municipality genuinely has no online agenda), stop the loop and note the unresolvable candidates in this file.

## Common failure patterns & fixes

| Failure | Likely cause | Fix |
|---------|-------------|-----|
| "No agenda links found" | Site uses non-standard link patterns | Add patterns to `site.crawl` tool in `src/agents/tools.ts` |
| "Web search found nothing" | LLM doesn't know the correct URL | Improve `web.search` prompt or add the URL manually to the candidate |
| "Site blocks bot" | User-Agent blocked | `USER_AGENT` in `src/agents/tools.ts` is already browser-like, but some sites need more |
| "404 on root domain" | Site structure changed | The Scraper Create Agent should handle this via web search — check it's running |
| "Could not fetch HTML" | Network timeout or DNS | Increase timeout in `fetchHtml()` in `src/agents/agents/scraper.ts` |

## Key files

| File | Purpose |
|------|---------|
| `src/agents/agents/spider.ts` | Spider Agent — picks candidate, geolocates, creates module, hands to Scraper |
| `src/agents/agents/scraper.ts` | Scraper Create Agent — finds agenda page, saves config, verifies |
| `src/agents/tools.ts` | All tools (`site.crawl`, `web.search`, `agenda.find_latest`, etc.) |
| `src/agents/scheduler.ts` | In-process scheduler (spider every 5min dev / 1hr prod) |
| `src/data/canadian-municipalities.ts` | 81 Canadian municipalities seed data |
| `src/data/us-municipalities.ts` | 130 US municipalities seed data |
| `scripts/seed-spider-queue.ts` | Seeds the spider queue from the municipality data |
| `scripts/debug-spider.ts` | Debug script to test candidates without running the full agent |

## Stop conditions

- All 211 candidates are processed (queue is empty)
- A failure is genuinely unresolvable (municipality has no online agenda)
- The user says stop

## After the loop

Once the loop is complete:
1. Update this file with results (how many succeeded, how many rejected, any unresolvable)
2. Update PLAN.md with the outcome
3. The successful modules will have real lat/lng and scrape configs — the map can be wired up next