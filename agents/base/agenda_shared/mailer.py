"""Outbound email: the default Postfix relay, SendGrid, or a user's own SMTP.

notify.py used to talk to smtplib directly with one hard-coded relay. A
mailing list now carries its owner's sender_settings row, so the sending leg
has to pick a provider per send. Everything here is best-effort: a bad
SendGrid key or an unreachable SMTP host returns False, it never raises into
the pipeline that triggered the send.

The template side lives here too so the sender and the account UI agree on
what {{placeholder}} means.
"""

import html as html_mod
import re
import smtplib
from email.message import EmailMessage

import requests

from . import db, settings

SENDGRID_URL = "https://api.sendgrid.com/v3/mail/send"

# Template placeholders the app always supplies. Users add their own in
# Sending Settings; those arrive as merge_field rows. Keep this list in sync
# with BUILTIN_FIELDS in src/lib/mail-fields.ts.
BUILTIN_FIELD_KEYS = (
    "organization_name", "logo_url", "list_name", "subject", "header",
    "content", "footer", "date", "subscriber_name", "subscriber_email",
    "unsubscribe_url",
)

_PLACEHOLDER = re.compile(r"\{\{\s*([a-zA-Z0-9_]+)\s*\}\}")


def render(template_html: str, values: dict) -> str:
    """Substitute {{key}} placeholders. Unknown keys collapse to empty so a
    half-filled template degrades to a gap, never to literal braces."""
    return _PLACEHOLDER.sub(lambda m: str(values.get(m.group(1), "") or ""), template_html)


def to_plain_text(html_str: str) -> str:
    """Crude HTML -> text for the multipart alternative. Good enough for a
    fallback part; the HTML body is what people actually see."""
    text = re.sub(r"(?is)<(script|style).*?</\1>", "", html_str)
    text = re.sub(r"(?i)<br\s*/?>|</p>|</div>|</tr>", "\n", text)
    text = re.sub(r"(?s)<[^>]+>", "", text)
    text = html_mod.unescape(text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def escape(value: str) -> str:
    return html_mod.escape(value or "", quote=True)


def sender_settings(user_id: str | None) -> dict:
    """The account's sending config, or the platform default."""
    default = {
        "provider": "default",
        "from_email": "",
        "from_name": "",
        "sendgrid_key": None,
        "smtp_host": None,
        "smtp_port": 587,
        "smtp_user": None,
        "smtp_pass": None,
        "smtp_secure": True,
    }
    if not user_id:
        return default
    try:
        row = db.one("SELECT * FROM sender_settings WHERE user_id = %s", (user_id,))
    except Exception as exc:
        print(f"[mailer] loading sender_settings failed: {exc}")
        return default
    return {**default, **(row or {})}


def from_header(cfg: dict) -> str:
    """The From: this config should send as. The default provider is locked to
    the platform address -- our Postfix will only DKIM-sign our own domain."""
    if cfg.get("provider") == "default" or not cfg.get("from_email"):
        return settings.MAIL_FROM
    name = (cfg.get("from_name") or "").strip()
    addr = cfg["from_email"].strip()
    return f"{name} <{addr}>" if name else addr


def send(cfg: dict, to: str, subject: str, html_body: str,
         text_body: str | None = None) -> bool:
    """Send one message with whichever provider `cfg` selects."""
    text_body = text_body or to_plain_text(html_body)
    provider = cfg.get("provider") or "default"
    try:
        if provider == "sendgrid":
            return _send_sendgrid(cfg, to, subject, html_body, text_body)
        if provider == "smtp":
            return _send_smtp(cfg, to, subject, html_body, text_body)
        return _send_relay(cfg, to, subject, html_body, text_body)
    except Exception as exc:
        print(f"[mailer] send to {to} via {provider} failed: {exc}")
        return False


def send_plain(to: str, subject: str, body: str) -> bool:
    """Platform-relay plain-text send (subscriber alerts, escalation mail)."""
    if not settings.SMTP_HOST:
        print("[mailer] SMTP_HOST unset; skipping email leg")
        return False
    msg = EmailMessage()
    msg["From"] = settings.MAIL_FROM
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)
    try:
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as s:
            s.send_message(msg)
        return True
    except Exception as exc:
        print(f"[mailer] email to {to} failed: {exc}")
        return False


def _build(cfg: dict, to: str, subject: str, html_body: str, text_body: str) -> EmailMessage:
    msg = EmailMessage()
    msg["From"] = from_header(cfg)
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(text_body)
    msg.add_alternative(html_body, subtype="html")
    return msg


def _send_relay(cfg: dict, to: str, subject: str, html_body: str, text_body: str) -> bool:
    if not settings.SMTP_HOST:
        print("[mailer] SMTP_HOST unset; skipping email leg")
        return False
    msg = _build(cfg, to, subject, html_body, text_body)
    with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=15) as s:
        s.send_message(msg)
    return True


def _send_smtp(cfg: dict, to: str, subject: str, html_body: str, text_body: str) -> bool:
    host = cfg.get("smtp_host")
    if not host:
        print("[mailer] smtp provider selected but no host configured")
        return False
    port = int(cfg.get("smtp_port") or 587)
    msg = _build(cfg, to, subject, html_body, text_body)
    # Port 465 is implicit TLS; everything else negotiates STARTTLS when the
    # account asked for a secure connection.
    if port == 465:
        with smtplib.SMTP_SSL(host, port, timeout=20) as s:
            if cfg.get("smtp_user"):
                s.login(cfg["smtp_user"], cfg.get("smtp_pass") or "")
            s.send_message(msg)
        return True
    with smtplib.SMTP(host, port, timeout=20) as s:
        if cfg.get("smtp_secure", True):
            s.starttls()
        if cfg.get("smtp_user"):
            s.login(cfg["smtp_user"], cfg.get("smtp_pass") or "")
        s.send_message(msg)
    return True


def _send_sendgrid(cfg: dict, to: str, subject: str, html_body: str, text_body: str) -> bool:
    key = cfg.get("sendgrid_key")
    if not key:
        print("[mailer] sendgrid provider selected but no API key configured")
        return False
    sender = {"email": (cfg.get("from_email") or "update@agenda.delivery").strip()}
    if cfg.get("from_name"):
        sender["name"] = cfg["from_name"]
    res = requests.post(
        SENDGRID_URL,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        json={
            "personalizations": [{"to": [{"email": to}]}],
            "from": sender,
            "subject": subject,
            "content": [
                {"type": "text/plain", "value": text_body},
                {"type": "text/html", "value": html_body},
            ],
        },
        timeout=20,
    )
    if res.status_code >= 300:
        print(f"[mailer] sendgrid returned {res.status_code}: {res.text[:200]}")
        return False
    return True
