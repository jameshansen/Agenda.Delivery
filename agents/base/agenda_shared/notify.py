"""Notification dispatch pipeline: subscribers, custom prompts, keyword pushes.

Called from orchestrator/flows.py after a checking run finds a new meeting.
Every function here is resilient by design -- a bad webhook or a stuck LLM
call must never take down the summary/keyword/categorization fan-out that
triggers it, so failures are logged and swallowed, never raised.
"""

import requests

from . import db, llm, settings

SUPRSEND_EVENT_URL = "https://hub.suprsend.com/event/"
AGENDA_CHAR_CAP = 8000


def _post_json(url: str, body: dict, headers: dict | None = None) -> None:
    try:
        requests.post(url, json=body, headers=headers, timeout=10)
    except Exception as exc:
        print(f"[notify] post to {url} failed: {exc}")


def _send_suprsend(contact: str, channel: str, properties: dict) -> None:
    if not settings.SUPRSEND_API_KEY:
        print("[notify] SUPRSEND_API_KEY unset; skipping email/SMS leg")
        return
    body = {
        "distinct_id": f"sub:{contact}",
        "event": "agenda_updated",
        "properties": {"channel": channel, **properties},
    }
    _post_json(SUPRSEND_EVENT_URL, body, {"Authorization": f"Bearer {settings.SUPRSEND_API_KEY}"})


def notify_subscribers(module_id: str, module_name: str, module_slug: str, meeting_title: str) -> None:
    """Email/SMS subscribers via SuprSend and push to per-user Discord/webhook targets."""
    try:
        subs = db.query(
            "SELECT user_id, channel, contact FROM subscription WHERE module_id = %s",
            (module_id,),
        )
    except Exception as exc:
        print(f"[notify] loading subscriptions failed: {exc}")
        return

    properties = {
        "module_id": module_id,
        "module_name": module_name,
        "module_slug": module_slug,
        "meeting_title": meeting_title,
    }

    user_ids = {s["user_id"] for s in subs if s["user_id"] is not None}
    for sub in subs:
        if sub["channel"] in ("email", "text"):
            _send_suprsend(sub["contact"], sub["channel"], properties)

    # Per-user push targets fire once per user, for every module they're
    # subscribed to that just updated -- not once per subscription row.
    for user_id in user_ids:
        try:
            targets = db.query("SELECT kind, url FROM push_target WHERE user_id = %s", (user_id,))
        except Exception as exc:
            print(f"[notify] push_target load for user {user_id} failed: {exc}")
            continue
        for target in targets:
            if target["kind"] == "discord":
                # ponytail: plain content string, not a rich embed; upgrade path is
                # {"embeds": [...]} with structured fields if it ever needs to look nicer.
                content = f"New agenda for **{module_name}**: {meeting_title}"
                _post_json(target["url"], {"content": content})
            else:  # "webhook" -- generic JSON body, our own shape
                _post_json(target["url"], {"event": "agenda_updated", **properties})


def run_custom_prompts_for_module(module_id: str, agenda_text: str) -> None:
    """Run each subscribed user's custom_prompt against the new agenda and POST the result."""
    try:
        prompts = db.query(
            """SELECT cp.id, cp.prompt_text, cp.push_url
               FROM custom_prompt cp
               JOIN subscription s ON s.user_id = cp.user_id
               WHERE s.module_id = %s AND cp.push_url IS NOT NULL""",
            (module_id,),
        )
    except Exception as exc:
        print(f"[notify] loading custom_prompts failed: {exc}")
        return

    snippet = agenda_text[:AGENDA_CHAR_CAP]
    for prompt in prompts:
        try:
            result = llm.complete(
                "You are a helpful civic-agenda assistant. Follow the user's instruction precisely.",
                f"{prompt['prompt_text']}\n\n---\nAgenda:\n{snippet}",
            )
        except Exception as exc:
            print(f"[notify] custom_prompt {prompt['id']} LLM call failed: {exc}")
            continue
        _post_json(prompt["push_url"], {"result": result, "module_id": module_id})


def run_keyword_pushes_for_module(module_id: str, agenda_text: str) -> None:
    """Regenerate keyword summaries for this module's new agenda and push to followers."""
    try:
        keywords = db.query("SELECT id, keyword FROM keyword WHERE module_id = %s", (module_id,))
    except Exception as exc:
        print(f"[notify] loading keywords failed: {exc}")
        return

    snippet = agenda_text[:AGENDA_CHAR_CAP]
    for kw in keywords:
        try:
            new_summary = llm.complete(
                "You summarize civic agendas for keyword monitoring.",
                f"Keyword: {kw['keyword']}\n\nAgenda:\n{snippet}\n\n"
                "Summarize how this keyword's topic appears, if at all, in the above agenda.",
            )
        except Exception as exc:
            print(f"[notify] keyword {kw['id']} LLM call failed: {exc}")
            continue
        try:
            db.execute("UPDATE keyword SET summary = %s WHERE id = %s", (new_summary, kw["id"]))
        except Exception as exc:
            print(f"[notify] keyword {kw['id']} summary UPDATE failed: {exc}")
            continue
        try:
            follows = db.query(
                "SELECT push_url FROM keyword_follow WHERE keyword_id = %s AND push_url IS NOT NULL",
                (kw["id"],),
            )
        except Exception as exc:
            print(f"[notify] keyword_follow load for {kw['id']} failed: {exc}")
            continue
        for follow in follows:
            _post_json(follow["push_url"], {"keyword": kw["keyword"], "summary": new_summary, "module_id": module_id})
