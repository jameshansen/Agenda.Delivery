"""Self-check: the job queue must not stack duplicates.

A repeat of an already-waiting job is what turned a paused queue into 297
pending pipeline runs. This imports app.py's real enqueue; the modules it
needs (flask, redis, postgres) are stubbed, so nothing is contacted.

    python orchestrator/test_enqueue.py
"""
import json
import os
import sys
import types


class FakeRedis:
    def __init__(self):
        self.items: list[str] = []

    def lrange(self, key, start, end):
        return list(self.items)

    def rpush(self, key, value):
        self.items.append(value)

    def blpop(self, key, timeout=0):
        return None            # worker thread idles instead of erroring

    def get(self, key):
        return None


def _stub(redis):
    flask = types.ModuleType("flask")

    class App:
        def __init__(self, *a, **k):
            pass

        def _dec(self, *a, **k):
            return lambda fn: fn

        post = get = route = _dec

    flask.Flask = App
    flask.request = flask.jsonify = flask.Response = object()

    db = types.ModuleType("db")
    db.one = db.execute = lambda *a, **k: None
    db.query = lambda *a, **k: []
    bus = types.ModuleType("bus")
    bus.redis_client = lambda: redis
    notify = types.ModuleType("notify")
    notify.flush_mailing_lists = lambda: None
    settings = types.ModuleType("settings")
    settings.EVENTS_CHANNEL = "agent-events"
    shared = types.ModuleType("agenda_shared")
    shared.db, shared.bus = db, notify
    core = types.ModuleType("core")
    core.is_paused = lambda: 0.0
    core.pause = lambda s: None
    core.RateLimited = type("RateLimited", (Exception,), {})
    flows = types.ModuleType("flows")
    flows.FLOWS = {}

    for name, mod in (("flask", flask), ("agenda_shared", shared),
                      ("agenda_shared.db", db), ("agenda_shared.bus", bus),
                      ("agenda_shared.notify", notify),
                      ("agenda_shared.settings", settings),
                      ("core", core), ("flows", flows)):
        sys.modules[name] = mod


def main():
    r = FakeRedis()
    _stub(r)
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from app import enqueue

    job = {"flow": "pipeline", "slug": "city-of-kelowna", "trigger": "scheduled update"}
    for _ in range(12):
        enqueue(job)
    assert len(r.items) == 1, r.items

    # Key order must not defeat the match: a requeued job is rebuilt from
    # parsed JSON, not from the dict the scheduler wrote.
    enqueue({"trigger": "scheduled update", "slug": "city-of-kelowna", "flow": "pipeline"})
    assert len(r.items) == 1, r.items

    # Bytes come back from a real Redis client, strings from decode_responses.
    r.items = [json.dumps(job, sort_keys=True).encode()]
    enqueue(job)
    assert len(r.items) == 1, r.items

    # A different module is a different job.
    enqueue({"flow": "pipeline", "slug": "city-of-surrey", "trigger": "scheduled update"})
    assert len(r.items) == 2, r.items

    # Popping it clears the way for the next cycle's copy.
    r.items.pop(0)
    enqueue(job)
    assert len(r.items) == 2, r.items

    print("ok - queue holds one copy per pending job")


if __name__ == "__main__":
    main()
