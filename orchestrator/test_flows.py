"""Self-check for the pipeline's cost gates.

run_pipeline decides when the expensive agents run. These are the three
decisions that keep a quiet six-hourly check from costing a full set of LLM
calls; if any of them regresses the bill goes back up silently, so assert
them here. The spider flows are checked too, since a newly added council
must get its first summary without waiting for its next agenda. Stubs stand
in for the DB and the agent dispatch: no postgres, no redis, no network.

    python orchestrator/test_flows.py
"""
import sys
import types

calls: list[str] = []
health = "healthy"
keywords_pending = False
check_data: dict = {}
repair_data: dict = {}
scrape_data: dict = {}
summary_data: dict = {}
rate_limited: set = set()
delivered: list[dict] = []


def _stub():
    db = types.ModuleType("db")

    def one(sql, params=None):
        if "health FROM module" in sql:
            return {"health": health}
        if "FROM keyword" in sql:
            return {"?column?": 1} if keywords_pending else None
        return {"id": "m1", "name": "Testville", "slug": "testville",
                "summary": "", "title": "Regular Council Meeting"}

    db.one = one
    db.query = lambda sql, params=None: []
    db.execute = lambda sql, params=None: None

    shared = types.ModuleType("agenda_shared")
    shared.db = db
    notify = types.ModuleType("agenda_shared.notify")
    notify.run_automation_rules = lambda module_id, ctx: delivered.append(ctx)
    core = types.ModuleType("core")

    class RateLimited(Exception):
        pass

    def dispatch_agent(agent_type, **kw):
        calls.append(agent_type)
        if agent_type in rate_limited:
            raise RateLimited("OLLAMA_RATE_LIMITED: 429")
        data = {"checking": check_data, "scraper_repair": repair_data,
                "scraper_create": scrape_data, "summary": summary_data,
                "spider": {"slug": "testville", "created": True,
                           "candidate_url": "https://testville.test/"}}.get(agent_type, {})
        return {"ok": True, "result": "", "data": data, "run_id": "r1"}

    core.dispatch_agent = dispatch_agent
    core.RateLimited = RateLimited
    for name, mod in (("agenda_shared", shared), ("agenda_shared.db", db),
                      ("agenda_shared.notify", notify), ("core", core)):
        sys.modules[name] = mod


def main():
    global health, keywords_pending, check_data, repair_data, scrape_data, summary_data
    _stub()
    sys.path.insert(0, __file__.rsplit("/", 1)[0].rsplit("\\", 1)[0])
    import flows

    agenda = "x" * 2000

    # A healthy module with nothing new: the check runs, nothing else does.
    health, keywords_pending = "healthy", False
    check_data = {"agenda_text": agenda, "is_new": False}
    calls.clear()
    flows.run_pipeline("testville")
    assert calls == ["checking"], calls

    # Same, but a reader added a keyword that has no summary yet.
    keywords_pending = True
    calls.clear()
    flows.run_pipeline("testville")
    assert calls == ["checking", "keyword"], calls

    # A genuinely new agenda pays for the full fan-out.
    keywords_pending = False
    check_data = {"agenda_text": agenda, "is_new": True}
    calls.clear()
    flows.run_pipeline("testville")
    assert sorted(calls) == ["categorization", "checking", "keyword", "summary"], calls

    # A module already marked broken is not repaired again.
    health = "broken"
    check_data = {"agenda_text": "", "is_new": False}
    calls.clear()
    flows.run_pipeline("testville")
    assert calls == ["checking"], calls

    # One that just broke gets a repair, and no second check after it: the
    # repair's own output carries the agenda forward.
    health = "repairing"
    repair_data = {"agenda_text": agenda, "is_new": True}
    calls.clear()
    flows.run_pipeline("testville")
    assert calls.count("checking") == 1, calls
    assert "scraper_repair" in calls and "summary" in calls, calls

    # A failed repair stops there rather than fanning out on stale text.
    repair_data = {"agenda_text": "", "is_new": False}
    calls.clear()
    flows.run_pipeline("testville")
    assert calls == ["checking", "scraper_repair"], calls

    # A council the spider just added gets its first summary from the
    # meeting the scraper recorded. A check would see that meeting already
    # on file and call it old news.
    health = "healthy"
    check_data = {"agenda_text": agenda, "is_new": False}
    scrape_data = {"agenda_text": agenda, "is_new": True}
    for spider in (flows.run_spider, flows.run_spider_active):
        calls.clear()
        spider()
        assert calls[:2] == ["spider", "scraper_create"], calls
        assert sorted(calls[2:]) == ["categorization", "keyword", "summary"], calls

    # A scraper that recorded nothing new leaves it to the check, as before.
    scrape_data = {"agenda_text": agenda, "is_new": False}
    calls.clear()
    flows.run_spider()
    assert calls == ["spider", "scraper_create", "checking"], calls

    # Deliveries carry this run's summary; a declined summary sends none,
    # rather than the previous agenda's.
    check_data = {"agenda_text": agenda, "is_new": True}
    for written in ("Council approved the budget.", None):
        summary_data = {"summary": written} if written else {}
        delivered.clear()
        flows.run_pipeline("testville")
        assert delivered[0]["summary"] == (written or ""), delivered

    # A rate limit in the fan-out resumes as a new agenda: the meeting is on
    # file by then, so a plain retry's check would call it old news.
    rate_limited.add("summary")
    try:
        flows.run_pipeline("testville")
        raise AssertionError("expected RateLimited")
    except sys.modules["core"].RateLimited as e:
        job = e.retry_job
    rate_limited.clear()
    assert job["found"] == {"is_new": True, "agenda_text": agenda}, job
    calls.clear()
    flows.FLOWS["pipeline"](job)
    assert "checking" not in calls and "summary" in calls, calls

    print("ok - pipeline cost gates hold")


if __name__ == "__main__":
    main()
