"""Redis event bus + agent-event persistence.

emit_event does two things for every step an agent takes:
  1. INSERT an agent_event row (durable history the UI reads from Postgres)
  2. PUBLISH the same event to the Redis channel (live SSE via orchestrator)
"""
import json
import time

import redis

from .settings import REDIS_URL, EVENTS_CHANNEL
from . import db

_r = redis.from_url(REDIS_URL, decode_responses=True)


def redis_client() -> redis.Redis:
    return _r


def emit_event(run_id: str, agent: str, action: str,
               tool: str | None = None, detail: str | None = None,
               module_id: str | None = None, screenshot: str | None = None,
               prompt: str | None = None, response: str | None = None,
               model: str | None = None) -> None:
    """Persist + publish one agent step. `screenshot`, if given, is a JPEG
    data URI (see tools._capture_screenshot) -- for demo/activity-feed
    purposes, not every agent step has one, only browser-driven ones.
    `prompt`/`response`, if given, are the full system+user LLM prompt and
    raw response for this step -- lets the UI offer an expandable "view
    full prompt/response" affordance; most non-LLM steps have neither.
    `model`, if given, is the Ollama model that actually served this step's
    LLM call (e.g. "glm-5.3")."""
    if prompt and len(prompt) > 12_000:
        prompt = prompt[:12_000] + "\n\n…(truncated)"
    if response and len(response) > 12_000:
        response = response[:12_000] + "\n\n…(truncated)"
    sort = int(time.time() * 1000) % 1_000_000
    db.execute(
        """INSERT INTO agent_event
           (module_id, run_id, agent, action, tool, detail, sort, screenshot, prompt, response, model)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
        (module_id, run_id, agent, action, tool, detail, sort, screenshot, prompt, response, model),
    )
    _r.publish(EVENTS_CHANNEL, json.dumps({
        "runId": run_id,
        "moduleId": module_id,
        "agent": agent,
        "action": action,
        "tool": tool,
        "detail": detail,
        "screenshot": screenshot,
        "prompt": prompt,
        "response": response,
        "model": model,
    }))
