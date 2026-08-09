"""Orchestrator core: agent dispatch, run lifecycle, retries, rate-limit pause.

The orchestrator is the only thing that talks to agents. It creates the
agent_run row, POSTs the job to the agent's HTTP service, retries on
transient failure, and marks the run completed/failed. Agents stay dumb.
"""
import os
import time

import requests

from agenda_shared import db
from agenda_shared.bus import redis_client, emit_event

# agent_type -> display name (matches agent_event.agent + the UI columns).
DISPLAY_NAMES = {
    "spider": "Spider Agent",
    "scraper_create": "Scraper Agent",
    "scraper_repair": "Scraper Repair Agent",
    "checking": "Checking Agent",
    "categorization": "Categorization Agent",
    "summary": "Summary Agent",
    "keyword": "Keyword Agent",
}

# agent_type -> base URL of its container. scraper_create/repair share one
# container (it routes on job["agent"]).
SERVICES = {
    "spider": os.environ.get("SPIDER_URL", "http://spider:8000"),
    "scraper_create": os.environ.get("SCRAPER_URL", "http://scraper:8000"),
    "scraper_repair": os.environ.get("SCRAPER_URL", "http://scraper:8000"),
    "checking": os.environ.get("CHECKING_URL", "http://checking:8000"),
    "categorization": os.environ.get("CATEGORIZATION_URL", "http://categorization:8000"),
    "summary": os.environ.get("SUMMARY_URL", "http://summary:8000"),
    "keyword": os.environ.get("KEYWORD_URL", "http://keyword:8000"),
}

MAX_RETRIES = int(os.environ.get("AGENT_MAX_RETRIES", "2"))
PAUSE_KEY = "orchestrator:paused_until"  # epoch secs; queue paused until then


class RateLimited(Exception):
    """Ollama Cloud 429 bubbled up from an agent. Pause the whole pipeline."""


def is_paused() -> float:
    """Return seconds remaining in a rate-limit pause, or 0."""
    val = redis_client().get(PAUSE_KEY)
    if not val:
        return 0.0
    remaining = float(val) - time.time()
    return max(0.0, remaining)


def pause(seconds: float) -> None:
    redis_client().set(PAUSE_KEY, time.time() + seconds)


def _create_run(agent_type: str, module_id: str | None, trigger: str) -> str:
    row = db.execute(
        """INSERT INTO agent_run (module_id, agent, status, trigger, started_at)
           VALUES (%s, %s, 'running', %s, now()) RETURNING id""",
        (module_id, agent_type, trigger),
    )
    return row["id"]


def _finish_run(run_id: str, error: str | None = None) -> None:
    db.execute(
        "UPDATE agent_run SET status = %s, finished_at = now(), error = %s WHERE id = %s",
        ("failed" if error else "completed", error, run_id),
    )


def dispatch_agent(agent_type: str, *, slug: str | None = None,
                   module_id: str | None = None, trigger: str = "manual",
                   inputs: dict | None = None) -> dict:
    """Run one agent to completion. Returns {ok, result, data, run_id}.

    Raises RateLimited so the worker can pause the queue.
    """
    if module_id is None and slug:
        mod = db.one("SELECT id FROM module WHERE slug = %s", (slug,))
        module_id = mod["id"] if mod else None

    url = SERVICES.get(agent_type)
    if not url:
        raise ValueError(f"No service for agent type {agent_type}")

    run_id = _create_run(agent_type, module_id, trigger)
    # Transparency: announce how this run was started, in the agent's own
    # stream ("Task started by scheduled update", etc.).
    emit_event(run_id, DISPLAY_NAMES.get(agent_type, agent_type),
               f"Task started by {trigger}.", tool=None,
               detail=f"trigger: {trigger}", module_id=module_id)
    job = {
        "run_id": run_id,
        "agent": agent_type,
        "module_id": module_id,
        "slug": slug,
        "trigger": trigger,
        "inputs": inputs or {},
    }

    last_err = ""
    for attempt in range(MAX_RETRIES + 1):
        try:
            res = requests.post(f"{url}/run", json=job, timeout=610)
            body = res.json()
            if res.ok and body.get("ok"):
                _finish_run(run_id)
                return {"ok": True, "result": body.get("result", ""),
                        "data": body.get("data", {}), "run_id": run_id}
            # Agent reported an error.
            err = body.get("error", f"HTTP {res.status_code}")
            if "OLLAMA_RATE_LIMITED" in err:
                _finish_run(run_id, err)
                raise RateLimited(err)
            last_err = err
        except RateLimited:
            raise
        except requests.RequestException as e:
            last_err = str(e)
        if attempt < MAX_RETRIES:
            time.sleep(2 ** attempt)  # 1s, 2s backoff

    _finish_run(run_id, last_err)
    return {"ok": False, "result": "", "error": last_err, "run_id": run_id}
