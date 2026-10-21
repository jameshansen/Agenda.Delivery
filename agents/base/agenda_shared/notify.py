"""Notification dispatch pipeline.

Called from orchestrator/flows.py after a checking run finds a new meeting.
Following a council sends nothing by itself; delivery is rule-driven:
  - run_automation_rules: the Subscriptions → Artifacts → Actions flowchart —
    per-rule content (summary / link / full text / custom-prompt / keyword
    artifact) emailed, sent to a script or a Discord hook, or queued to a
    mailing list.

Mailing lists are drained separately by flush_mailing_lists (scheduler tick).

Every function here is resilient by design -- a bad webhook or a stuck LLM
call must never take down the pipeline that triggers it, so failures are
logged and swallowed, never raised.
"""

import calendar
import re
import threading
import time
from datetime import date, datetime, timedelta, timezone
from urllib.parse import urlparse

import requests

from . import db, llm, mailer, settings

AGENDA_CHAR_CAP = 8000


def _post_json(url: str, body: dict, headers: dict | None = None) -> None:
    """POST to a user's Discord or script target. Public http(s) addresses
    only, and no redirects, which could point back inside the network."""
    parts = urlparse(url)
    if parts.scheme not in ("http", "https") or not mailer.public_host(parts.hostname or ""):
        print(f"[notify] refusing to post to {url}: not a public http(s) address")
        return

    def post() -> None:
        try:
            requests.post(url, json=body, headers=headers, timeout=10, allow_redirects=False)
        except Exception as exc:
            print(f"[notify] post to {url} failed: {exc}")

    # The timeout above is per read, so a target that trickles its reply never
    # trips it, and deliveries run on the orchestrator's only worker thread.
    # Give up waiting after 15s; the daemon thread dies with its socket.
    sender = threading.Thread(target=post, daemon=True)
    sender.start()
    sender.join(15)


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


def _rule_content(rule: dict, ctx: dict) -> tuple[str, bool]:
    """(what a rule delivers, whether its artifact wrote it). An artifact the
    model cannot write falls back to the rule's summary, link or full-text
    content: a rate-limited artifact used to drop the delivery altogether.
    A rate limit gets one retry first."""
    if rule.get("artifact_id"):
        art = db.one(
            "SELECT kind, prompt_text, keywords FROM automation_artifact WHERE id = %s",
            (rule["artifact_id"],),
        )
        for attempt in range(2) if art else ():
            try:
                out = _artifact_content(art, ctx["agenda_text"])
                if out:
                    return out, True
                break
            except Exception as exc:
                print(f"[notify] artifact {rule['artifact_id']} failed: {exc}")
                if "OLLAMA_RATE_LIMITED" not in str(exc) or attempt:
                    break
                time.sleep(30)
    mode = rule.get("content_mode") or "summary"
    if mode == "link":
        return f"{settings.BASE_URL}/module/{ctx['module_slug']}", False
    if mode == "full_text":
        return ctx["agenda_text"][:AGENDA_CHAR_CAP], False
    return ctx.get("summary") or ctx["meeting_title"], False


def _paragraphs(text: str) -> str:
    """Summary, agenda or model text as email paragraphs. Model output leans on
    markdown, which no mail client renders, so headings, bold and list dashes
    are turned into their HTML look."""
    out = []
    for para in re.split(r"\n\s*\n", (text or "").strip()):
        safe = mailer.escape(para)
        safe = re.sub(r"(?m)^#{1,6}\s*", "", safe)
        safe = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", safe)
        safe = re.sub(r"(?m)^\s*[-*•]\s+", "&bull;&nbsp;", safe)
        out.append(f'<p style="margin:0 0 14px 0;">{safe.replace(chr(10), "<br />")}</p>')
    return "".join(out)


