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
               module_id: str | None = None) -> None:
    """Persist + publish one agent step."""
    sort = int(time.time() * 1000) % 1_000_000
    db.execute(
        """INSERT INTO agent_event (module_id, run_id, agent, action, tool, detail, sort)
           VALUES (%s, %s, %s, %s, %s, %s, %s)""",
        (module_id, run_id, agent, action, tool, detail, sort),
    )
    _r.publish(EVENTS_CHANNEL, json.dumps({
        "runId": run_id,
        "moduleId": module_id,
        "agent": agent,
        "action": action,
        "tool": tool,
        "detail": detail,
    }))
