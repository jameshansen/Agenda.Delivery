"""Orchestrator HTTP service + background worker + scheduler.

Run with: gunicorn -w 1 --threads 8 -b 0.0.0.0:8000 app:app
(single worker so the scheduler/worker threads run exactly once.)
"""
import json
import os
import threading
import time

from flask import Flask, request, jsonify, Response

from agenda_shared import db
from agenda_shared.bus import redis_client
from agenda_shared.notify import flush_mailing_lists
from agenda_shared.settings import EVENTS_CHANNEL
from core import is_paused, pause, RateLimited
from flows import FLOWS

app = Flask(__name__)

JOBS_KEY = "orchestrator:jobs"
CHECK_SECS_DEFAULT = int(os.environ.get("CHECK_INTERVAL_SECS", "21600"))   # 6h
SPIDER_SECS_DEFAULT = int(os.environ.get("SPIDER_INTERVAL_SECS", "3600"))  # 1h
ESCALATION_SECS_DEFAULT = int(os.environ.get("ESCALATION_INTERVAL_SECS", "900"))  # 15m


def enqueue(job: dict) -> None:
    redis_client().rpush(JOBS_KEY, json.dumps(job))


def _schedule_secs(agent_type: str, default: int) -> int | None:
    """Read schedule from agent_config; None if disabled."""
    row = db.one("SELECT schedule_secs, enabled FROM agent_config WHERE agent = %s",
                 (agent_type,))
    if row is None:
        return default
    if not row["enabled"]:
        return None
    return row["schedule_secs"] if row["schedule_secs"] is not None else default


def _spider_mode() -> str:
    """'growth' (find new councils from sources.toml) or 'active' (find/fix
    working agenda pages for councils we already have, no new councils).
    Read from agent_config.params->>'mode'; defaults to 'growth'."""
    try:
        row = db.one("SELECT params->>'mode' AS mode FROM agent_config WHERE agent = 'spider'")
        return (row or {}).get("mode") or "growth"
    except Exception:
        return "growth"


# ── Background worker: pops jobs, runs flows, handles rate-limit pause ──
def _worker_loop() -> None:
    r = redis_client()
    while True:
        try:
            remaining = is_paused()
            if remaining > 0:
                time.sleep(min(remaining, 30))
                continue
            item = r.blpop(JOBS_KEY, timeout=5)
            if not item:
                continue
            job = json.loads(item[1])
            flow = FLOWS.get(job.get("flow"))
            if not flow:
                continue
            try:
                flow(job)
            except RateLimited:
                # Requeue this job and pause. A human / Claude-for-Chrome checks
                # the real reset time; 15 min is a safe default floor.
                r.rpush(JOBS_KEY, json.dumps(job))
                pause(15 * 60)
        except Exception as e:  # noqa: BLE001 — worker must never die
            print(f"[worker] error: {e}", flush=True)
            time.sleep(1)


# ── Scheduler: enqueues pipelines + spider on their intervals ──
KICK_DELAY_SECS = 120  # let postgres/redis/agents settle, then run the first pass


def _scheduler_loop() -> None:
    # Empty `last` => everything is due at boot. We fire the first pass once
    # KICK_DELAY_SECS have elapsed (not a full interval later) so a redeploy
    # doesn't postpone autonomous runs by 6h. Spider only enqueues one job, so
    # a boot kick is harmless (and it's disabled anyway).
    boot = time.time()
    last: dict[str, float] = {}
    while True:
        try:
            now = time.time()
            if now - boot < KICK_DELAY_SECS:
                time.sleep(5)
                continue
            cs = _schedule_secs("checking", CHECK_SECS_DEFAULT)
            if cs and now - last.get("checking", 0) >= cs:
                mods = db.query("SELECT slug FROM module WHERE is_demo = FALSE")
                for m in mods:
                    enqueue({"flow": "pipeline", "slug": m["slug"],
                             "trigger": "scheduled update"})
                last["checking"] = now
            ss = _schedule_secs("spider", SPIDER_SECS_DEFAULT)
            if ss and now - last.get("spider", 0) >= ss:
                flow = "spider_active" if _spider_mode() == "active" else "spider"
                enqueue({"flow": flow, "trigger": "scheduled update"})
                last["spider"] = now
            # Escalation: sweeps failed runs, bad output and site errors,
            # and emails the admin about anything new.
            es = _schedule_secs("escalation", ESCALATION_SECS_DEFAULT)
            if es and now - last.get("escalation", 0) >= es:
                enqueue({"flow": "agent", "agent": "escalation",
                         "trigger": "scheduled update"})
                last["escalation"] = now
            # Mailing lists: cheap, self-gating (only sends when a list's
            # threshold or schedule is actually due). Check once a minute.
            if now - last.get("mailing", 0) >= 60:
                flush_mailing_lists()
                last["mailing"] = now
        except Exception as e:  # noqa: BLE001
            print(f"[scheduler] error: {e}", flush=True)
        time.sleep(5)


_started = False
_start_lock = threading.Lock()


def _start_background() -> None:
    global _started
    with _start_lock:
        if _started:
            return
        _started = True
        threading.Thread(target=_worker_loop, daemon=True, name="worker").start()
        threading.Thread(target=_scheduler_loop, daemon=True, name="scheduler").start()
        print("[orchestrator] worker + scheduler started", flush=True)


# ── HTTP API ──
@app.post("/trigger")
def trigger():
    """Queue a flow. body: {flow: pipeline|spider|agent, slug?, agent?, inputs?}"""
    job = request.get_json(force=True, silent=True) or {}
    if job.get("flow") not in FLOWS:
        return jsonify(ok=False, error="unknown flow"), 400
    job.setdefault("trigger", "manual")
    enqueue(job)
    return jsonify(ok=True, queued=True)


@app.get("/status")
def status():
    return jsonify(
        ok=True,
        queued=redis_client().llen(JOBS_KEY),
        paused_secs=round(is_paused(), 1),
    )


@app.get("/events")
def events():
    """SSE relay of the Redis agent-events channel (optionally filtered)."""
    run_id = request.args.get("runId")
    module_id = request.args.get("moduleId")

    def gen():
        p = redis_client().pubsub()
        p.subscribe(EVENTS_CHANNEL)
        yield "retry: 3000\n\n"
        for msg in p.listen():
            if msg.get("type") != "message":
                continue
            ev = json.loads(msg["data"])
            if run_id and ev.get("runId") != run_id:
                continue
            if module_id and ev.get("moduleId") != module_id:
                continue
            yield f"data: {json.dumps(ev)}\n\n"

    return Response(gen(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/health")
def health():
    try:
        db.one("SELECT 1 AS ok")
        redis_client().ping()
        return jsonify(ok=True)
    except Exception as e:  # noqa: BLE001
        return jsonify(ok=False, error=str(e)), 503


# Start threads when imported under gunicorn (and when run directly).
_start_background()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000, threaded=True)