def agenda_email(ctx: dict, content: str, mode: str, meeting: dict | None,
                 highlights: list[dict]) -> tuple[str, str]:
    """The "Send to my email" notification as (html, text). `mode` is the
    rule's content mode, or "artifact" when an artifact wrote `content`."""
    e = mailer.escape
    module_url = f"{settings.BASE_URL}/module/{ctx['module_slug']}"
    agenda_url = (meeting or {}).get("pdf_url") or (meeting or {}).get("meeting_url")
    title = ctx["meeting_title"]
    when = (meeting or {}).get("date")
    if when and str(when.year) not in title:
        title += f" · {calendar.month_name[when.month]} {when.day}, {when.year}"
    lead = f"{ctx['module_name']} posted a new agenda."

    body = (f'<p style="margin:0 0 14px 0;">{e(lead)}</p>' if mode == "link"
            else _paragraphs(content))
    if mode == "summary" and highlights:
        rows = "".join(
            '<tr><td style="padding:6px 0;vertical-align:top;white-space:nowrap;">'
            '<span style="display:inline-block;background:#e9edc9;color:#3d5e2b;'
            'border-radius:999px;padding:2px 10px;font:12px Arial,sans-serif;">'
            f'{e(h["tag"])}</span></td>'
            '<td style="padding:6px 0 6px 10px;font-size:15px;line-height:1.5;">'
            f'{e(h["text"])}</td></tr>'
            for h in highlights)
        body += ('<div style="margin:22px 0 6px 0;font:bold 12px Arial,sans-serif;'
                 'letter-spacing:0.08em;text-transform:uppercase;color:#6f6c60;">Highlights</div>'
                 f'<table role="presentation" cellpadding="0" cellspacing="0">{rows}</table>')

    button = ("display:inline-block;margin:0 8px 8px 0;padding:11px 22px;border-radius:999px;"
              "border:1px solid #3d5e2b;font:bold 14px Arial,sans-serif;text-decoration:none;")
    buttons = (f'<a href="{e(agenda_url)}" style="{button}background:#3d5e2b;color:#ffffff;">'
               "Read the agenda</a>" if agenda_url else "")
    buttons += f'<a href="{e(module_url)}" style="{button}color:#3d5e2b;">See it on agenda.delivery</a>'
    preview = re.sub(r"\s+", " ", lead if mode == "link" else content).strip()[:140]

    html = f"""<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f1e8;">
<div style="display:none;max-height:0;overflow:hidden;">{e(preview)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1e8;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">
<tr><td style="padding:0 4px 14px 4px;font-family:Georgia,'Times New Roman',serif;font-size:22px;">
<a href="{settings.BASE_URL}" style="text-decoration:none;"><span style="color:#3d5e2b;">agenda</span><span style="color:#4f8a2f;">.delivery</span></a>
</td></tr>
<tr><td style="background:#ffffff;border:1px solid #e4e0d2;border-radius:14px;padding:28px;font-family:Georgia,'Times New Roman',serif;color:#1c1b16;font-size:16px;line-height:1.6;">
<div style="font:bold 12px Arial,sans-serif;letter-spacing:0.08em;text-transform:uppercase;color:#a85d1a;">New agenda</div>
<h1 style="margin:6px 0 4px 0;font-size:26px;line-height:1.25;font-weight:normal;color:#1c1b16;">{e(ctx["module_name"])}</h1>
<div style="margin:0 0 20px 0;font:14px/1.5 Arial,sans-serif;color:#6f6c60;">{e(title)}</div>
{body}
<div style="margin-top:22px;">{buttons}</div>
</td></tr>
<tr><td style="padding:16px 4px;font:12px/1.5 Arial,sans-serif;color:#6f6c60;text-align:center;">
You get this email because of an action you set up on agenda.delivery for {e(ctx["module_name"])}.<br />
<a href="{settings.BASE_URL}/account" style="color:#4f8a2f;">Manage your actions</a>
</td></tr>
</table>
</td></tr>
</table>
</body></html>"""

    text = "\n\n".join(part for part in (
        f"{ctx['module_name']} posted a new agenda: {ctx['meeting_title']}",
        "" if mode == "link" else content,
        f"Read the agenda: {agenda_url}" if agenda_url else "",
        f"See it on agenda.delivery: {module_url}",
        f"You get this email because of an action you set up on agenda.delivery. "
        f"Manage your actions: {settings.BASE_URL}/account",
    ) if part)
    return html, text


def run_automation_rules(module_id: str, ctx: dict) -> None:
    """Evaluate the user-defined flowchart rules for this module and deliver."""
    try:
        rules = db.query("SELECT * FROM automation_rule WHERE module_id = %s", (module_id,))
    except Exception as exc:
        print(f"[notify] loading automation_rules failed: {exc}")
        return

    # What an email notification shows besides the rule's own content. The
    # highlights belong to the summary, so without one they'd be stale.
    meeting, highlights = None, []
    if any(r["action_kind"] == "email" for r in rules):
        try:
            meeting = db.one(
                "SELECT date, pdf_url, meeting_url FROM meeting WHERE module_id = %s "
                "ORDER BY date DESC LIMIT 1", (module_id,))
            highlights = db.query(
                "SELECT tag, text FROM highlight WHERE module_id = %s ORDER BY sort LIMIT 5",
                (module_id,)) if ctx.get("summary") else []
        except Exception as exc:
            print(f"[notify] loading email extras failed: {exc}")

    for rule in rules:
        try:
            content, from_artifact = _rule_content(rule, ctx)
        except Exception as exc:
            print(f"[notify] rule {rule['id']} content build failed: {exc}")
            continue

        # Keep the module page's keyword section fresh: store the latest output
        # of any keyword-artifact rule for this module.
        if from_artifact:
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
                    mode = "artifact" if from_artifact else rule.get("content_mode") or "summary"
                    html, text = agenda_email(ctx, content, mode, meeting, highlights)
                    mailer.send(mailer.sender_settings(None), urow["email"],
                                f"{ctx['module_name']}: {ctx['meeting_title']}", html, text)
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


