"""Self-check for the logic that decides things, run inside any agent image:

    docker compose exec escalation python selfcheck.py

Covers the two judgements that are easy to get quietly wrong: what counts as
a coding error leaking into output, and when a mailing list is actually due.
No DB, no network -- the module-level Postgres pool tolerates being unable to
connect, it only fails when a query is run, and nothing here runs one.
"""
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, "/app")

from agenda_shared import mailer                       # noqa: E402
from agenda_shared.notify import (  # noqa: E402
    _month_target_day, _schedule_due, ensure_unsubscribe,
)
try:
    # Escalation-only; the shared checks below still run in any other image.
    from agent_impl import looks_like_code_error       # noqa: E402
except ImportError:
    looks_like_code_error = None


def check_error_detection():
    if looks_like_code_error is None:
        print("selfcheck: skipping error detection (not the escalation image)")
        return
    # Things that are faults.
    for bad in (
        'Traceback (most recent call last):\n  File "app.py", line 3, in <module>\n    boom()',
        "NameError: name 'agenda_text' is not defined",
        "psycopg.errors.UndefinedTable: relation \"meeting\" does not exist",
        "TypeError: cannot unpack non-sequence",
        "```python\ndef extract(html):\n    return []\n```",
    ):
        assert looks_like_code_error(bad), f"missed a real error: {bad[:40]}"

    # Things that are just civic content, including the words that trip a
    # naive keyword filter.
    for good in (
        "Council approved the 2026 capital budget with a 3.2% increase.",
        "A public hearing on the active-transportation plan was scheduled.",
        "The bylaw corrects a type error in the zoning schedule appendix.",
        "Staff reported an exception was granted for the heritage facade.",
        "Council noted that the term 'accessory dwelling' is not defined in the bylaw.",
        "",
    ):
        assert not looks_like_code_error(good), f"false positive on: {good[:40]}"


def check_schedule():
    # A threshold list waits for the queue, whatever day it is.
    threshold = {"send_policy": "threshold", "threshold": 3}
    assert not _schedule_due(threshold, 2)
    assert _schedule_due(threshold, 3)

    today = datetime.now(timezone.utc)
    weekly = {"send_policy": "weekly", "weekday": today.weekday(), "last_sent_at": None}
    assert _schedule_due(weekly, 1), "weekly list should fire on its weekday"

    other_day = {"send_policy": "weekly", "weekday": (today.weekday() + 1) % 7, "last_sent_at": None}
    assert not _schedule_due(other_day, 99), "weekly list must not fire on the wrong day"

    # Already sent today: no second send, however much is queued.
    sent_today = {**weekly, "last_sent_at": today - timedelta(minutes=5)}
    assert not _schedule_due(sent_today, 99)

    # A naive last_sent_at (what psycopg hands back for TIMESTAMP) must not
    # blow up the aware/naive comparison.
    naive = {**weekly, "last_sent_at": (today - timedelta(days=8)).replace(tzinfo=None)}
    assert _schedule_due(naive, 1)

    monthly = {"send_policy": "monthly", "month_day": str(today.day) if 2 <= today.day <= 28 else "first",
               "last_sent_at": None}
    expected = today.day == _month_target_day(monthly["month_day"], today.date())
    assert _schedule_due(monthly, 1) == expected

    assert _month_target_day("first", datetime(2026, 2, 15).date()) == 1
    assert _month_target_day("last", datetime(2026, 2, 15).date()) == 28   # non-leap
    assert _month_target_day("last", datetime(2028, 2, 15).date()) == 29   # leap
    assert _month_target_day("17", datetime(2026, 2, 15).date()) == 17
    assert _month_target_day("nonsense", datetime(2026, 2, 15).date()) == 1


def check_unsubscribe_guarantee():
    url = "https://agenda.delivery/unsubscribe/abc-123"

    # A template that already opts out is left exactly as it is.
    already = f'<html><body>hi <a href="{url}">Unsubscribe</a></body></html>'
    assert ensure_unsubscribe(already, url) == already

    # One that does not gets a footer injected inside <body>, not after </html>.
    bare = "<html><body><p>news</p></body></html>"
    fixed = ensure_unsubscribe(bare, url)
    assert url in fixed, "unsubscribe link was not added"
    assert fixed.index(url) < fixed.index("</body>"), "footer landed outside <body>"

    # A fragment with no <body> still gets the link appended.
    frag = "<div>news</div>"
    assert url in ensure_unsubscribe(frag, url)


def check_empty_image_stripping():
    with_logo = '<body><img src="{{logo_url}}" alt="x" />{{content}}</body>'
    assert "<img" not in mailer.render(with_logo, {"logo_url": "", "content": "hi"})
    kept = mailer.render(with_logo, {"logo_url": "https://x.test/l.png", "content": "hi"})
    assert 'src="https://x.test/l.png"' in kept
    two = '<img src="" /><img src="https://x.test/a.png" />{{content}}'
    assert mailer.render(two, {"content": "hi"}).count("<img") == 1


def check_unsubscribe_headers():
    url = "https://agenda.delivery/api/unsubscribe/abc"
    h = mailer._unsubscribe_headers(url)
    # The angle brackets and the One-Click post are both load-bearing: without
    # either, Gmail treats it as a plain link and shows no native button.
    assert h["List-Unsubscribe"] == f"<{url}>", h
    assert h["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click", h
    assert mailer._unsubscribe_headers(None) == {}

    msg = mailer._build({"provider": "default"}, "a@b.test", "s", "<p>h</p>", "h", url)
    assert msg["List-Unsubscribe"] == f"<{url}>"
    assert msg["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"


def check_render():
    out = mailer.render("<p>{{greeting}} {{ name }}</p>", {"greeting": "Hi", "name": "Sam"})
    assert out == "<p>Hi Sam</p>", out
    # An unknown key becomes a gap, never a literal {{brace}} in someone's inbox.
    assert mailer.render("a{{nope}}b", {}) == "ab"
    assert mailer.escape('<b>&"') == "&lt;b&gt;&amp;&quot;"
    assert "Hello" in mailer.to_plain_text("<div>Hello</div><script>bad()</script>")
    assert "bad()" not in mailer.to_plain_text("<div>Hello</div><script>bad()</script>")


if __name__ == "__main__":
    check_error_detection()
    check_schedule()
    check_unsubscribe_guarantee()
    check_unsubscribe_headers()
    check_empty_image_stripping()
    check_render()
    print("selfcheck: all checks passed")
