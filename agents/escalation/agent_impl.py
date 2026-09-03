"""Escalation Agent — the system watching itself.

Nothing else in the pipeline raises: agents swallow their failures into
agent_run.error, notify.py logs and moves on, and a bad LLM response can be
written straight to a public module page. That is deliberate (one broken
council must not stop the other two hundred), but it means failures pile up
silently. This agent reads those piles on a schedule and escalates anything
a human should look at to the admin.

Four passes, each producing escalation rows keyed by a fingerprint so the
same problem is emailed once, not once per tick:

  1. failed agent runs           (agent_run.status = 'failed')
  2. output that is really a bug (stack traces / code errors reaching
                                  module summaries or agent responses)
  3. site errors                 (site_error, written by the Next.js UI)
  4. modules stuck broken        (health = 'broken' for over a day)

Pass 2 screens with a regex first and only then asks GLM to judge, so a
quiet tick costs no tokens at all.

Job inputs: {"window_hours": int}  (default 24)
"""

import hashlib
import re

from agenda_shared import db, mailer
from agenda_shared.agent import BaseAgent
from agenda_shared.llm import complete_json
from agenda_shared.settings import ADMIN_EMAIL, AGENT_MODEL, BASE_URL

DEFAULT_WINDOW_HOURS = 24

# How many suspicious snippets get an LLM opinion per run. The regex screen
# is cheap; the judgement is not, and a genuinely broken deploy would
# otherwise hand us hundreds of near-identical snippets in one tick.
MAX_LLM_TRIAGE = 6

# Most issues written into one admin email. The first run after a deploy sees
# every standing problem at once; the overflow is recorded, just not mailed.
MAX_EMAIL_ITEMS = 25

# Text that has no business appearing in a council summary or an agent's
# user-facing response. Deliberately narrow -- these must not fire on an
# agenda that merely discusses, say, a "type error" in a bylaw.
CODE_ERROR_PATTERNS = [
    r"Traceback \(most recent call last\)",
    r"\b(SyntaxError|NameError|AttributeError|IndexError|KeyError|ZeroDivisionError|ModuleNotFoundError|ImportError|RecursionError)\b",
    r"\b(TypeError|ValueError|RuntimeError|OSError|Exception)\s*:",
    r'File "[^"]+", line \d+',
    r"\bat [\w$.]+ \([^)]*:\d+:\d+\)",           # JS stack frame
    # Not a bare "is not defined": a bylaw can legitimately say a term is not
    # defined, and the interpreter version is already caught by NameError.
    r"\bReferenceError\b|is not a function|Cannot read propert(?:y|ies) of",
    r"\bpsycopg2?\b|relation \"\w+\" does not exist",
    r"```(?:python|js|javascript|ts|typescript|sql)\b",
    r"NullPointerException|NoMethodError|panic:",
]
_CODE_RE = re.compile("|".join(CODE_ERROR_PATTERNS), re.I)

SEVERITY_RANK = {"info": 0, "warning": 1, "critical": 2}


def looks_like_code_error(text: str | None) -> bool:
    """Cheap screen: does this read like a stack trace or interpreter error?"""
    if not text or len(text) < 12:
        return False
    return bool(_CODE_RE.search(text))


def fingerprint(*parts: str) -> str:
    return hashlib.sha1("|".join(p or "" for p in parts).encode()).hexdigest()


def _clip(text: str | None, limit: int = 600) -> str:
    text = (text or "").strip()
    return text if len(text) <= limit else text[:limit] + " …"