# A host that fails this many recipients running is down: stop the round
# instead of waiting out a timeout per recipient on the scheduler thread.
FAILURES_IN_A_ROW = 3


def _owed(pending: list[dict], delivered: set, subscriber_id: str) -> list[dict]:
    """The queued items this subscriber has not been sent yet."""
    return [p for p in pending if (p["id"], subscriber_id) not in delivered]


def _maybe_send_list(ml: dict) -> None:
    pending = db.query(
        "SELECT id, subject, body, created_at FROM mailing_queue "
        "WHERE list_id = %s AND sent_at IS NULL ORDER BY created_at",
        (ml["id"],),
    )
    if not pending or not _schedule_due(ml, len(pending)):
        return

    recipients = _recipients(ml)
    if not recipients:
        return  # keep items queued until the list has somewhere to go

    # Who already has what: a retry after a partial send, or after a crash
    # mid-round, reaches only the subscribers who missed an item.
    delivered = {(r["queue_id"], r["subscriber_id"]) for r in db.query(
        "SELECT queue_id, subscriber_id FROM mailing_delivery WHERE queue_id = ANY(%s)",
        ([p["id"] for p in pending],))}

    cfg = mailer.sender_settings(ml.get("user_id"))
    template = _template_html(ml)
    account_fields = _account_fields(ml["user_id"])
    base = {
        **account_fields,
        "organization_name": account_fields.get("organization_name") or ml["name"],
        "list_name": ml["name"],
        "header": _as_html(ml.get("header")),
        "footer": _as_html(ml.get("footer")),
        "date": _today_label(),
    }

    sent = in_a_row = 0
    for sub in recipients:
        items = _owed(pending, delivered, sub["id"])
        if not items:
            continue
        n = len(items)
        subject = f"{ml['name']}: {n} update{'s' if n != 1 else ''}"
        per_sub = sub.get("fields") or {}
        values = {
            **base,
            **(per_sub if isinstance(per_sub, dict) else {}),
            "subject": subject,
            "content": _items_html(items),
            "subscriber_name": sub.get("name") or "",
            "subscriber_email": sub["email"],
            "unsubscribe_url": f"{settings.BASE_URL}/unsubscribe/{sub['id']}",
        }
        body = ensure_unsubscribe(mailer.render(template, values), values["unsubscribe_url"])
        # The header URI must accept a bare POST (RFC 8058), which the
        # human-facing page cannot -- hence the separate API route.
        one_click = f"{settings.BASE_URL}/api/unsubscribe/{sub['id']}"
        if mailer.send(cfg, sub["email"], subject, body, one_click_url=one_click):
            sent, in_a_row = sent + 1, 0
            ids = [p["id"] for p in items]
            db.execute(
                "INSERT INTO mailing_delivery (queue_id, subscriber_id) "
                "SELECT unnest(%s::text[]), %s ON CONFLICT DO NOTHING", (ids, sub["id"]))
            delivered.update((i, sub["id"]) for i in ids)
        else:
            in_a_row += 1
            if in_a_row >= FAILURES_IN_A_ROW:
                print(f"[notify] mailing list '{ml['name']}': {in_a_row} sends failed running; "
                      "stopping this round")
                break

    if sent:
        db.execute("UPDATE mailing_list SET last_sent_at = now() WHERE id = %s", (ml["id"],))
    # An item is done once every recipient has it. One a recipient still
    # lacks after a day is given up on, rather than retried every minute.
    day_ago = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=1)
    done = [p["id"] for p in pending
            if not any(_owed([p], delivered, s["id"]) for s in recipients) or p["created_at"] < day_ago]
    if done:
        db.execute("UPDATE mailing_queue SET sent_at = now() WHERE id = ANY(%s)", (done,))
    print(f"[notify] mailing list '{ml['name']}': sent to {sent} recipient(s); "
          f"{len(done)} of {len(pending)} item(s) done")


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
