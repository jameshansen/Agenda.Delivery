# The Scraper: how agenda.delivery actually finds an agenda

This is the core of the whole project. Everything else — the UI, the
summaries, the subscriptions — is downstream of one question: *can we
reliably find the specific, correctly-dated meeting agenda on a council
website we've never seen before, without a human writing a scraper for it?*

This document explains the approach in plain terms: what it does, why it's
built this way, and what "working" actually means here.

## The principle: no per-site shortcuts

There are 200+ councils in `sources.toml`, and they run on a few dozen
different website platforms (custom CMSes, eSCRIBE, Legistar, CivicWeb,
iCompass, plain static HTML, and more). We are **not** hand-writing a scraper
per platform. That doesn't scale, and it isn't a demonstration of anything —
any script can follow a fixed set of CSS selectors for one known site.

The point of this project is a system that can **figure out a site it has
never seen**, the same way a person would: look at the page, find the thing
that looks like "meetings," click through to the specific most-recent one,
and read the agenda. So the scraper is not a parser with a library of
site-specific rules. It's a small decision loop, with an LLM doing the
"where do I click next" reasoning, backed by tools that let it actually look
at and act on a real page.

## Two tiers, cheapest first

Most council websites are plain server-rendered HTML: a page listing past
meetings, each linking to a PDF. For these, a full browser is unnecessary
overhead. So there are two tiers, tried in order:

1. **Static/rendered path** (`_static_find_latest` in
   `agents/base/agenda_shared/tools.py`) — fetch the page with a plain HTTP
   request. If it looks like an empty JS shell, fetch it again through a
   headless-Chromium **renderer** container instead (no interaction, just
   "run the page's JS and give me the resulting HTML"). Extract every link's
   URL *and visible text*, filter down to plausible meeting/agenda
   candidates, and ask the LLM to pick the single most recent **past**
   meeting from that list. Follow it, find the PDF, extract the text.

2. **Browser nav loop** (`browser_find_latest`, same file) — for sites where
   tier 1 fails outright, or produces something that doesn't look like a
   real, specific meeting (see "correctness" below). This drives a real,
   undetected Chrome instance (`browser/` container, Selenium +
   `undetected-chromedriver`) through a small, session-based toolset that
   mirrors how a human — or an agentic coding tool driving a browser — would
   interact with a page:

   - `goto(url)`
   - `state()` — what's on the page right now: visible text, and every
     visible clickable element tagged with a short reference (`e3`,
     `0.1.e2` for something inside a nested frame)
   - `click(ref)`, `type(ref, text)`
   - `links()` — every link on the page (and PDF links specifically)

   Each step, the LLM sees the current page state and picks one action:
   click something, navigate somewhere, or declare it's found the agenda
   (or that it's stuck). This is capped at 8 steps. It costs real LLM calls,
   so it's the fallback tier, not the default — but it's what makes the
   system actually *universal*: it can get through a JS-only calendar widget,
   a frameset-based portal, or a multi-step "select year → select meeting →
   open agenda" flow, because it's reasoning about the page rather than
   matching a pattern against it.

## Learn once, replay cheap

Once the browser tier succeeds, it doesn't throw that work away. It
persists a **recipe** into `scrape_config`:

- `agenda_url` — updated to the *entry point* it navigated from (not the
  final PDF it landed on — a PDF is a dead end with no further links, so
  storing that instead would strand the next attempt with nowhere to
  navigate to)
- `platform` — a best-effort guess at the site's software (eSCRIBE,
  Legistar, etc.), mostly for the admin panel's transparency
- `nav_recipe` — the actual click trail it took, as readable JSON
  (`[{"action": "click", "ref": "e22", "reason": "..."}]`) — this is real
  diagnostic value: you can see *why* the agent clicked what it clicked

Next time this module is checked, `agenda_find_latest` sees `platform` is
already set and skips straight to the browser tier — no point re-trying the
cheap path on a site already known to need it. If the recipe stops working
(site redesign), the whole thing self-heals the same way it originally
succeeded: escalate, re-navigate, re-learn.

## Correctness is the whole point — never guess and call it success

The riskiest failure mode for this system is not "couldn't find the
agenda" — it's "confidently found the *wrong* thing and told a user it's the
latest agenda." A wrong summary emailed to a subscriber is worse than no
summary. Several real bugs surfaced during testing that all had this same
shape, and are worth naming so the lesson doesn't get relearned:

- **A category page is not a meeting.** A "2025 Agendas & Minutes" archive
  page has dozens of PDF links on it — one per past meeting. Early on, "has
  at least one PDF link" was used as a signal that a result was trustworthy.
  It isn't: archive pages trivially satisfy that. The real signal is a
  **specific extracted date** — only an actual individual meeting has one.
  (`_looks_like_a_real_meeting`)
- **A coarse pre-check should never block the real check.** `verify_selfcheck`
  is a cheap heuristic (does the page contain the words "agenda"/"meeting",
  is the HTTP status OK, etc.) — useful as a quick diagnostic, useless as a
  gate. It was originally wired as a hard gate in front of the real
  find-the-agenda logic: if the coarse check failed, the system gave up
  *without ever trying the tool that could actually succeed* — including the
  browser tier, on exactly the JS-heavy sites that most needed it. It's now
  informational only. The real, authoritative signal is always
  "`agenda_find_latest` found a specific dated meeting or it didn't."
- **"OR" is how weak signals sneak back in.** After fixing the gate above,
  the health decision briefly became `verify_ok OR fetch_ok` — which let the
  same coarse heuristic single-handedly mark a module "healthy" with zero
  meeting actually found. Caught live (a module showed "healthy" with a
  completely empty meeting record) and fixed: health is decided by whether a
  real meeting was found, full stop, never by the cheap heuristic alone.

The pattern across all three: whenever a fast, approximate check and a slow,
authoritative check disagree, **the authoritative check wins, and the fast
one is downgraded to a log line.** A shortcut that's allowed to override the
real result isn't a shortcut, it's a bug waiting to ship wrong data.

## What "working" means for a given council

A council counts as genuinely working when:

1. `agenda_find_latest` returns a specific meeting with a real date (not
   "date unknown", not a generic title), and
2. that date is plausible (on or before today — the system is explicitly
   told never to pick a future/scheduled meeting), and
3. there's enough extracted text (from a PDF or the page itself) to actually
   summarize — an empty or near-empty result is left alone rather than
   summarized into something that sounds plausible but says nothing real.

If none of that holds, the module is marked `repairing` (config exists, but
the last attempt didn't find anything trustworthy) or `broken` (couldn't
even reach/parse the site), and it stays that way — visibly, honestly —
until a future check or a code fix resolves it. It never gets marked
`healthy` on a guess.

## Where the logic lives

| File | Role |
|---|---|
| `agents/base/agenda_shared/tools.py` | `_static_find_latest`, `browser_find_latest`, `agenda_find_latest` (the wrapper that ties tiers together), `_looks_like_a_real_meeting`, `site_crawl`, `web_search`, `verify_selfcheck`, `db_save_config` |
| `browser/app.py` | The undetected-Chrome microservice: session lifecycle, frame-aware `state`/`click`/`type`/`links` |
| `renderer/app.py` | The lightweight headless-Chromium renderer (JS execution only, no interaction) used by the static tier |
| `agents/checking/agent_impl.py` | Recurring check: calls `agenda_find_latest`, records a new meeting if found, sets health from that result alone |
| `agents/scraper/agent_impl.py` | Initial setup / repair: crawls, asks the LLM to infer selectors, saves a config, then calls the same `agenda_find_latest` to confirm it actually works before declaring success |
