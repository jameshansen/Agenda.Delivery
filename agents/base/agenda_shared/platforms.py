"""Readers for the meeting portals councils publish on, eSCRIBE and PrimeGov.

Both serve their meeting calendar as public data: each meeting's name, its
real date and its agenda documents. The model-driven tiers in tools.py read
these portals badly. On eSCRIBE they recorded City of Langley's August 28
special meeting as October 19, and on PrimeGov they took Saanich's portal for
a login wall. Read here, a portal meeting is exact and needs no model call.
"""
import re
from datetime import date, timedelta
from html import unescape
from urllib.parse import urljoin

import requests

from . import db
from .textutil import is_not_an_agenda
from .tools import USER_AGENT, _browser_document, _document_text, _get, _html_to_text, listing_url

_PORTAL = re.compile(r"https?://([a-z0-9-]+)\.(escribemeetings|primegov)\.com", re.I)
# Not a meeting the public can follow: its agenda is a motion to close it.
_SKIP = re.compile(r"\b(closed|cancell?ed|postponed)\b", re.I)
_OF_COUNCIL = re.compile(r"council|committee|hearing", re.I)
_NOT_REGULAR = re.compile(r"special|committee|hearing|workshop|inaugural|closed", re.I)
_SMALL_WORDS = re.compile(r"(?<=\s)(Of|The|And|For|To|In|On|At|A)\b")


def portal(url: str, html: str = ""):
    """(kind, base URL) of the eSCRIBE or PrimeGov portal a listing is on, or
    that its page links to; None when it is neither."""
    for text in (url or "", html or ""):
        m = _PORTAL.search(text)
        if m:
            host = m[2].lower()
            return ("escribe" if host == "escribemeetings" else host), f"https://{m[1].lower()}.{host}.com"
    return None


def _title(name: str) -> str:
    """'REGULAR COUNCIL MEETING' as 'Regular Council Meeting', and Nanaimo's
    "Mayor&#39;s Leaders&#39; Table" as "Mayor's Leaders' Table"."""
    name = re.sub(r"\s+", " ", unescape(name or "")).strip()
    return _SMALL_WORDS.sub(lambda m: m[0].lower(), name.title()) if name.isupper() else name


def escribe_meetings(base: str, start: date, end: date) -> list[dict]:
    s = requests.Session()
    s.headers["User-Agent"] = USER_AGENT
    s.get(f"{base}/", timeout=30)  # the calendar call answers [] without this visit's cookie
    res = s.post(f"{base}/MeetingsCalendarView.aspx/GetCalendarMeetings", timeout=30,
                 json={"calendarStartDate": start.isoformat(), "calendarEndDate": end.isoformat()})
    res.raise_for_status()
    out = []
    for m in res.json().get("d") or []:
        docs = m.get("MeetingDocumentLink") or []
        # "Agenda (PDF)", or Victoria's "Revised Agenda (PDF)" in its place;
        # never the cover page.
        agendas = sorted((d for d in docs if "agenda" in (d.get("Title") or "").lower()
                          and "cover" not in d["Title"].lower() and d.get("Url")),
                         key=lambda d: "revised" not in d["Title"].lower())
        html = next((d["Url"] for d in agendas if d.get("Format") == "HTML"), None)
        pdf = next((d["Url"] for d in agendas if d.get("Format") == ".pdf"), None)
        out.append({
            "title": _title(m.get("MeetingName")),
            "start": (m.get("StartDate") or "").replace("/", "-"),
            "url": urljoin(f"{base}/", html) if html else None,
            "pdf": urljoin(f"{base}/", pdf) if pdf else None,
            "docs": [urljoin(f"{base}/", d["Url"]) for d in docs if d.get("Url")],
        })
    return out


def primegov_meetings(base: str, start: date, end: date) -> list[dict]:
    paths = ["/api/v2/PublicPortal/ListUpcomingMeetings"] + [
        f"/api/v2/PublicPortal/ListArchivedMeetings?year={y}" for y in range(start.year, end.year + 1)]
    out = []
    for path in paths:
        res = requests.get(base + path, headers={"User-Agent": USER_AGENT}, timeout=30)
        res.raise_for_status()
        for m in res.json() or []:
            docs = m.get("documentList") or []
            agenda = next((d for d in docs if "agenda" in (d.get("templateName") or "").lower()), None)
            tid = agenda and agenda.get("templateId")
            out.append({
                "title": _title(m.get("title")),
                "start": (m.get("dateTime") or "").replace("T", " "),
                "url": f"{base}/Portal/Meeting?meetingTemplateId={tid}" if tid else None,
                "pdf": f"{base}/Public/CompiledDocument?meetingTemplateId={tid}&compileOutputType=1" if tid else None,
                "docs": [f"{base}/Portal/Meeting?meetingTemplateId={d.get('templateId')}" for d in docs],
            })
    return out


