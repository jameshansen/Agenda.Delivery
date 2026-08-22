"""Notification dispatch pipeline.

Called from orchestrator/flows.py after a checking run finds a new meeting.
Two legs:
  - notify_subscribers: the base email/text alert to everyone subscribed.
  - run_automation_rules: the Subscriptions → Artifacts → Actions flowchart —
    per-rule content (summary / link / full text / custom-prompt / keyword
    artifact) delivered to a script, a Discord hook, or queued to a mailing list.

Mailing lists are drained separately by flush_mailing_lists (scheduler tick).

Every function here is resilient by design -- a bad webhook or a stuck LLM
call must never take down the pipeline that triggers it, so failures are
logged and swallowed, never raised.
"""

import re
import smtplib
from datetime import datetime, timezone
from email.message import EmailMessage

import requests

from . import db, llm, settings

AGENDA_CHAR_CAP = 8000


def _post_json(url: str, body: dict, headers: dict | None = None) -> None:
    try:
        requests.post(url, json=body, headers=headers, timeout=10)
    except Exception as exc:
        print(f"[notify] post to {url} failed: {exc}")


def _send_email(to: str, subject: str, body: str) -> None:
    """Relay through the host Postfix, which DKIM-signs and delivers."""
    if not settings.SMTP_HOST:
        print("[notify] SMTP_HOST unset; skipping email leg")
        return
    msg = EmailMessage()
    msg["From"] = settings.MAIL_FROM
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)
    try:
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as s:
            s.send_message(msg)
    except Exception as exc:
        print(f"[notify] email to {to} failed: {exc}")


def notify_subscribers(module_id: str, module_name: str, module_slug: str, meeting_title: str) -> None:
    """Base alert: email everyone subscribed to this module via the host SMTP relay."""
    try:
        subs = db.query(
            "SELECT user_id, channel, contact FROM subscription WHERE module_id = %s",
            (module_id,),
        )
    except Exception as exc:
        print(f"[notify] loading subscriptions failed: {exc}")
        return

    subject = f"New agenda: {module_name}"
    body = (
        f"{module_name} just posted a new agenda: {meeting_title}\n\n"
        f"Read the AI summary: https://agenda.delivery/module/{module_slug}\n\n"
        "You're receiving this because you subscribed on agenda.delivery."
    )

    for sub in subs:
        if sub["channel"] == "email":
            _send_email(sub["contact"], subject, body)
        elif sub["channel"] == "text":
            # ponytail: SMS sender not wired. Enable settings.SMS_ENABLED and add
            # a Twilio call here once a sender exists; skipped until then.
            if settings.SMS_ENABLED:
                print(f"[notify] SMS enabled but no sender wired for {sub['contact']}")


def _artifact_content(artifact: dict, agenda_text: str) -> str | None:
    """Run a reusable artifact transform against the agenda text."""
    snippet = agenda_text[:AGENDA_CHAR_CAP]
    if artifact["kind"] == "custom_prompt" and artifact.get("prompt_text"):
        return llm.complete(
            "You are a helpful civic-agenda assistant. Follow the user's instruction precisely.",
            f"{artifact['prompt_text']}\n\n---\nAgenda:\n{snippet}",
        )
    if artifact["kind"] == "keywords" and artifact.get("keywords"):
        return llm.complete(
            "You summarize civic agendas for keyword monitoring.",
            f"Keywords: {artifact['keywords']}\n\nAgenda:\n{snippet}\n\n"
            "Summarize how these keywords' topics appear, if at all, in the above agenda.",
        )
    return None


def _rule_content(rule: dict, ctx: dict) -> str:
    """Resolve what a rule should deliver: artifact output, or the raw
    summary / link / full-text content mode."""
    if rule.get("artifact_id"):
        art = db.one(
            "SELECT kind, prompt_text, keywords FROM automation_artifact WHERE id = %s",
            (rule["artifact_id"],),
        )
        if art:
            out = _artifact_content(art, ctx["agenda_text"])
            if out:
                return out
    mode = rule.get("content_mode") or "summary"
    if mode == "link":
        return f"https://agenda.delivery/module/{ctx['module_slug']}"
    if mode == "full_text":
        return ctx["agenda_text"][:AGENDA_CHAR_CAP]
    return ctx.get("summary") or ctx["meeting_title"]