class EscalationAgent(BaseAgent):
    name = "Escalation Agent"
    agent_type = "escalation"

    _DEFAULT_PROMPT = (
        "You are the Escalation Agent for agenda.delivery. You decide whether a "
        "piece of text produced by the system is a software fault (a stack trace, "
        "an interpreter error, leaked code, a database error) rather than real "
        "content, and how urgently a human needs to know."
    )

    def run(self, job: dict) -> str:
        hours = int((job.get("inputs") or {}).get("window_hours") or DEFAULT_WINDOW_HOURS)
        self.emit(
            f"Sweeping the last {hours}h for failures worth escalating.",
            "escalate.scan", f"window: {hours}h",
        )

        findings: list[dict] = []
        for label, check in (
            ("failed agent runs", self._failed_runs),
            ("site errors", self._site_errors),
            ("modules stuck broken", self._stuck_modules),
            ("output that looks like a coding error", self._bad_output),
        ):
            try:
                found = check(hours)
            except Exception as exc:  # one broken pass must not lose the others
                print(f"[escalation] pass '{label}' failed: {exc}")
                self.emit(f"Check for {label} failed: {exc}", "escalate.scan", str(exc)[:200])
                continue
            if found:
                self.emit(f"Found {len(found)} {label}.", "escalate.scan",
                          "; ".join(f["subject"] for f in found[:4])[:300])
            findings.extend(found)

        fresh = [f for f in findings if self._record(f)]
        if not fresh:
            self.emit("Nothing new to escalate — the system looks healthy.",
                      "escalate.scan", f"{len(findings)} known issue(s), 0 new")
            return f"No new escalations ({len(findings)} already known)"

        self.output = {"escalated": len(fresh)}
        if self._notify(fresh, hours):
            return f"Escalated {len(fresh)} issue(s) to {ADMIN_EMAIL}"
        return f"Recorded {len(fresh)} issue(s); admin email could not be sent"

    # ── passes ────────────────────────────────────────────────
    def _failed_runs(self, hours: int) -> list[dict]:
        rows = db.query(
            """SELECT r.id, r.agent::text AS agent, r.error, r.trigger, r.module_id,
                      m.name AS module_name, m.slug
                 FROM agent_run r
                 LEFT JOIN module m ON m.id = r.module_id
                WHERE r.status = 'failed'
                  AND r.created_at > now() - make_interval(hours => %s)
                ORDER BY r.created_at DESC
                LIMIT 100""",
            (hours,),
        )
        out = []
        for r in rows:
            where = r.get("module_name") or "no module"
            error = _clip(r.get("error"), 400) or "(no error recorded)"
            # Fingerprint on agent + module + the error shape, not the run id:
            # the same council failing the same way every 6h is one problem.
            out.append({
                "kind": "agent_run",
                "fingerprint": fingerprint("agent_run", r["agent"], r.get("module_id") or "", error[:200]),
                "severity": "critical" if "OLLAMA_RATE_LIMITED" in error else "warning",
                "subject": f"{r['agent']} failed on {where}",
                "body": (
                    f"Agent:   {r['agent']}\n"
                    f"Module:  {where}"
                    + (f" ({BASE_URL}/module/{r['slug']})" if r.get("slug") else "")
                    + f"\nTrigger: {r.get('trigger')}\n"
                    f"Run id:  {r['id']}\n\n{error}"
                ),
                "module_id": r.get("module_id"),
                "run_id": r["id"],
            })
        return out

    def _site_errors(self, hours: int) -> list[dict]:
        rows = db.query(
            """SELECT message, detail, path, digest, count(*) AS hits,
                      max(created_at) AS last_seen
                 FROM site_error
                WHERE created_at > now() - make_interval(hours => %s)
                GROUP BY message, detail, path, digest
                ORDER BY count(*) DESC
                LIMIT 50""",
            (hours,),
        )
        out = []
        for r in rows:
            hits = int(r["hits"])
            out.append({
                "kind": "site_error",
                "fingerprint": fingerprint("site_error", r.get("digest") or "", r["message"][:200], r.get("path") or ""),
                # A one-off render error is noise; the same page failing
                # repeatedly for visitors is not.
                "severity": "critical" if hits >= 10 else "warning",
                "subject": f"Site error on {r.get('path') or 'the site'}: {_clip(r['message'], 90)}",
                "body": (
                    f"Path:   {r.get('path') or '(unknown)'}\n"
                    f"Hits:   {hits} in the last {hours}h\n"
                    f"Digest: {r.get('digest') or '-'}\n\n"
                    f"{r['message']}\n\n{_clip(r.get('detail'), 1200)}"
                ),
                "module_id": None,
                "run_id": None,
            })
        return out

    def _stuck_modules(self, hours: int) -> list[dict]:
        rows = db.query(
            """SELECT id, name, slug, last_checked FROM module
                WHERE health = 'broken' AND is_demo = FALSE
                  AND (last_checked IS NULL OR last_checked < now() - INTERVAL '24 hours')
                ORDER BY name
                LIMIT 50""")
        return [{
            "kind": "module_broken",
            "fingerprint": fingerprint("module_broken", r["id"]),
            "severity": "warning",
            "subject": f"{r['name']} has been broken for over a day",
            "body": (
                f"The scraper for {r['name']} is flagged broken and self-repair has "
                f"not recovered it.\n\n{BASE_URL}/module/{r['slug']}\n"
                f"Last checked: {r.get('last_checked') or 'never'}"
            ),
            "module_id": r["id"],
            "run_id": None,
        } for r in rows]

    def _bad_output(self, hours: int) -> list[dict]:
        """Content that reached (or nearly reached) a reader but is actually a
        software fault: a summary that is a stack trace, an agent response
        that is an interpreter error."""
        candidates: list[dict] = []

        for r in db.query(
            """SELECT id, name, slug, summary FROM module
                WHERE summary IS NOT NULL AND last_updated > now() - make_interval(hours => %s)
                LIMIT 200""",
            (hours,),
        ):
            if looks_like_code_error(r["summary"]):
                candidates.append({
                    "where": f"summary of {r['name']}",
                    "text": r["summary"],
                    "module_id": r["id"],
                    "run_id": None,
                    "link": f"{BASE_URL}/module/{r['slug']}",
                })

        for r in db.query(
            """SELECT id, run_id, module_id, agent, action, detail, response
                 FROM agent_event
                WHERE created_at > now() - make_interval(hours => %s)
                  AND (response IS NOT NULL OR detail IS NOT NULL)
                ORDER BY created_at DESC
                LIMIT 500""",
            (hours,),
        ):
            text = r.get("response") or r.get("detail") or ""
            if looks_like_code_error(text):
                candidates.append({
                    "where": f"{r['agent']} — {_clip(r.get('action'), 80)}",
                    "text": text,
                    "module_id": r.get("module_id"),
                    "run_id": r.get("run_id"),
                    "link": "",
                })

        if not candidates:
            return []

        self.emit(
            f"{len(candidates)} output(s) look like coding errors — asking the model to confirm.",
            "llm.triage", f"triaging up to {MAX_LLM_TRIAGE}",
        )

        out = []
        for c in candidates[:MAX_LLM_TRIAGE]:
            verdict = self._judge(c)
            if not verdict.get("is_error"):
                continue
            out.append({
                "kind": "bad_output",
                "fingerprint": fingerprint("bad_output", c["where"], _clip(c["text"], 200)),
                "severity": verdict.get("severity", "warning"),
                "subject": f"Coding error in output: {c['where']}",
                "body": (
                    f"Where:  {c['where']}\n"
                    + (f"Link:   {c['link']}\n" if c["link"] else "")
                    + f"Why:    {verdict.get('why', '')}\n\n"
                    f"--- output ---\n{_clip(c['text'], 1500)}"
                ),
                "module_id": c["module_id"],
                "run_id": c["run_id"],
            })
        # Anything beyond the LLM budget still gets escalated, just unjudged --
        # better a slightly noisy alert than a silently dropped one.
        for c in candidates[MAX_LLM_TRIAGE:]:
            out.append({
                "kind": "bad_output",
                "fingerprint": fingerprint("bad_output", c["where"], _clip(c["text"], 200)),
                "severity": "warning",
                "subject": f"Coding error in output: {c['where']}",
                "body": f"Where: {c['where']}\n(not model-triaged: over the per-run budget)\n\n{_clip(c['text'], 1500)}",
                "module_id": c["module_id"],
                "run_id": c["run_id"],
            })
        return out

    def _judge(self, candidate: dict) -> dict:
        """Ask the model whether this really is a software fault."""
        system = self.prompt(self._DEFAULT_PROMPT)
        user = (
            "The text below was produced by agenda.delivery and appeared in: "
            f"{candidate['where']}.\n\n"
            "Decide whether it is a software fault (stack trace, interpreter or "
            "database error, leaked source code, a model refusing with an error) "
            "rather than legitimate civic-agenda content.\n\n"
            'Respond with JSON: {"is_error": true|false, "severity": '
            '"info"|"warning"|"critical", "why": "one short sentence"}\n\n'
            f"---\n{_clip(candidate['text'], 2000)}"
        )
        model = self.model() or AGENT_MODEL
        try:
            verdict = complete_json(system, user, model=model)
        except Exception as exc:
            print(f"[escalation] triage LLM call failed: {exc}")
            # The regex already flagged it; a dead model must not silence that.
            return {"is_error": True, "severity": "warning",
                    "why": f"pattern match (model unavailable: {exc})"}
        self.emit(
            f"Model judged the output in {candidate['where']}.",
            "llm.triage", f"is_error={verdict.get('is_error')} severity={verdict.get('severity')}",
            prompt=f"SYSTEM:\n{system}\n\nUSER:\n{user}", response=str(verdict), model=model,
        )
        return verdict if isinstance(verdict, dict) else {"is_error": True, "severity": "warning"}

    # ── recording + notifying ─────────────────────────────────
    def _record(self, finding: dict) -> bool:
        """Insert unless this fingerprint is already on file. Returns True only
        for genuinely new problems, which is what gates the admin email."""
        row = db.execute(
            """INSERT INTO escalation (kind, fingerprint, severity, subject, body, module_id, run_id)
               VALUES (%s,%s,%s,%s,%s,%s,%s)
               ON CONFLICT (fingerprint) DO NOTHING
               RETURNING id""",
            (finding["kind"], finding["fingerprint"], finding["severity"],
             finding["subject"], finding["body"], finding.get("module_id"),
             finding.get("run_id")),
        )
        return bool(row)

    def _notify(self, fresh: list[dict], hours: int) -> bool:
        worst = max(fresh, key=lambda f: SEVERITY_RANK.get(f["severity"], 1))["severity"]
        n = len(fresh)
        subject = f"[agenda.delivery] {n} new {worst} issue{'s' if n != 1 else ''}"
        parts = [
            f"The Escalation Agent found {n} new issue{'s' if n != 1 else ''} "
            f"in the last {hours} hours.\n"
        ]
        # Worst first, and capped: the first run after a deploy sees every
        # standing problem at once, and a hundred-screen email gets ignored
        # rather than read. The rest are still recorded in `escalation`.
        ranked = sorted(fresh, key=lambda f: -SEVERITY_RANK.get(f["severity"], 1))
        for f in ranked[:MAX_EMAIL_ITEMS]:
            parts.append(
                f"\n[{f['severity'].upper()}] {f['subject']}\n"
                f"{'-' * 60}\n{f['body']}\n"
            )
        if n > MAX_EMAIL_ITEMS:
            parts.append(
                f"\n… and {n - MAX_EMAIL_ITEMS} more, recorded in the escalation table.\n"
            )
        parts.append(f"\n\nAgents: {BASE_URL}/agents")
        ok = mailer.send_plain(ADMIN_EMAIL, subject, "\n".join(parts))
        if ok:
            db.execute(
                "UPDATE escalation SET notified_at = now() WHERE fingerprint = ANY(%s)",
                ([f["fingerprint"] for f in fresh],),
            )
        self.emit(
            f"Escalated {n} issue(s) to the administrator." if ok
            else f"Could not email the administrator about {n} issue(s).",
            "escalate.notify", f"{ADMIN_EMAIL} — worst severity {worst}",
        )
        return ok