READERS = {"escribe": escribe_meetings, "primegov": primegov_meetings}


def ranked(meetings: list[dict], today: date) -> list[dict]:
    """Meetings of council or its committees with an agenda out, newest
    first. One up to 30 days ahead counts once its agenda is published,
    since that is when subscribers want it. Closed and cancelled meetings
    are left out, and so is Burnaby's weekly "Council Correspondence and
    Public Notice Submissions", which eSCRIBE lists as a meeting."""
    horizon = (today + timedelta(days=30)).isoformat()
    usable = [m for m in meetings
              if (m["url"] or m["pdf"]) and m["start"][:10] <= horizon
              and not _SKIP.search(m["title"]) and not is_not_an_agenda(m["title"])]
    usable = [m for m in usable if _OF_COUNCIL.search(m["title"])] or usable
    return sorted(usable, key=lambda m: m["start"], reverse=True)


def is_regular(m: dict) -> bool:
    return "council" in m["title"].lower() and not _NOT_REGULAR.search(m["title"])


def only_closes(text: str) -> bool:
    """An agenda whose business is closing the meeting to the public, such as
    Nanaimo's "Special Council Meeting" of October 14: nothing to summarize."""
    return len(text) < 2500 and re.search(r"\bclosed? (?:to|from) the public\b", text, re.I) is not None


def _agenda_text(m: dict) -> tuple[str, int]:
    """The agenda's text: the HTML agenda first, which both portals serve to a
    script, then the PDF (eSCRIBE's needs a browser past its Cloudflare check)."""
    if m["url"]:
        try:
            res = _get(m["url"], 60)
            if res.ok:
                # PrimeGov puts a subscribe box and video controls above it.
                text = re.sub(r"^[\s\S]{0,1500}?Show Video\s*(?:-->)?\s*", "", _html_to_text(res.text), count=1)
                if len(text) >= 200:
                    return text, 0
        except Exception as e:
            print(f"[platforms] HTML agenda {m['url']} unreadable: {e}")
    if m["pdf"]:
        text, pages, _ = _document_text(m["pdf"])
        if not text.strip():
            text, pages, _ = _browser_document(m["pdf"])
        return text, pages
    return "", 0


def find_latest(slug: str) -> dict | None:
    """agenda_find_latest's result for a council on eSCRIBE or PrimeGov, or
    None when its listing is on neither (or the portal could not be read), so
    the other tiers run."""
    mod = db.one("SELECT * FROM module WHERE slug = %s", (slug,))
    if not mod:
        return None
    cfg = db.one("SELECT * FROM scrape_config WHERE module_id = %s", (mod["id"],))
    start = listing_url(cfg, mod)
    found = portal(start)
    if not found:
        try:
            found = portal(start, _get(start).text)
        except Exception:
            return None
    if not found:
        return None
    kind, base = found
    today = date.today()
    try:
        meetings = ranked(READERS[kind](base, today - timedelta(days=365), today + timedelta(days=60)), today)
    except Exception as e:
        print(f"[platforms] {kind} portal {base} unreadable: {e}")
        return None
    newest = None
    for m in meetings[:4]:
        text, pages = _agenda_text(m)
        if text.strip() and not only_closes(text):
            newest = m
            break
    if not newest:
        return None
    regular = next((m for m in meetings if is_regular(m)), None)
    return {
        "ok": True,
        "detail": (f'{kind} portal {base}: "{newest["title"]}" ({newest["start"][:10]}), '
                   f"{len(text)} chars of agenda"),
        "data": {
            "meetingTitle": newest["title"],
            "meetingUrl": newest["url"] or newest["pdf"],
            "meetingDate": newest["start"][:10],
            "agendaText": text[:12000],
            "pdfLinks": [newest["pdf"]] if newest["pdf"] else [],
            "pages": pages,
            "listingUrl": base,
            "additionalMeeting": None if regular in (None, newest) else {
                "meetingTitle": regular["title"],
                "meetingUrl": regular["url"] or regular["pdf"],
                "meetingDate": regular["start"][:10],
                "pdfUrl": regular["pdf"],
            },
        },
    }