def run_automation_rules(module_id: str, ctx: dict) -> None:
    """Evaluate the user-defined flowchart rules for this module and deliver."""
    try:
        rules = db.query("SELECT * FROM automation_rule WHERE module_id = %s", (module_id,))
    except Exception as exc:
        print(f"[notify] loading automation_rules failed: {exc}")
        return

    for rule in rules:
        try:
            content = _rule_content(rule, ctx)
        except Exception as exc:
            print(f"[notify] rule {rule['id']} content build failed: {exc}")
            continue

        # Keep the module page's keyword section fresh: store the latest output
        # of any keyword-artifact rule for this module.
        if rule.get("artifact_id"):
            try:
                art = db.one("SELECT kind FROM automation_artifact WHERE id = %s", (rule["artifact_id"],))
                if art and art["kind"] == "keywords":
                    db.execute(
                        """INSERT INTO module_keyword_output (module_id, artifact_id, summary)
                           VALUES (%s,%s,%s)
                           ON CONFLICT (module_id, artifact_id)
                           DO UPDATE SET summary = EXCLUDED.summary, updated_at = now()""",
                        (ctx["module_id"], rule["artifact_id"], content),
                    )
            except Exception as exc:
                print(f"[notify] keyword output store for rule {rule['id']} failed: {exc}")

        kind = rule["action_kind"]
        try:
            if kind == "email":
                urow = db.one('SELECT email FROM "user" WHERE id = %s', (rule.get("user_id"),))
                if urow and urow.get("email"):
                    _send_email(urow["email"], f"{ctx['module_name']}: {ctx['meeting_title']}", content)
            elif kind in ("discord", "script"):
                target = db.one("SELECT url FROM automation_target WHERE id = %s", (rule.get("target_id"),))
                if not target:
                    continue
                if kind == "discord":
                    msg = f"**{ctx['module_name']}** — {ctx['meeting_title']}\n{content}"
                    _post_json(target["url"], {"content": msg[:1900]})
                else:
                    _post_json(target["url"], {
                        "module": ctx["module_slug"],
                        "module_name": ctx["module_name"],
                        "meeting": ctx["meeting_title"],
                        "content": content,
                    })
            elif kind == "mailing_list" and rule.get("list_id"):
                db.execute(
                    "INSERT INTO mailing_queue (list_id, subject, body) VALUES (%s,%s,%s)",
                    (rule["list_id"], f"{ctx['module_name']}: {ctx['meeting_title']}", content),
                )
        except Exception as exc:
            print(f"[notify] rule {rule['id']} delivery ({kind}) failed: {exc}")


# ── Mailing lists ─────────────────────────────────────────────
def _maybe_send_list(ml: dict) -> None:
    pending = db.query(
        "SELECT id, subject, body FROM mailing_queue WHERE list_id = %s AND sent_at IS NULL ORDER BY created_at",
        (ml["id"],),
    )
    if not pending:
        return

    if ml["send_policy"] == "threshold":
        due = len(pending) >= (ml["threshold"] or 1)
    else:  # schedule
        interval = 86400 if ml["frequency"] == "daily" else 604800
        last = ml.get("last_sent_at")
        if last is not None and last.tzinfo is None:
            last = last.replace(tzinfo=timezone.utc)
        due = last is None or (datetime.now(timezone.utc) - last).total_seconds() >= interval
    if not due:
        return

    recipients = [e.strip() for e in re.split(r"[\n,]+", ml["emails"] or "") if e.strip()]
    if not recipients:
        return  # keep items queued until the list has recipients

    parts = []
    if ml["header"]:
        parts.append(ml["header"])
    for p in pending:
        parts.append(f"— {p['subject']} —\n{p['body']}")
    if ml["footer"]:
        parts.append(ml["footer"])
    body = "\n\n".join(parts)
    n = len(pending)
    subject = f"{ml['name']}: {n} update{'s' if n != 1 else ''}"

    for to in recipients:
        _send_email(to, subject, body)

    db.execute("UPDATE mailing_queue SET sent_at = now() WHERE id = ANY(%s)",
               ([p["id"] for p in pending],))
    db.execute("UPDATE mailing_list SET last_sent_at = now() WHERE id = %s", (ml["id"],))
    print(f"[notify] mailing list '{ml['name']}' sent {n} items to {len(recipients)} recipients")


def flush_mailing_lists() -> None:
    """Scheduler tick: send any mailing list whose threshold or schedule is met."""
    try:
        lists = db.query("SELECT * FROM mailing_list")
    except Exception as exc:
        print(f"[notify] loading mailing_lists failed: {exc}")
        return
    for ml in lists:
        try:
            _maybe_send_list(ml)
        except Exception as exc:
            print(f"[notify] mailing list {ml.get('id')} send failed: {exc}")
