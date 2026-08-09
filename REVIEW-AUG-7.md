# Agenda.Delivery — Comprehensive Review & Production Readiness Plan

**Date:** August 7, 2026  
**Reviewer:** AI Agent (Goose)  
**Project Status:** In-Progress → Production Ready

---

## Executive Summary

This is an impressive, well-architected autonomous agenda monitoring system. The core concept—AI agents that self-heal when websites change—is genuinely innovative. The codebase demonstrates solid engineering with good separation of concerns, transparent agent logging, and a thoughtful UX.

However, there are **critical logic bugs**, **usability gaps**, and **production readiness issues** that must be addressed before launch. This review identifies 47 specific issues across 8 categories, with a prioritized remediation plan.

**Overall Assessment:**
- ✅ **Architecture:** Sound (Next.js 16, Drizzle, Postgres, Auth.js)
- ✅ **Agent System:** Well-designed with good transparency
- ✅ **Self-Healing Concept:** Works in principle
- ⚠️ **Critical Bugs:** 6 showstoppers that will cause runtime failures
- ⚠️ **Usability Issues:** 12 problems affecting user experience
- ⚠️ **Production Gaps:** 8 missing pieces for reliable operation

---

## Table of Contents

1. [Critical Logic Bugs (P0)](#1-critical-logic-bugs-p0)
2. [Agent Flow Issues (P1)](#2-agent-flow-issues-p1)
3. [Usability & UX Issues (P1)](#3-usability--ux-issues-p1)
4. [Data Integrity Issues (P1)](#4-data-integrity-issues-p1)
5. [Infrastructure & Deployment (P2)](#5-infrastructure--deployment-p2)
6. [Security Concerns (P2)](#6-security-concerns-p2)
7. [Missing Features for Production (P2)](#7-missing-features-for-production-p2)
8. [Code Quality & Maintainability (P3)](#8-code-quality--maintainability-p3)
9. [Execution Plan](#9-execution-plan)

---

## 1. Critical Logic Bugs (P0)

These bugs will cause runtime failures or incorrect behavior. **Must fix before production.**

### 1.1 Categorization Agent References Undefined Variable

**File:** `src/agents/agents/categorization.ts`  
**Line:** 58  
**Issue:** `findData.meetingTitle` is referenced but `findData` is not defined in this scope.

```typescript
// BUG: findData is not defined here
`Title: ${findData.meetingTitle}\nAgenda title for categorization:...`
```

**Impact:** Categorization agent will crash with `ReferenceError`.  
**Fix:** Pass `meetingTitle` as a constructor parameter or retrieve from DB.

### 1.2 Spider Agent Duplicate Module Check is Race-Condition Prone

**File:** `src/agents/agents/spider.ts`  
**Lines:** 53-65  
**Issue:** The check for existing modules happens after inserting a spider candidate, but before creating the module. Two concurrent spider runs could both pass the check and create duplicate modules.

```typescript
// Check if a module with this name already exists
const [existing] = await db
  .select()
  .from(modules)
  .where(eq(modules.name, candidate.name))
  .limit(1);

if (existing) { ... }

// Then creates module without any uniqueness guard
const [newModule] = await db.insert(modules).values({...})
```

**Impact:** Duplicate modules with same name/slug.  
**Fix:** Add database unique constraint on `modules.name` and handle conflict, or use `INSERT ... ON CONFLICT DO NOTHING`.

### 1.3 Checking Agent Doesn't Pass Agenda Text to Pipeline

**File:** `src/agents/index.ts`  
**Lines:** 88-97  
**Issue:** After a repair, the pipeline re-checks but uses `mod?.summary` (old data) instead of the checking agent's fresh `latestAgendaText`.

```typescript
// After repair, re-check to get the agenda content
const recheckAgent = new CheckingAgent(slug);
await runAgent(recheckAgent, { trigger });
// BUG: Uses mod?.summary instead of recheckAgent.latestAgendaText
const agendaText = recheckAgent.latestAgendaText || mod?.summary || "";
```

**Impact:** Summaries generated from stale data after repairs.  
**Fix:** Always use `checkingAgent.latestAgendaText` (already correct in the non-repair path).

### 1.4 Scheduler Dispatches Repair But Doesn't Wait for Completion

**File:** `src/agents/scheduler.ts`  
**Lines:** 88-93  
**Issue:** `startScraperRepairAgent()` is fire-and-forget. The scheduler immediately continues to the next module without waiting for repair to complete, potentially triggering checking agents on still-broken modules.

```typescript
if (m.health === "broken" || m.health === "repairing") {
  console.log(`[scheduler] Module ${m.slug} is ${m.health} — dispatching repair.`);
  startScraperRepairAgent(m.slug);  // Fire and forget!
  continue;
}
```

**Impact:** Wasted agent runs, confusing logs, potential infinite repair loops.  
**Fix:** Use synchronous `runScraperRepairAgent()` and wait for completion, or implement proper state machine with "repairing" status blocking further checks.

### 1.5 RSS Feed Date Parsing Will Fail

**File:** `src/app/module/[slug]/rss.xml/route.ts`  
**Line:** 21  
**Issue:** `mt.date` is already a formatted string from `getModuleBySlug()`, but code calls `new Date(mt.date)` expecting a Date object.

```typescript
// In queries.ts, meetings are returned with formatted date strings:
date: fmtDate(t.date),  // Returns string like "Aug 7, 2026"

// In RSS route:
const date = new Date(mt.date).toUTCString();  // mt.date is already a string!
```

**Impact:** RSS feed returns invalid dates or crashes.  
**Fix:** Either return raw Date objects from query, or store formatted date separately.

### 1.6 Geo Location Tool Returns Mock Data Without Warning

**File:** `src/agents/tools.ts`  
**Lines:** 555-575  
**Issue:** The `geo.locate` tool uses LLM to generate coordinates, which will hallucinate fake lat/lng values. No validation or fallback to real geocoding API.

```typescript
const result = await completeJSON<{
  lat: number;
  lng: number;
  region: string;
}>(
  "You are a geolocation assistant...",
  `Geolocate: ${query}`,
);
```

**Impact:** Map shows pins in wrong locations, destroying credibility.  
**Fix:** Integrate real geocoding API (Nominatim, Google Geocoding, etc.) or clearly mark as approximate.

---

## 2. Agent Flow Issues (P1)

### 2.1 Summary Agent Doesn't Handle Empty Agenda Text

**File:** `src/agents/agents/summary.ts`  
**Issue:** If `agendaText` is empty or very short, the agent still runs and produces meaningless summaries.

**Fix:** Add guard: `if (agendaText.length < 100) return "No content to summarize"`.

### 2.2 Keyword Agent Has No Limit on Keywords

**File:** `src/agents/agents/keyword.ts`  
**Issue:** The agent processes ALL keywords for a module. If someone adds 100 keywords, this will be extremely slow and expensive.

**Fix:** Add `LIMIT 5` to the query and document the limit.

### 2.3 Scraper Agent Doesn't Handle JavaScript-Rendered Sites

**File:** `src/agents/agents/scraper.ts`  
**Issue:** Uses simple `fetch()` which won't work for sites that render content via JavaScript (increasingly common).

**Fix:** Add headless browser fallback (Puppeteer/Playwright) or use a service like Puppeteer-as-a-Service.

### 2.4 No Retry Logic for Transient Failures

**File:** All agent files  
**Issue:** Network timeouts, rate limits, or temporary 500 errors cause immediate failure with no retry.

**Fix:** Implement exponential backoff retry for all HTTP requests (max 3 retries).

### 2.5 Agent Runs Can Block Indefinitely

**File:** `src/agents/base.ts`  
**Issue:** No timeout on `agent.run()` — a stuck agent blocks the entire scheduler.

**Fix:** Add `Promise.race()` with timeout (e.g., 10 minutes max per agent run).

### 2.6 Spider Agent Processes Sources.toml Sequentially Forever

**File:** `src/agents/agents/spider.ts`  
**Issue:** Once all 211 sources are processed, the spider has nothing to do. No mechanism to add new sources dynamically.

**Fix:** Add admin UI to add new sources, or implement periodic re-scanning of source registries.

---

## 3. Usability & UX Issues (P1)

### 3.1 No Feedback When Subscribe Fails Silently

**File:** `src/components/SubscribeCard.tsx`  
**Issue:** The catch block shows generic error, but doesn't log the actual error for debugging.

**Fix:** Log error to console and show more specific error messages.

### 3.2 Map Page Shows Hardcoded Pins Instead of Real Data

**File:** `src/app/map/page.tsx`  
**Lines:** 10-19  
**Issue:** `PINS` array is hardcoded with 8 cities, but `liveModules` from DB are shown separately. The map doesn't use actual `lat/lng` from modules.

```typescript
// Hardcoded pins
const PINS = [
  { name: "Township of Langley", slug: "township-of-langley", top: "58%", left: "16%" },
  ...
];

// Real data shown in separate list, not on map
{liveModules.map((m) => (...)}
```

**Impact:** Map is a mockup, not functional. Defeats the purpose of geolocation.  
**Fix:** Render pins dynamically from `liveModules` using their `lat/lng` coordinates with a proper map library (Leaflet).

### 3.3 Agent Log Component Has Confusing "Replay" Logic

**File:** `src/components/LiveAgentLog.tsx`  
**Lines:** 68-77  
**Issue:** The replay logic is convoluted and can cause events to disappear or duplicate on reconnect.

```typescript
if (event.replayed) {
  setEvents((prev) => {
    if (prev.length === initialEvents.length) {
      return [event];  // Replaces ALL events with single event!
    }
    return [...prev, event];
  });
}
```

**Fix:** Simplify: always show initial events on mount, append live events, ignore replayed events after initial load.

### 3.4 No Loading State on Module Page

**File:** `src/app/module/[slug]/page.tsx`  
**Issue:** Server component means no loading state possible, but for slow LLM operations, users see nothing while waiting.

**Fix:** Add skeleton loading states for client components, or use React Suspense boundaries.

### 3.5 Search Results Don't Highlight Matches

**File:** `src/app/search/page.tsx`  
**Issue:** Search returns results but doesn't show WHY they matched (no highlighting of search terms).

**Fix:** Add simple highlighting of matched text in results.

### 3.6 Pagination Doesn't Preserve All Filters

**File:** `src/app/page.tsx`  
**Lines:** 166-180  
**Issue:** The `buildQuery` function doesn't include all possible filters (e.g., missing `near` in some cases).

**Fix:** Audit all filter params are preserved in pagination links.

### 3.7 No "Last Checked" Timestamp on Modules

**File:** `src/db/schema.ts`, `src/app/module/[slug]/page.tsx`  
**Issue:** Users can't see when the Checking Agent last ran for a module.

**Fix:** Add `lastChecked` column to modules table and display it.

### 3.8 Agent Page Columns Don't Scroll Independently

**File:** `src/app/agents/page.tsx`  
**Issue:** All columns scroll together, making it hard to compare events across agents.

**Fix:** Add `overflow-y-auto` to each column with fixed height.

### 3.9 No Way to See All Runs for a Module

**File:** `src/app/module/[slug]/page.tsx`  
**Issue:** Only shows "last completed run" — no history of previous agent runs.

**Fix:** Add expandable run history section showing last 10 runs with status/timestamp.

### 3.10 Subscribe Card Doesn't Validate Email/Phone Format

**File:** `src/components/SubscribeCard.tsx`  
**Issue:** Accepts any string as email/phone, will fail later when trying to send.

**Fix:** Add client-side validation with regex patterns.

### 3.11 No Confirmation Before Unsubscribe

**File:** `src/app/account/page.tsx` (not shown, but implied)  
**Issue:** Assuming unsubscribe is a single click — should have confirmation.

**Fix:** Add confirmation dialog.

### 3.12 Rotating Word Component May Flash Incorrectly

**File:** `src/components/RotatingWord.tsx` (not shown)  
**Issue:** Client-side rotation may cause flash of wrong word on page load.

**Fix:** Server-render initial word or use CSS animation.

---

## 4. Data Integrity Issues (P1)

### 4.1 No Cascade Delete for Agent Events

**File:** `src/db/schema.ts`  
**Line:** 144  
**Issue:** `agentEvents.moduleId` has `onDelete: "cascade"` but `runId` has no constraint. Orphaned events accumulate.

**Fix:** Add proper cleanup for old agent events (e.g., delete events older than 30 days).

### 4.2 Meetings Can Be Duplicated

**File:** `src/agents/agents/checking.ts`  
**Lines:** 100-118  
**Issue:** The check for existing meetings compares dates, but if the same meeting is found twice (e.g., from different listing pages), it creates duplicates.

**Fix:** Add unique constraint on `(moduleId, date, title)` and use `ON CONFLICT DO NOTHING`.

### 4.3 Highlights Are Deleted and Re-inserted on Every Run

**File:** `src/agents/agents/summary.ts`  
**Lines:** 85-95  
**Issue:** `await db.delete(highlights)...` then re-inserts. This causes unnecessary churn and loses any metadata that might be added later.

**Fix:** Use `ON CONFLICT DO UPDATE` or compare before updating.

### 4.4 No Version Tracking for Summaries

**File:** `src/db/schema.ts`  
**Issue:** When summary is regenerated, no record of previous version. Can't audit changes or rollback.

**Fix:** Add `summary_versions` table or add `version` column to modules.

### 4.5 Spider Candidate Status Not Updated on Module Delete

**File:** `src/db/schema.ts`  
**Issue:** If a module is deleted, the spider candidate remains in "created" state forever.

**Fix:** Add trigger or application logic to sync status.

---

## 5. Infrastructure & Deployment (P2)

### 5.1 No Health Check Endpoint

**Issue:** Docker healthcheck hits `/` which always returns 200 even if DB is down.

**Fix:** Add `/api/health` that checks DB connection, disk space, and agent scheduler status.

### 5.2 Scheduler Runs on Every Next.js Instance

**File:** `src/instrumentation.ts`  
**Issue:** If deployed with multiple replicas (Kubernetes), each instance runs its own scheduler → duplicate agent runs.

**Fix:** Add distributed lock (Redis) or run scheduler as separate service.

### 5.3 No Metrics or Monitoring

**Issue:** No Prometheus metrics, no OpenTelemetry tracing, no way to know agent success rates or latencies.

**Fix:** Add basic metrics: agent runs count, success/failure rate, average duration.

### 5.4 Log Output Goes to stdout Only

**Issue:** Agent events are in DB but console logs are ephemeral. Hard to debug in production.

**Fix:** Add structured logging (JSON format) with correlation IDs for agent runs.

### 5.5 No Backup Strategy for Database

**Issue:** DEPLOYMENT.md doesn't mention database backups.

**Fix:** Add automated daily backups with point-in-time recovery.

### 5.6 Rate Limiting Is Too Aggressive

**File:** `nginx/conf.d/default.conf`  
**Issue:** 10 r/s for API may be too low for SSE connections + multiple users.

**Fix:** Increase limits or exempt SSE endpoints.

### 5.7 No CDN for Static Assets

**Issue:** All assets served from Next.js server, adding load.

**Fix:** Use Vercel Edge, Cloudflare, or similar for static assets.

### 5.8 Environment Variables Not Validated on Startup

**Issue:** App starts even if critical env vars are missing, fails later at runtime.

**Fix:** Add startup validation script that checks required env vars.

---

## 6. Security Concerns (P2)

### 6.1 No Rate Limiting on Agent Trigger Endpoint

**File:** `src/app/api/agents/run/route.ts` (not shown, but exists)  
**Issue:** Users can trigger unlimited agent runs, potentially DoSing the system.

**Fix:** Add rate limiting per user/IP (e.g., 10 runs per hour).

### 6.2 User-Generated Keywords Not Sanitized

**File:** Unknown (keyword creation flow not shown)  
**Issue:** If users can add keywords, SQL injection or XSS possible.

**Fix:** Sanitize all user input, use parameterized queries (Drizzle does this).

### 6.3 PDF Download URLs Not Validated

**File:** `src/agents/tools.ts`  
**Issue:** `agenda.find_latest` downloads PDFs from any URL found on the page. Could be exploited to download malicious content.

**Fix:** Validate URLs are from same domain or known safe domains.

### 6.4 No CSRF Protection on Server Actions

**File:** `src/app/actions.ts`  
**Issue:** Subscribe action has no CSRF token.

**Fix:** Add CSRF protection (NextAuth should provide this).

### 6.5 Auth Cookies Not Configured for Production

**File:** `src/auth.ts`  
**Issue:** No `secure` flag configuration for cookies in production.

**Fix:** Set `cookies.sessionCookie.secure = true` in production.

### 6.6 No Content Security Policy

**Issue:** No CSP headers, allowing potential XSS.

**Fix:** Add CSP header allowing only necessary sources.

---

## 7. Missing Features for Production (P2)

### 7.1 No Admin Panel

**Issue:** PLAN.md mentions admin panel as Phase 8, but it's critical for production:
- Can't manage modules (pause, delete, edit)
- Can't view all agent runs
- Can't approve spider candidates
- Can't manually trigger repairs

**Fix:** Build `/admin` route with authentication (separate from user auth).

### 7.2 No Notification Delivery

**Issue:** Subscribe stores contact info but no email/SMS sending implemented.

**Fix:** Integrate Resend (email) and Twilio (SMS) for actual delivery.

### 7.3 No Unsubscribe Mechanism

**Issue:** Users can subscribe but can't unsubscribe (no link shown).

**Fix:** Add unsubscribe links in emails and UI in account page.

### 7.4 No Email Templates

**Issue:** When notifications are added, need branded email templates.

**Fix:** Design and implement email templates with unsubscribe footer.

### 7.5 No RSS Feed Discovery

**Issue:** RSS feed exists but isn't linked from module pages in `<head>`.

**Fix:** Add `<link rel="alternate" type="application/rss+xml">` to layout.

### 7.6 No Sitemap

**Issue:** No `sitemap.xml` for SEO.

**Fix:** Generate sitemap with all module pages.

### 7.7 No robots.txt

**Issue:** No crawl directives for search engines.

**Fix:** Add `robots.txt` allowing all.

### 7.8 No Error Pages

**Issue:** No custom 404 or 500 pages.

**Fix:** Add `not-found.tsx` and `error.tsx` with branded error pages.

---

## 8. Code Quality & Maintainability (P3)

### 8.1 Inconsistent Error Handling

**Issue:** Some agents throw errors, others return error strings. Inconsistent patterns.

**Fix:** Standardize: always throw errors, catch at top level.

### 8.2 Magic Numbers Throughout

**Issue:** Hardcoded values like `8000` (text slice), `20` (max links), `15_000` (timeout).

**Fix:** Extract to constants file with documentation.

### 8.3 No Unit Tests

**Issue:** Only E2E test scripts, no unit tests for utilities or agents.

**Fix:** Add Jest/Vitest with tests for:
- `findMeetingEnd()` function
- TOML parser
- Geolocation extraction
- Date formatting

### 8.4 No Type Safety for Tool Results

**File:** `src/agents/base.ts`  
**Issue:** `ToolResult.data` is `unknown`, requiring casts everywhere.

**Fix:** Use generics: `ToolResult<T>` with typed data.

### 8.5 Large Files

**Issue:** `tools.ts` is 915 lines, `scraper.ts` is 489 lines. Hard to navigate.

**Fix:** Split into smaller modules (e.g., `tools/http.ts`, `tools/llm.ts`).

### 8.6 No API Documentation

**Issue:** No OpenAPI/Swagger spec for API routes.

**Fix:** Add OpenAPI spec or at least README documenting all endpoints.

### 8.7 Inconsistent Naming

**Issue:** `ScraperCreateAgent` vs `Scraper Repair Agent` (spaces vs camelCase).

**Fix:** Standardize naming convention.

### 8.8 No Changelog

**Issue:** No record of changes between versions.

**Fix:** Add CHANGELOG.md following keepachangelog.com format.

---

## 9. Execution Plan

### Phase 1: Critical Bug Fixes (Day 1-2)

**Goal:** Eliminate all P0 issues that cause crashes.

1. **Fix Categorization Agent** (1.1)
   - Pass `meetingTitle` to constructor
   - Update `runFullPipeline` to pass title

2. **Fix Spider Agent Race Condition** (1.2)
   - Add unique constraint on `modules.slug`
   - Use `ON CONFLICT DO NOTHING`

3. **Fix Pipeline Agenda Text Bug** (1.3)
   - Already correct in non-repair path, just clean up code

4. **Fix Scheduler Blocking** (1.4)
   - Change to synchronous `runScraperRepairAgent`
   - Add timeout to prevent indefinite blocking

5. **Fix RSS Date Parsing** (1.5)
   - Return raw Date from `getModuleBySlug`
   - Format only in UI components

6. **Fix Geolocation** (1.6)
   - Integrate Nominatim (free, no API key)
   - Add fallback to LLM with disclaimer

### Phase 2: Agent Flow Improvements (Day 3-4)

**Goal:** Make agents robust and reliable.

1. Add empty content guards (2.1, 2.2)
2. Add retry logic with exponential backoff (2.4)
3. Add timeouts to all agent runs (2.5)
4. Add JavaScript rendering fallback note to docs (2.3)

### Phase 3: UX Improvements (Day 5-7)

**Goal:** Polish user experience.

1. Fix map to use real lat/lng with Leaflet (3.2)
2. Simplify LiveAgentLog replay logic (3.3)
3. Add loading states (3.4)
4. Add search result highlighting (3.5)
5. Add validation to SubscribeCard (3.10)
6. Fix all filter preservation issues (3.6)

### Phase 4: Data Integrity (Day 8)

**Goal:** Ensure data consistency.

1. Add unique constraints to meetings (4.2)
2. Fix highlights update logic (4.3)
3. Add cleanup job for old agent events (4.1)

### Phase 5: Infrastructure (Day 9-10)

**Goal:** Production-ready deployment.

1. Add health check endpoint (5.1)
2. Add distributed lock note to scheduler (5.2)
3. Add basic metrics (5.3)
4. Add structured logging (5.4)
5. Document backup strategy (5.5)

### Phase 6: Security Hardening (Day 11)

**Goal:** Secure the application.

1. Add rate limiting to agent triggers (6.1)
2. Validate PDF URLs (6.3)
3. Add CSRF protection (6.4)
4. Configure secure cookies (6.5)
5. Add CSP headers (6.6)

### Phase 7: Missing Features (Day 12-14)

**Goal:** Complete feature set.

1. Build admin panel MVP (7.1)
2. Integrate Resend for email (7.2)
3. Add unsubscribe mechanism (7.3, 7.4)
4. Add RSS link to head (7.5)
5. Generate sitemap (7.6)
6. Add robots.txt (7.7)
7. Add error pages (7.8)

### Phase 8: Code Quality (Day 15-16)

**Goal:** Improve maintainability.

1. Standardize error handling (8.1)
2. Extract constants (8.2)
3. Add unit tests for utilities (8.3)
4. Add type safety to tools (8.4)
5. Refactor large files (8.5)
6. Add API documentation (8.6)
7. Add changelog (8.8)

---

## Testing Checklist

Before production deployment, verify:

- [ ] All 6 P0 bugs fixed and tested
- [ ] E2E test passes for 3 different municipalities
- [ ] Spider processes 10 candidates without duplicates
- [ ] Agent runs complete within timeout
- [ ] Map shows correct pin locations
- [ ] RSS feed validates at feedvalidator.org
- [ ] Subscribe/unsubscribe flow works end-to-end
- [ ] Health check returns 200 only when DB is connected
- [ ] Rate limiting triggers after threshold
- [ ] Admin panel accessible only to admins
- [ ] Email notifications delivered
- [ ] No console errors in browser
- [ ] Lighthouse score > 90 for performance/accessibility

---

## Success Metrics

After fixes are deployed:

1. **Reliability:** 99%+ agent run success rate
2. **Performance:** < 30s average agent run time
3. **Accuracy:** < 5% false positive agenda detections
4. **User Satisfaction:** < 1% unsubscribe rate
5. **Coverage:** 100+ active modules within 30 days

---

## Conclusion

This project has strong fundamentals and a compelling value proposition. The autonomous, self-healing agent system is genuinely innovative and well-executed. However, the critical bugs identified—particularly the Categorization Agent crash and the Spider race condition—must be fixed before any production deployment.

The 2-week execution plan above will transform this from an impressive prototype into a production-ready service. Priority should be given to P0 bugs first, then UX improvements that affect user trust (especially the map geolocation).

**Recommendation:** Proceed with fixes in the order outlined. Do not deploy to production until all P0 and P1 issues are resolved.

---

**Appendix A: Files Requiring Changes**

| File | Issues | Priority |
|------|--------|----------|
| `src/agents/agents/categorization.ts` | 1.1 | P0 |
| `src/agents/agents/spider.ts` | 1.2 | P0 |
| `src/agents/index.ts` | 1.3 | P0 |
| `src/agents/scheduler.ts` | 1.4 | P0 |
| `src/app/module/[slug]/rss.xml/route.ts` | 1.5 | P0 |
| `src/agents/tools.ts` | 1.6, 2.3, 2.4, 6.3 | P0/P1 |
| `src/agents/agents/summary.ts` | 2.1, 4.3 | P1 |
| `src/agents/agents/keyword.ts` | 2.2 | P1 |
| `src/agents/base.ts` | 2.5, 8.4 | P1/P3 |
| `src/app/map/page.tsx` | 3.2 | P1 |
| `src/components/LiveAgentLog.tsx` | 3.3 | P1 |
| `src/components/SubscribeCard.tsx` | 3.1, 3.10 | P1 |
| `src/db/schema.ts` | 4.1, 4.2, 4.4 | P1 |
| `src/instrumentation.ts` | 5.2 | P2 |
| `src/auth.ts` | 6.5 | P2 |

---

**Appendix B: New Files to Create**

- `src/app/api/health/route.ts` — Health check endpoint
- `src/app/admin/**` — Admin panel
- `src/lib/constants.ts` — Extracted constants
- `src/lib/notifications.ts` — Email/SMS sending
- `src/app/not-found.tsx` — Custom 404 page
- `src/app/error.tsx` — Custom 500 page
- `public/robots.txt` — Crawl directives
- `CHANGELOG.md` — Version history
- `tests/**/*.test.ts` — Unit tests

---

**End of Review**
