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

import calendar
import re
from datetime import date, datetime, timezone

import requests

from . import db, llm, mailer, settings

AGENDA_CHAR_CAP = 8000


def _post_json(url: str, body: dict, headers: dict | None = None) -> None:
    try:
        requests.post(url, json=body, headers=headers, timeout=10)
    except Exception as exc:
        print(f"[notify] post to {url} failed: {exc}")


def _send_email(to: str, subject: str, body: str) -> None:
    """Relay through the host Postfix, which DKIM-signs and delivers."""
    mailer.send_plain(to, subject, body)


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


# ── Mailing lists ─────────────────────────────
DEFAULT_TEMPLATE_ID = "default-template-00000000000000000001"


def _month_target_day(policy_day: str, today: date) -> int:
    """Resolve 'first' | 'last' | '2'..'28' to a day number for this month."""
    if policy_day == "first":
        return 1
    if policy_day == "last":
        return calendar.monthrange(today.year, today.month)[1]
    try:
        return max(1, min(28, int(policy_day)))
    except (TypeError, ValueError):
        return 1


def _schedule_due(ml: dict, pending_count: int) -> bool:
    """Has this list hit its threshold, or is today its send day?

    Days are UTC, so "weekly on Monday" means UTC Monday -- which begins
    Sunday afternoon on the west coast. Give mailing_list a timezone column
    and convert here if that ever matters to someone.
    """
    policy = ml.get("send_policy") or "threshold"
    if policy == "threshold":
        return pending_count >= (ml.get("threshold") or 1)

    now = datetime.now(timezone.utc)
    today = now.date()
    last = ml.get("last_sent_at")
    if last is not None and last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    # One send per calendar day, whatever else happens on the tick.
    if last is not None and last.date() == today:
        return False

    if policy == "weekly":
        return today.weekday() == int(ml.get("weekday") or 0)
    if policy == "monthly":
        return today.day == _month_target_day(ml.get("month_day") or "first", today)
    # Unknown policy: an interval fallback rather than never sending.
    return last is None or (now - last).total_seconds() >= 604800


def _recipients(ml: dict) -> list[dict]:
    """Active subscribers this list sends to: the whole account book, or
    just the ones picked for this list."""
    if (ml.get("audience") or "all") == "all":
        return db.query(
            "SELECT id, email, name, fields FROM subscriber "
            "WHERE user_id = %s AND status = 'active' ORDER BY created_at",
            (ml["user_id"],),
        )
    return db.query(
        """SELECT s.id, s.email, s.name, s.fields FROM subscriber s
             JOIN mailing_list_subscriber mls ON mls.subscriber_id = s.id
            WHERE mls.list_id = %s AND s.status = 'active'
            ORDER BY s.created_at""",
        (ml["id"],),
    )


def _template_html(ml: dict) -> str:
    row = None
    if ml.get("template_id"):
        row = db.one("SELECT html FROM email_template WHERE id = %s", (ml["template_id"],))
    if not row:
        row = db.one("SELECT html FROM email_template WHERE id = %s", (DEFAULT_TEMPLATE_ID,))
    # Last resort if the default row was never seeded: the content alone.
    return row["html"] if row else "{{content}}"


def _account_fields(user_id: str) -> dict:
    try:
        rows = db.query("SELECT key, value FROM merge_field WHERE user_id = %s", (user_id,))
    except Exception as exc:
        print(f"[notify] loading merge_fields failed: {exc}")
        return {}
    return {r["key"]: r["value"] for r in rows}


def _as_html(text: str | None) -> str:
    """User-typed header/footer into a safe HTML fragment."""
    return mailer.escape(text or "").replace("\n", "<br />")


def _today_label() -> str:
    d = datetime.now(timezone.utc)
    return f"{calendar.month_name[d.month]} {d.day}, {d.year}"


def ensure_unsubscribe(html: str, url: str) -> str:
    """Never let a message leave without a way out.

    Templates are validated on save, but validation only binds the rows that
    went through it -- a template saved before the rule, or edited straight in
    the database, would otherwise produce mail nobody can escape. So the
    guarantee lives here, at the last point before sending, rather than
    upstream where it can be bypassed.
    """
    if url and url in html:
        return html
    footer = (
        '<div style="margin:24px 0 0 0;padding:16px;text-align:center;'
        'font-family:Arial,sans-serif;font-size:12px;color:#6f6c60;">'
        f'<a href="{url}" style="color:#4f8a2f;">Unsubscribe from these emails</a>'
        "</div>"
    )
    lower = html.lower()
    idx = lower.rfind("</body>")
    return html[:idx] + footer + html[idx:] if idx != -1 else html + footer


def _items_html(pending: list[dict]) -> str:
    """The queued updates as the {{content}} block."""
    blocks = []
    for p in pending:
        blocks.append(
            '<div style="margin:0 0 20px 0;">'
            f'<div style="font-weight:bold;margin-bottom:4px;">{mailer.escape(p["subject"])}</div>'
            f'<div style="white-space:pre-wrap;">{mailer.escape(p["body"])}</div>'
            "</div>"
        )
    return "".join(blocks)


def _maybe_send_list(ml: dict) -> None:
    pending = db.query(
        "SELECT id, subject, body FROM mailing_queue WHERE list_id = %s AND sent_at IS NULL ORDER BY created_at",
        (ml["id"],),
    )
    if not pending or not _schedule_due(ml, len(pending)):
        return

    recipients = _recipients(ml)
    if not recipients:
        return  # keep items queued until the list has somewhere to go

    cfg = mailer.sender_settings(ml.get("user_id"))
    template = _template_html(ml)
    account_fields = _account_fields(ml["user_id"])
    n = len(pending)
    subject = f"{ml['name']}: {n} update{'s' if n != 1 else ''}"

    base = {
        **account_fields,
        "organization_name": account_fields.get("organization_name") or ml["name"],
        "list_name": ml["name"],
        "subject": subject,
        "header": _as_html(ml.get("header")),
        "footer": _as_html(ml.get("footer")),
        "content": _items_html(pending),
        "date": _today_label(),
    }

    sent = 0
    for sub in recipients:
        per_sub = sub.get("fields") or {}
        values = {
            **base,
            **(per_sub if isinstance(per_sub, dict) else {}),
            "subscriber_name": sub.get("name") or "",
            "subscriber_email": sub["email"],
            "unsubscribe_url": f"{settings.BASE_URL}/unsubscribe/{sub['id']}",
        }
        body = ensure_unsubscribe(mailer.render(template, values), values["unsubscribe_url"])
        # The header URI must accept a bare POST (RFC 8058), which the
        # human-facing page cannot -- hence the separate API route.
        one_click = f"{settings.BASE_URL}/api/unsubscribe/{sub['id']}"
        if mailer.send(cfg, sub["email"], subject, body, one_click_url=one_click):
            sent += 1

    if sent == 0:
        print(f"[notify] mailing list '{ml['name']}' reached no one; leaving {n} items queued")
        return

    db.execute("UPDATE mailing_queue SET sent_at = now() WHERE id = ANY(%s)",
               ([p["id"] for p in pending],))
    db.execute("UPDATE mailing_list SET last_sent_at = now() WHERE id = %s", (ml["id"],))
    print(f"[notify] mailing list '{ml['name']}' sent {n} items to {sent} recipients")


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
