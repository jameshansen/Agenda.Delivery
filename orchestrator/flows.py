"""Flow definitions — the conditional, fan-out logic the brief wants in the
orchestrator (not in the agents).

- pipeline: check -> (repair + recheck if broken) -> fan out summary +
  keyword + categorization in parallel.
- spider:   spider finds/creates a module -> orchestrator hands it to the
  scraper_create agent -> first pipeline run.
"""
from concurrent.futures import ThreadPoolExecutor

from agenda_shared import db
from agenda_shared.notify import (
    notify_subscribers,
    run_custom_prompts_for_module,
    run_keyword_pushes_for_module,
)
from core import dispatch_agent


def _module_health(slug: str) -> str | None:
    row = db.one("SELECT health FROM module WHERE slug = %s", (slug,))
    return row["health"] if row else None


def run_pipeline(slug: str, trigger: str = "manual") -> dict:
    """Full per-module pipeline. Returns a summary dict of what ran."""
    check = dispatch_agent("checking", slug=slug, trigger=trigger)
    agenda_text = (check.get("data") or {}).get("agenda_text", "")
    is_new = (check.get("data") or {}).get("is_new", False)

    # Conditional: broken config -> repair, then re-check.
    if _module_health(slug) in ("broken", "repairing"):
        dispatch_agent("scraper_repair", slug=slug, trigger="repair")
        recheck = dispatch_agent("checking", slug=slug, trigger=trigger)
        agenda_text = (recheck.get("data") or {}).get("agenda_text", "") or agenda_text
        is_new = (recheck.get("data") or {}).get("is_new", False) or is_new

    if len(agenda_text) < 50:
        return {"slug": slug, "summarized": False, "reason": "no agenda content"}

    # Fan-out: these three are independent — run in parallel.
    inputs = {"agenda_text": agenda_text}
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = {
            "summary": pool.submit(dispatch_agent, "summary", slug=slug,
                                   trigger=trigger, inputs=inputs),
            "keyword": pool.submit(dispatch_agent, "keyword", slug=slug,
                                   trigger=trigger, inputs=inputs),
            "categorization": pool.submit(dispatch_agent, "categorization", slug=slug,
                                          trigger=trigger, inputs=inputs),
        }
        results = {k: f.result() for k, f in futures.items()}

    # Only dispatch notifications on an actual new meeting, not every
    # routine check that finds nothing new.
    if is_new:
        mod = db.one("SELECT id, name, slug FROM module WHERE slug = %s", (slug,))
        meeting = db.one(
            "SELECT title FROM meeting WHERE module_id = %s ORDER BY date DESC LIMIT 1",
            (mod["id"],),
        ) if mod else None
        if mod and meeting:
            notify_subscribers(mod["id"], mod["name"], mod["slug"], meeting["title"])
        if mod:
            run_custom_prompts_for_module(mod["id"], agenda_text)
            run_keyword_pushes_for_module(mod["id"], agenda_text)

    return {"slug": slug, "summarized": True,
            "ok": {k: v.get("ok") for k, v in results.items()}}


def run_spider(trigger: str = "manual") -> dict:
    """One spider step: discover/create a module, then scrape + first pipeline."""
    spider = dispatch_agent("spider", trigger=trigger)
    data = spider.get("data") or {}
    slug = data.get("slug")
    candidate_url = data.get("candidate_url")
    if not slug or not data.get("created"):
        return {"created": False, "result": spider.get("result", "")}

    # Orchestrator hands the new module to the scraper (agents don't call agents).
    scrape = dispatch_agent("scraper_create", slug=slug, trigger="spider")
    if not scrape.get("ok"):
        db.execute(
            "UPDATE spider_candidate SET status='rejected', reject_reason=%s WHERE url=%s",
            (scrape.get("error", "scraper_create failed"), candidate_url),
        )
        db.execute("UPDATE module SET health='broken' WHERE slug=%s", (slug,))
        return {"created": True, "slug": slug, "scraped": False}

    db.execute("UPDATE spider_candidate SET status='created' WHERE url=%s", (candidate_url,))
    run_pipeline(slug, trigger="spider")
    return {"created": True, "slug": slug, "scraped": True}


def run_single(agent_type: str, slug: str | None, trigger: str, inputs: dict) -> dict:
    """Trigger one agent directly (used by the admin panel / manual triggers)."""
    return dispatch_agent(agent_type, slug=slug, trigger=trigger, inputs=inputs)


FLOWS = {
    "pipeline": lambda job: run_pipeline(job["slug"], job.get("trigger", "manual")),
    "spider": lambda job: run_spider(job.get("trigger", "manual")),
    "agent": lambda job: run_single(job["agent"], job.get("slug"),
                                    job.get("trigger", "manual"),
                                    job.get("inputs", {})),
}
