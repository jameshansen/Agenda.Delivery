"""Checking Agent — poll a module for a new agenda; flag broken configs.

Port of src/agents/agents/checking.ts. Returns the latest agenda_text in
self.output so the orchestrator can fan it out to summary/keyword/categorize.
Job: {"slug": str}
"""
from datetime import datetime, timezone

from agenda_shared.agent import BaseAgent, module_by_slug
from agenda_shared import db
from agenda_shared import tools


class CheckingAgent(BaseAgent):
    name = "Checking Agent"
    agent_type = "checking"

    def run(self, job: dict) -> str:
        slug = job["slug"]
        mod = module_by_slug(slug)
        if not mod:
            raise RuntimeError(f"Module {slug} not found")
        self.module_id = mod["id"]

        self.emit(f"Checking if {mod['name']} has posted a new agenda.",
                  "schedule.predict", "cadence: biweekly, confidence 0.91 → poll now")

        # verify.selfcheck is a cheap, coarse heuristic (keyword matches on
        # raw HTML) -- informational only. It does NOT gate whether we try
        # to find the agenda: agenda_find_latest is the real, authoritative
        # check (it has its own static->render->browser escalation and can
        # succeed on sites this quick check would wrongly reject, e.g. JS
        # portals or a slightly-off selector). Only agenda_find_latest's own
        # result determines health.
        check = tools.verify_selfcheck(slug)
        self.emit(
            "Verified the agenda page is accessible and selectors match."
            if check["ok"] else
            "Quick structure check flagged possible drift — trying the full agenda search anyway.",
            "verify.selfcheck", check["detail"],
        )

        self.emit("Searching for the most recent meeting on the agenda listing page.",
                  "agenda.find_latest", f"fetching {mod['source_url']}")
        found = tools.agenda_find_latest(slug, emit=self.emit, model=self.model())
        if not found["ok"]:
            self.emit("Could not find a recent meeting agenda — the listing page may have changed.",
                      "agenda.find_latest", found["detail"])
            db.execute("UPDATE module SET health='repairing', last_checked=now() WHERE id=%s",
                       (mod["id"],))
            return "No recent agenda found — needs repair"

        d = found["data"]
        agenda_text = d.get("agendaText", "") or ""
        self.output["agenda_text"] = agenda_text  # orchestrator fans this out

        mdate = _parse_dt(d.get("meetingDate"))
        self.emit(
            f'Found the latest meeting: "{d.get("meetingTitle")}" '
            f'({len(agenda_text)} chars of agenda content, {len(d.get("pdfLinks") or [])} PDF links).',
            "agenda.find_latest", found["detail"],
        )

        latest = db.one(
            "SELECT date FROM meeting WHERE module_id=%s ORDER BY date DESC LIMIT 1",
            (mod["id"],),
        )
        is_new = latest is None or (mdate is not None and latest["date"] < _naive(mdate))
        self.output["is_new"] = is_new  # orchestrator gates notify dispatch on this

        if is_new:
            db.execute(
                """INSERT INTO meeting (module_id, date, title, kind, pages, pdf_url, meeting_url)
                   VALUES (%s,%s,%s,'Council Meeting',%s,%s,%s)
                   ON CONFLICT (module_id, date, title) DO NOTHING""",
                (mod["id"], _naive(mdate) if mdate else _now(), d.get("meetingTitle"),
                 d.get("pages") or 0, (d.get("pdfLinks") or [None])[0],
                 d.get("meetingUrl")),
            )
            self.emit(f'New agenda detected: "{d.get("meetingTitle")}". '
                      "Recording it and triggering the summary pipeline.",
                      "agenda.find_latest",
                      f"meeting date: {mdate.date().isoformat() if mdate else 'unknown'}")
        else:
            self.emit("No new agendas since last check — the latest meeting is already recorded.",
                      None, "no action needed")

        tools.record_additional_council_meeting(mod["id"], d.get("additionalMeeting"), self.emit)

        db.execute(
            "UPDATE module SET health='healthy', last_updated=now(), last_checked=now() WHERE id=%s",
            (mod["id"],))
        return (f'New agenda found: {d.get("meetingTitle")}' if is_new
                else "Module healthy — no new agendas")


def _parse_dt(iso: str | None):
    if not iso:
        return None
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        return None


def _naive(dt: datetime) -> datetime:
    """Postgres columns are `timestamp` (no tz); store as naive UTC."""
    return dt.astimezone(timezone.utc).replace(tzinfo=None)


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)
