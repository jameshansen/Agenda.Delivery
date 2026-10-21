"""Self-check for the logic that decides things, run inside any agent image:

    docker compose exec escalation python selfcheck.py

Covers the judgements that are easy to get quietly wrong: what counts as a
coding error leaking into output, when a mailing list is actually due, and
whether a module's listing is a page of meetings rather than one document.
No DB, no network -- the module-level Postgres pool tolerates being unable to
connect, it only fails when a query is run, and nothing here runs one.
"""
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, "/app")

from agenda_shared import mailer, tools                # noqa: E402
from agenda_shared.textutil import (  # noqa: E402
    date_from_title, is_link_wording, names_no_meeting, tidy_title,
)
from agenda_shared.notify import (  # noqa: E402
    _month_target_day, _schedule_due, agenda_email, ensure_unsubscribe,
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
    # Postfix adds neither for mail from the Docker network.
    assert msg["Date"] and msg["Message-ID"].endswith("@agenda.delivery>"), msg["Message-ID"]


def check_render():
    out = mailer.render("<p>{{greeting}} {{ name }}</p>", {"greeting": "Hi", "name": "Sam"})
    assert out == "<p>Hi Sam</p>", out
    # An unknown key becomes a gap, never a literal {{brace}} in someone's inbox.
    assert mailer.render("a{{nope}}b", {}) == "ab"
    assert mailer.escape('<b>&"') == "&lt;b&gt;&amp;&quot;"
    assert "Hello" in mailer.to_plain_text("<div>Hello</div><script>bad()</script>")
    assert "bad()" not in mailer.to_plain_text("<div>Hello</div><script>bad()</script>")


def check_agenda_email():
    ctx = {"module_name": "Test Council", "module_slug": "test-council",
           "meeting_title": "Public Hearing <draft>"}
    meeting = {"date": datetime(2026, 10, 20), "pdf_url": "https://x.test/a.pdf"}
    html, text = agenda_email(ctx, "Council **approved** it.\n\n- one\n- two", "summary",
                              meeting, [{"tag": "Housing", "text": "38 units & a park"}])
    # Escaped once, markdown turned into its HTML look, date added to a title without one.
    assert "Public Hearing &lt;draft&gt; · October 20, 2026" in html, html
    assert "<strong>approved</strong>" in html and "&bull;&nbsp;one" in html
    assert "38 units &amp; a park" in html and 'href="https://x.test/a.pdf"' in html
    assert "Read the agenda: https://x.test/a.pdf" in text and "<" not in text.replace("<draft>", "")
    # Link mode shows the buttons, not the bare URL; no PDF means no agenda button.
    html, text = agenda_email(ctx, "https://agenda.delivery/module/test-council", "link", None, [])
    assert "posted a new agenda." in html and "Read the agenda" not in html
    assert "Highlights" not in html


def check_listing_never_a_document():
    # What the test council's first run saved as both agenda_url and
    # source_url, and the page that actually lists its meetings.
    pdf = "https://testcouncil.agenda.delivery/meetings/3/2026-10-13-regular-council-agenda.pdf"
    page = "https://testcouncil.agenda.delivery/meetings"
    assert tools.is_document(pdf)
    assert tools.is_document(pdf.replace(".pdf", ".PDF?download=1"))
    assert not tools.is_document(page) and not tools.is_document(None)

    assert tools.listing_url({"agenda_url": pdf}, {"source_url": page}) == page
    assert tools.listing_url({"agenda_url": page}, {"source_url": pdf}) == page
    assert tools.listing_url(None, {"source_url": page}) == page
    root = tools.listing_url({"agenda_url": pdf}, {"source_url": pdf})
    assert root == "https://testcouncil.agenda.delivery/", root

    # Scripts that return a meeting written into them, as six councils' did on
    # prod, and one that reads its listing.
    escribe = "https://pub-coquitlam.escribemeetings.com/Meeting.aspx?Id=22594b69-5567-4e1b-99b6-633e33e9c1b6&Agenda=Agenda"
    found = {"data": {"meetingUrl": escribe, "pdfLinks": []}}
    assert tools.pins_its_result(f"def extract():\n    url = '{escribe}'\n", found)
    assert tools.pins_its_result("def extract():\n    mid = '22594b69-5567-4e1b-99b6-633e33e9c1b6'\n", found)
    assert tools.pins_its_result("def extract():\n    doc = 6752148\n",
                                 {"data": {"meetingUrl": "https://app.dnv.org/OpenDocument/Default.aspx?docNum=6752148"}})
    assert not tools.pins_its_result(
        "def extract():\n    html = _get('https://pub-coquitlam.escribemeetings.com/').text\n", found)

    # The extract script that run saved, and one that finds the newest meeting.
    assert tools.pins_a_document(f"def extract():\n    listing = '{pdf}'\n")
    assert not tools.pins_a_document(
        f"def extract():\n    html = _get('{page}').text\n"
        f"    return [u for u in _find_pdfs(html, '{page}') if re.search(r'\\.pdf$', u)]\n")


def check_public_host():
    # Docker service names resolve to 172.x inside the network; literals and
    # metadata addresses stand in for them here, offline.
    for internal in ("127.0.0.1", "localhost", "10.0.0.5", "172.18.0.4", "192.168.1.1",
                     "169.254.169.254", "::1", "", "no-such-host.invalid"):
        assert not mailer.public_host(internal), internal
    assert mailer.public_host("8.8.8.8") and mailer.public_host("2606:4700::1111")


def check_date_from_title():
    from datetime import date
    # Real titles from prod: New Westminster's was recorded under three
    # invented dates before the title's own date was used.
    assert date_from_title("Share Council Meeting Monday, October 05, 2026 @ 6:00 PM") == date(2026, 10, 5)
    assert date_from_title("Council Thursday, 11 June 2026 @ 6:30 PM") == date(2026, 6, 11)
    assert date_from_title("Regular Meeting (1:30 PM) and Public Hearing (7:00 PM) - 01 Sep 2026") == date(2026, 9, 1)
    assert date_from_title("Regular Council Agenda 2026-10-13") == date(2026, 10, 13)
    assert date_from_title("Sept. 8, 2026 Regular Meeting") == date(2026, 9, 8)
    # No date, or not a real one: nothing, rather than a guess.
    for none in ("Regular Council Meeting", "Bylaw 2026-45", "February 30, 2026", ""):
        assert date_from_title(none) is None, none


def check_meeting_titles():
    # Recorded on prod as meetings, again on every check: none is one meeting.
    for listing in ("Skip to main content", "Council Meeting Agendas", "2026 Council Meeting Schedule",
                    "Council meetings, agendas, minutes, and webcasts",
                    "2026 Council Meetings, Public Hearings, Committee-of-the-Whole Calendar"):
        assert names_no_meeting(listing), listing
    # One meeting each, including a listing-like word next to a real date.
    for meeting in ("REGULAR COUNCIL MEETING", "Council Meeting October 05, 2026 Agenda",
                    "Agenda Only", "HTML", "Public Hearing Meetings - September 1, 2026",
                    "Agenda PDF - Council Meetings", "Council Meetings - Agenda PDF"):
        assert not names_no_meeting(meeting), meeting
    # Format-link wording names no meeting, though the find was real.
    for wording in ("HTML", "Agenda Only", "Agenda PDF", "Council", "Agenda (Merged)",
                    "Council Meetings Agenda PDF", ""):
        assert is_link_wording(wording), wording
    for named in ("REGULAR COUNCIL MEETING", "Public Hearing", "Committee of the Whole"):
        assert not is_link_wording(named), named


def check_tidy_title():
    # What the test council's listing turned into an email subject.
    assert tidy_title("Agenda (PDF) - Regular Council Meeting, Wednesday, October 21, 2026")         == "Regular Council Meeting, Wednesday, October 21, 2026"
    assert tidy_title("Public Hearing Agenda (245 KB)") == "Public Hearing Agenda"
    assert tidy_title("Agenda: Special Council Meeting") == "Special Council Meeting"
    assert tidy_title("Regular Council Meeting - July 20, 2026 - Agenda (HTML)") \
        == "Regular Council Meeting - July 20, 2026"
    assert tidy_title("Agenda – Regular Meeting (1:30 PM) and Public Hearing (7:00 PM)") \
        == "Regular Meeting (1:30 PM) and Public Hearing (7:00 PM)"
    for kept in ("Regular Council Meeting", "Agenda (PDF)", "Agenda", "Minutes - Council"):
        assert tidy_title(kept) in (kept, "Agenda"), kept


if __name__ == "__main__":
    check_listing_never_a_document()
    check_tidy_title()
    check_meeting_titles()
    check_date_from_title()
    check_public_host()
    check_error_detection()
    check_schedule()
    check_unsubscribe_guarantee()
    check_unsubscribe_headers()
    check_empty_image_stripping()
    check_render()
    check_agenda_email()
    print("selfcheck: all checks passed")
