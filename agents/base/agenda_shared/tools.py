"""Shared agent tools — deterministic web/scrape/geo helpers.

Port of src/agents/tools.ts. Agents call these directly (the old TS agents
called tools deterministically, not via an LLM tool-loop). Each returns a
dict: {"ok": bool, "detail": str, "data": {...}}.
"""
import json
import os
import re
from datetime import datetime, timezone, date
from io import BytesIO
from urllib.parse import urljoin, urlparse

import requests

from . import db
from .llm import complete_json, summarize

RENDERER_URL = os.environ.get("RENDERER_URL", "http://renderer:8000")
BROWSER_URL = os.environ.get("BROWSER_URL", "http://browser:8000")

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like "
    "Gecko) Chrome/120.0.0.0 Safari/537.36 AgendaDelivery/1.0 "
    "(+https://agenda.delivery)"
)
_HREF = re.compile(r"""href=["']([^"']+)["']""", re.I)


def _get(url: str, timeout: int = 15):
    return requests.get(url, headers={"User-Agent": USER_AGENT},
                        allow_redirects=True, timeout=timeout)


def extract_domain(url: str) -> str:
    try:
        host = urlparse(url).hostname or ""
        return host[4:] if host.startswith("www.") else host
    except Exception:
        return re.sub(r"^https?://(www\.)?", "", url).split("/")[0]


def fetch_html(url: str, timeout: int = 15) -> str:
    try:
        return _get(url, timeout).text
    except Exception:
        return "[could not fetch HTML]"


def _looks_not_found(html: str, ok: bool) -> bool:
    low = html.lower()
    return (
        not ok
        or ("page not found" in low and len(html) < 5000)
        or ("404" in low and len(html) < 2000 and "not found" in low)
        or ("not found" in low and len(html) < 2000)
    )


def render_html(url: str) -> tuple[str, str]:
    """Render a JS page via the headless renderer container. Returns
    (html, final_url); ("", url) on any failure (renderer down, timeout)."""
    try:
        r = requests.post(f"{RENDERER_URL}/render", json={"url": url}, timeout=75)
        d = r.json()
        if d.get("ok") and d.get("html"):
            return d["html"], d.get("final_url", url)
    except Exception:
        pass
    return "", url


def _is_js_shell(html: str) -> bool:
    """Heuristic: page is a client-rendered shell with little real content."""
    return (len(html) < 2000 or "__NEXT_DATA__" in html
            or "ng-app" in html or "data-reactroot" in html)


# -- web.search --------------------------------------------------
def web_search(query: str, site: str = "") -> dict:
    if not query:
        return {"ok": False, "detail": "No query provided", "data": {}}

    suggestions = complete_json(
        "You are a web search assistant for a municipal agenda scraper. Given a "
        "search query, suggest 5-8 likely URLs where the agenda page might be "
        "found. Consider common patterns: /council-meetings, /meetings-and-agendas, "
        "/agendas, /city-hall/council, /government, calendar subdomains, etc. "
        'Respond with JSON: {"urls":["https://...", ...]}',
        f'Search query: "{query}"' + (f"\nRestrict to domain: {site}" if site else ""),
    )
    valid = []
    for url in (suggestions.get("urls") or [])[:8]:
        try:
            res = _get(url, 10)
            low = res.text.lower()
            has_agenda = ("agenda" in low or "meeting" in low or "council" in low)
            not_found = _looks_not_found(res.text, res.ok)
            valid.append({"url": url, "status": res.status_code,
                          "hasAgendaContent": has_agenda and not not_found and res.ok})
        except Exception:
            continue
    good = [v["url"] for v in valid if v["hasAgendaContent"]]
    return {
        "ok": len(good) > 0,
        "detail": (f"Found {len(good)} valid agenda page(s): {', '.join(good)}"
                   if good else f"Searched {len(valid)} URLs, none had agenda content"),
        "data": {"query": query, "results": valid, "validUrls": good},
    }


# -- site.crawl --------------------------------------------------
def site_crawl(url: str) -> dict:
    if not url:
        return {"ok": False, "detail": "No URL provided", "data": {}}
    try:
        res = _get(url, 15)
        html = res.text
        if _looks_not_found(html, res.ok):
            return {"ok": False,
                    "detail": f"Crawled {url} -> page not found (status {res.status_code})",
                    "data": {"links": [], "notFound": True}}
        links = []
        for href in _HREF.findall(html):
            low = href.lower()
            if any(k in low for k in ("agenda", "meeting", "council", "board",
                                      "calendar")) or low.endswith(".pdf"):
                try:
                    absu = urljoin(res.url, href)
                    if absu not in links:
                        links.append(absu)
                except Exception:
                    pass
        return {"ok": True,
                "detail": f"Crawled {url}, found {len(links)} agenda-related links",
                "data": {"links": links[:20]}}
    except Exception as e:
        return {"ok": False, "detail": f"Crawl {url} failed: {e}", "data": {}}


# -- geo.locate --------------------------------------------------
def geo_locate(query: str) -> dict:
    if not query:
        return {"ok": False, "detail": "No query provided", "data": {}}
    # Primary: Nominatim (OpenStreetMap, no API key).
    try:
        res = requests.get(
            "https://nominatim.openstreetmap.org/search",
            params={"format": "jsonv2", "limit": 1, "q": query},
            headers={"User-Agent": USER_AGENT}, timeout=10,
        )
        if res.ok:
            data = res.json()
            if data and data[0].get("lat") and data[0].get("lon"):
                lat = float(data[0]["lat"])
                lng = float(data[0]["lon"])
                region = ", ".join(
                    p.strip() for p in data[0]["display_name"].split(",")[-2:]
                ).strip()
                return {"ok": True,
                        "detail": f"Nominatim resolved to {region} ({lat}, {lng})",
                        "data": {"lat": lat, "lng": lng, "region": region}}
    except Exception:
        pass
    # Fallback: LLM (approximate).
    r = complete_json(
        "You are a geolocation assistant. Given a place name or website, determine "
        "the APPROXIMATE latitude, longitude, and human-readable region. Mark them "
        'approximate. Respond with JSON: {"lat": number, "lng": number, "region": "string"}',
        f"Geolocate: {query}",
    )
    return {"ok": True,
            "detail": f"LLM (approximate) resolved to {r.get('region')} ({r.get('lat')}, {r.get('lng')})",
            "data": {**r, "approximate": True}}


# -- verify.selfcheck --------------------------------------------
def verify_selfcheck(slug: str) -> dict:
    m = db.one("SELECT * FROM module WHERE slug = %s", (slug,))
    if not m:
        return {"ok": False, "detail": f"Module '{slug}' not found", "data": {"checksPassed": 0}}
    cfg = db.one("SELECT * FROM scrape_config WHERE module_id = %s", (m["id"],))
    if not cfg:
        return {"ok": False, "detail": "No scrape config for module", "data": {"checksPassed": 0}}
    try:
        res = _get(cfg["agenda_url"], 10)
        html = res.text
        low = html.lower()
        status_ok = res.ok
        not_nf = not _looks_not_found(html, res.ok)
        has_agenda = any(k in low for k in ("agenda", "meeting", "council", "hearing"))
        has_links = "href" in low and (".pdf" in low or "agenda" in low or "meeting" in low)
        substantial = len(html) > 1000
        sel = cfg.get("link_selector") or ""
        sel_kw = re.sub(r"[^a-z]", "", re.sub(r"a\[.*?\]", "", sel), flags=re.I).lower()
        sel_match = (sel_kw in low or ".pdf" in low) if sel_kw else True
        checks = [status_ok, not_nf, has_agenda, has_links, substantial, sel_match]
        passed = sum(1 for c in checks if c)
        return {"ok": passed >= 5,
                "detail": f"{passed}/6 checks passed" + ("" if passed >= 5 else " -- verification issues detected"),
                "data": {"checksPassed": passed, "total": 6, "status": res.status_code,
                         "notFound": not not_nf, "hasAgendaContent": has_agenda,
                         "substantialHtml": substantial}}
    except Exception:
        return {"ok": False, "detail": "0/6 checks passed (fetch failed)", "data": {"checksPassed": 0}}


# -- db.save_config ----------------------------------------------
def db_save_config(slug: str, agenda_url: str, link_selector: str,
                   file_types: str, hints: str) -> dict:
    m = db.one("SELECT id FROM module WHERE slug = %s", (slug,))
    if not m:
        return {"ok": False, "detail": f"Module {slug} not found", "data": {}}
    types = [s.strip() for s in (file_types or "pdf").split(",") if s.strip()] or ["pdf"]
    existing = db.one("SELECT * FROM scrape_config WHERE module_id = %s", (m["id"],))
    if existing:
        db.execute(
            """UPDATE scrape_config SET agenda_url=%s, link_selector=%s, file_types=%s,
               hints=%s, version=%s, verified=TRUE, updated_at=now() WHERE id=%s""",
            (agenda_url, link_selector, types, hints, existing["version"] + 1, existing["id"]),
        )
        return {"ok": True, "detail": f"Updated scrape config to v{existing['version'] + 1}", "data": {}}
    db.execute(
        """INSERT INTO scrape_config (module_id, agenda_url, link_selector, file_types,
           hints, version, verified) VALUES (%s,%s,%s,%s,%s,1,TRUE)""",
        (m["id"], agenda_url, link_selector, types, hints),
    )
    return {"ok": True, "detail": "Saved new scrape config v1", "data": {}}


# -- pdf helper (SSRF-guarded) -----------------------------------
def _pdf_text(pdf_url: str, max_pages: int = 20) -> tuple[str, int]:
    """Download + extract text from the first max_pages of a PDF. SSRF-guarded."""
    if not (pdf_url.startswith("http://") or pdf_url.startswith("https://")):
        raise ValueError("PDF URL must be HTTP(S)")
    host = (urlparse(pdf_url).hostname or "").lower()
    if (host in ("localhost", "0.0.0.0") or host.startswith("127.")
            or host.startswith("10.") or host.startswith("192.168.")
            or host.startswith("169.254.") or host.endswith(".local")
            or re.match(r"^172\.(1[6-9]|2\d|3[01])\.", host)):
        raise ValueError("PDF URL points to a private/internal address")
    res = requests.get(pdf_url, headers={"User-Agent": USER_AGENT}, timeout=120)
    if not res.ok:
        return "", 0
    from pypdf import PdfReader  # local import keeps container start fast
    reader = PdfReader(BytesIO(res.content))
    total = len(reader.pages)
    text = "\n".join((reader.pages[i].extract_text() or "")
                     for i in range(min(max_pages, total)))
    return text, total


# -- agenda.find_latest (LLM-driven selection) ------------------
_MONTH_RE = re.compile(r'\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|jun(e)?|jul(y)?|aug(ust)?|sep(tember)?|oct(ober)?|nov(ember)?|dec(ember)?)\b', re.IGNORECASE)
_YEAR_RE = re.compile(r'\b20\d{2}\b')
_A_RE = re.compile(r'<a\s+[^>]*href\s*=\s*["\']?([^"\'>\s]+)["\']?[^>]*>(.*?)</a>', re.IGNORECASE | re.DOTALL)
_TAG_RE = re.compile(r'<[^>]+>')
_WS_RE = re.compile(r'\s+')

def _links_with_text(html, base):
    out = []
    for m in _A_RE.finditer(html or ''):
        href = m.group(1)
        try:
            url = urljoin(base, href)
        except Exception:
            continue
        inner = m.group(2) or ''
        text = _TAG_RE.sub(' ', inner)
        text = _WS_RE.sub(' ', text).strip()
        if len(text) > 120:
            text = text[:120]
        out.append({'url': url, 'text': text})
    return out

def _find_pdfs(html, base):
    seen = set()
    out = []
    for m in re.finditer(r'<a\s+[^>]*href\s*=\s*["\']?([^"\'>\s]+)["\']?[^>]*>', html or '', re.IGNORECASE):
        href = m.group(1)
        try:
            url = urljoin(base, href)
        except Exception:
            continue
        if url.lower().split('?')[0].endswith('.pdf'):
            if url not in seen:
                seen.add(url)
                out.append(url)
    for m in re.finditer(r'<a\s+[^>]*aria-label\s*=\s*["\']([^"\']+)["\']', html or '', re.IGNORECASE):
        label = m.group(1)
        if label.strip().lower().split('?')[0].endswith('.pdf'):
            href_m = re.search(r'href\s*=\s*["\']?([^"\'>\s]+)', m.group(0), re.IGNORECASE)
            if href_m:
                try:
                    url = urljoin(base, href_m.group(1))
                except Exception:
                    continue
                if url not in seen:
                    seen.add(url)
                    out.append(url)
    return out


_JUNK_TEXT = {"skip to main content", "skip to content", "menu", "home", "search",
              "login", "sign in", "contact", "contact us", "français", "accessibility",
              "back to top", "close", "share", "print", "subscribe"}


def _pick_candidates(all_links):
    """Filter listing links down to plausible meeting/agenda candidates,
    dropping obvious navigation/chrome links."""
    candidates, seen = [], set()
    for lk in all_links:
        u, t = lk['url'], lk['text']
        tl = t.lower().strip()
        ul = u.lower()
        if tl in _JUNK_TEXT or "skip to" in tl:
            continue
        matched = (
            any(k in ul or k in tl for k in ('agenda', 'meeting', 'hearing', 'minutes'))
            or ul.endswith('.pdf') or bool(_MONTH_RE.search(t)) or bool(_YEAR_RE.search(t))
        )
        # A bare "council" match with no date/agenda word is usually a nav link.
        if not matched and ('council' in ul or 'council' in tl) and (
                bool(_MONTH_RE.search(t)) or bool(_YEAR_RE.search(t)) or 'agenda' in tl):
            matched = True
        if matched and u not in seen:
            seen.add(u)
            candidates.append(lk)
            if len(candidates) >= 60:
                break
    return candidates


def _looks_like_a_real_meeting(result: dict) -> bool:
    """The cheap static path can return ok:True while having actually landed
    on a generic category/archive page (e.g. a "2025 Agendas & Minutes" year
    list) instead of a specific meeting. Requiring "has a PDF link" is NOT
    enough -- a year-archive page legitimately has dozens of PDF links (one
    per past meeting), so that check alone lets exactly this false positive
    through. A real, correctly-identified meeting has a specific date; a
    category/listing page does not. Require the date."""
    if not result.get('ok'):
        return False
    d = result.get('data') or {}
    return bool(d.get('meetingDate'))


def agenda_find_latest(slug):
    """Find the latest agenda. Cheap static/rendered path first -- unless a
    prior browser run already tagged this module as needing the browser
    (scrape_config.platform set), in which case skip straight to it, since
    the cheap path is known to fail or produce false positives there.
    Escalates to the undetected-browser LLM nav loop when the cheap path
    fails OR returns a result that doesn't look like a real, dated meeting.
    Escalation records a reusable recipe (entry URL + platform tag) so
    future checks route correctly without re-discovering this."""
    row = db.one(
        "SELECT sc.platform FROM scrape_config sc "
        "JOIN module m ON m.id = sc.module_id WHERE m.slug = %s", (slug,))
    if row and row.get('platform'):
        return browser_find_latest(slug)

    result = _static_find_latest(slug)
    if _looks_like_a_real_meeting(result):
        return result
    browser_result = browser_find_latest(slug)
    if browser_result.get('ok'):
        return browser_result
    # Neither path produced a trustworthy result. Do NOT fall back to the
    # cheap path's result here -- if it looked real we'd have returned it
    # already, so what's left is either a clean failure (fine to surface)
    # or a false positive we already know not to trust (must NOT surface
    # as ok:True). Report a clear failure either way.
    return {
        'ok': False,
        'detail': ('No specific dated meeting found (static path found only a '
                  'generic/archive page, browser navigation also failed: '
                  f"{browser_result.get('detail', 'unknown error')})"),
        'data': {},
    }


def _static_find_latest(slug):
    try:
        row = db.one("SELECT * FROM module WHERE slug=%s", (slug,))
        if not row:
            return {'ok': False, 'detail': 'Module not found', 'data': {}}
        cfg = db.one("SELECT * FROM scrape_config WHERE module_id=%s", (row['id'],))
        listing_url = (cfg or {}).get('agenda_url') or row['source_url']

        def has_meeting_links(html):
            low = (html or '').lower()
            return any(k in low for k in ('agenda', 'meeting', 'council', 'minutes', '/detail'))

        try:
            res = _get(listing_url)
            list_html = res.text
            effective_url = res.url
        except Exception as e:
            return {'ok': False, 'detail': f'Failed to fetch listing: {e}', 'data': {}}

        if not has_meeting_links(list_html):
            try:
                home_res = _get('https://' + extract_domain(row['source_url']))
                home_html = home_res.text
                home_links = _links_with_text(home_html, home_res.url)
                tried = 0
                for lk in home_links:
                    u = lk['url'].lower()
                    if 'calendar' in u or 'meeting' in u or 'agenda' in u:
                        try:
                            cand_res = _get(lk['url'])
                            cand_html = cand_res.text
                        except Exception:
                            continue
                        tried += 1
                        if has_meeting_links(cand_html):
                            list_html = cand_html
                            effective_url = cand_res.url
                            break
                        if tried >= 5:
                            break
            except Exception:
                pass

        all_links = _links_with_text(list_html, effective_url)
        candidates = _pick_candidates(all_links)

        # JS-rendered SPA fallback: if static HTML yielded too few real meeting
        # links, render the page with the headless renderer and retry.
        if len(candidates) < 3:
            rhtml, rurl = render_html(effective_url)
            if rhtml and len(rhtml) > len(list_html):
                list_html, effective_url = rhtml, rurl
                all_links = _links_with_text(list_html, effective_url)
                candidates = _pick_candidates(all_links)

        if not candidates:
            return {'ok': False, 'detail': 'No meeting links found', 'data': {}}

        today = date.today().isoformat()
        system = (
            "You are given links scraped from a municipal council's meetings/agendas "
            "page. Pick the SINGLE most recent PAST meeting (date on or before today) "
            "that has an agenda. Prefer a direct agenda PDF; otherwise the meeting's "
            "detail page. IGNORE navigation, 'skip to content', login, search, and "
            "generic schedule/calendar overview links. "
            'Return JSON {"url":..., "title":..., "date":"YYYY-MM-DD" or null, "is_pdf":bool}. '
            'If no link is a real specific meeting, return {"url": null}.'
        )
        user = json.dumps({"today": today, "links": candidates})
        try:
            picked = complete_json(system, user)
        except Exception:
            picked = {}
        cand_urls = {c["url"] for c in candidates}
        purl = picked.get("url") if isinstance(picked, dict) else None
        if not purl or purl not in cand_urls:
            # LLM abstained or hallucinated — fall back to the best dated candidate.
            dated = [c for c in candidates
                     if _MONTH_RE.search(c["text"]) or _YEAR_RE.search(c["text"])
                     or c["url"].lower().endswith(".pdf")]
            if not dated:
                return {"ok": False,
                        "detail": "No specific meeting agenda link identified", "data": {}}
            best = dated[0]
            picked = {"url": best["url"], "title": best["text"], "date": None,
                      "is_pdf": best["url"].lower().endswith(".pdf")}

        url = picked["url"]
        title = (picked.get("title") or "").strip()
        if title.lower() in _JUNK_TEXT or "skip to" in title.lower():
            title = ""
        mdate = picked.get("date")
        is_pdf = bool(picked.get("is_pdf")) or url.lower().endswith(".pdf")

        pdf_links = []
        detail_html = ''
        if is_pdf:
            pdf_links = [url]
        else:
            try:
                dres = _get(url)
                detail_html = dres.text
                pdf_links = _find_pdfs(detail_html, url)
                # Detail page may also be JS-rendered — render if no PDFs found.
                if not pdf_links and _is_js_shell(detail_html):
                    rhtml, _ = render_html(url)
                    if rhtml:
                        detail_html = rhtml
                        pdf_links = _find_pdfs(detail_html, url)
                if not title:
                    title = _extract_title(detail_html, 0)
            except Exception:
                pass

        if not title:
            title = 'Council Meeting'

        pdf_text = ''
        pages = 0
        if pdf_links:
            try:
                pdf_text, pages = _pdf_text(pdf_links[0])
            except Exception as e:
                print(f'Skipping PDF extraction for {pdf_links[0]}: {e}')
                pdf_text = ''
                pages = 0

        agenda_text = _html_to_text(detail_html) if detail_html else ''
        final = (pdf_text or agenda_text)[:12000]
        if not final and not pdf_links:
            return {'ok': False, 'detail': 'meeting found but no agenda content', 'data': {}}

        meeting_date = mdate if mdate else None
        detail_msg = (f'Found latest meeting: "{title}" ({meeting_date or "date unknown"}) '
                      f'at {url}, {len(pdf_links)} PDF link(s), {len(final)} chars')
        if pages:
            detail_msg += f' (PDF {pages} pages)'

        return {
            'ok': True,
            'detail': detail_msg,
            'data': {
                'meetingTitle': title,
                'meetingUrl': url,
                'meetingDate': meeting_date,
                'agendaText': final,
                'pdfLinks': pdf_links,
                'listingUrl': effective_url,
            },
        }
    except Exception as e:
        return {'ok': False, 'detail': f'agenda.find_latest failed: {e}', 'data': {}}


# -- browser.find_latest (agentic nav loop, undetected browser) --
def browser_find_latest(slug, max_steps=8):
    try:
        mod = db.one("SELECT * FROM module WHERE slug=%s", (slug,))
        if not mod:
            return {"ok": False, "detail": "Module not found", "data": {}}
        cfg = db.one("SELECT * FROM scrape_config WHERE module_id=%s", (mod["id"],))
        start_url = (cfg or {}).get("agenda_url") or mod["source_url"]

        try:
            r = requests.post(f"{BROWSER_URL}/session", timeout=90)
            sd = r.json()
        except Exception as e:
            return {"ok": False, "detail": f"Browser session failed: {e}", "data": {}}
        if not sd.get("ok"):
            return {"ok": False, "detail": f"Browser session failed: {sd}", "data": {}}
        sid = sd["session_id"]

        trail = []
        found = False
        picked_url = picked_title = picked_date = None
        state = {}
        try:
            try:
                g = requests.post(f"{BROWSER_URL}/session/{sid}/goto", json={"url": start_url}, timeout=90)
                gj = g.json()
                if not gj.get("ok"):
                    return {"ok": False, "detail": f"goto start failed: {gj}", "data": {}}
            except Exception as e:
                return {"ok": False, "detail": f"goto start failed: {e}", "data": {}}

            for step in range(max_steps):
                try:
                    st = requests.get(f"{BROWSER_URL}/session/{sid}/state?max_chars=2500", timeout=90)
                    state = st.json()
                    if not state.get("ok"):
                        break
                except Exception:
                    break

                try:
                    lk = requests.get(f"{BROWSER_URL}/session/{sid}/links", timeout=90)
                    links = lk.json()
                    if not links.get("ok"):
                        links = {"pdfs": []}
                except Exception:
                    links = {"pdfs": []}

                elements = [{"ref": e.get("ref"), "tag": e.get("tag"), "text": (e.get("text") or "")[:200]}
                            for e in (state.get("elements") or [])[:40]]
                today = date.today().isoformat()
                system = ("You are driving a real browser to find a council's most recent PUBLISHED (not future) "
                          "meeting agenda. You see visible_text, elements, and pdf_links_seen. Respond JSON only: "
                          '{"action":"click"|"goto"|"done"|"fail","ref":str|null,"url":str|null,"title":str|null,'
                          '"date":"YYYY-MM-DD"|null,"reason":str}.')
                user = json.dumps({
                    "today": today, "step": step,
                    "current_url": state.get("url"), "current_title": state.get("title"),
                    "visible_text": (state.get("text") or "")[:1500],
                    "elements": elements,
                    "pdf_links_seen": (links.get("pdfs") or [])[:15],
                })
                try:
                    decision = complete_json(system, user)
                except Exception:
                    decision = {"action": "fail", "reason": "llm error"}

                trail.append({k: decision.get(k) for k in ("action", "ref", "url", "reason")})
                action = decision.get("action")

                if action == "done":
                    picked_url = decision.get("url") or state.get("url")
                    picked_title = decision.get("title")
                    picked_date = decision.get("date")
                    found = True
                    break
                elif action == "fail":
                    found = False
                    break
                elif action == "click" and decision.get("ref"):
                    try:
                        requests.post(f"{BROWSER_URL}/session/{sid}/click", json={"ref": decision["ref"]}, timeout=90)
                    except Exception:
                        pass
                    continue
                elif action == "goto" and decision.get("url"):
                    try:
                        requests.post(f"{BROWSER_URL}/session/{sid}/goto", json={"url": decision["url"]}, timeout=90)
                    except Exception:
                        pass
                    continue
                else:
                    continue
        finally:
            try:
                requests.delete(f"{BROWSER_URL}/session/{sid}", timeout=90)
            except Exception:
                pass

        if not found:
            return {"ok": False, "detail": "Browser navigation exhausted without finding a specific agenda", "data": {"trail": trail}}

        is_pdf = picked_url.lower().split("?")[0].endswith(".pdf")
        pdf_text, pages = "", 0
        if is_pdf:
            try:
                pdf_text, pages = _pdf_text(picked_url)
            except Exception as e:
                print(f"[browser_find_latest] PDF extract skipped: {e}")

        agenda_text = ""
        if not pdf_text and not is_pdf:
            try:
                res = requests.get(picked_url, timeout=20)
                if res.ok:
                    agenda_text = _html_to_text(res.text)
                else:
                    agenda_text = state.get("text", "")
            except Exception:
                agenda_text = state.get("text", "")
        final_text = (pdf_text or agenda_text)[:12000]

        hay = (picked_url + (mod["source_url"] or "")).lower()
        platform_guess = None
        for p in ("escribe", "legistar", "civicweb", "icompass", "granicus",
                  "agendafiles", "meetingworkspace"):
            if p in hay:
                platform_guess = p
                break

        # Persist start_url (the navigable entry point), NOT picked_url. picked_url
        # is often a specific document/PDF -- a dead end with no further links, so
        # storing it as agenda_url would strand both the cheap static retry and any
        # future browser re-navigation at a page they can't navigate onward from.
        try:
            if cfg:
                db.execute(
                    "UPDATE scrape_config SET agenda_url=%s, platform=%s, nav_recipe=%s, verified=TRUE, updated_at=now() WHERE module_id=%s",
                    (start_url, platform_guess, json.dumps(trail), mod["id"]),
                )
            else:
                db.execute(
                    "INSERT INTO scrape_config (module_id, agenda_url, platform, nav_recipe, version, verified) VALUES (%s,%s,%s,%s,1,TRUE)",
                    (mod["id"], start_url, platform_guess, json.dumps(trail)),
                )
        except Exception as e:
            print(f"[browser_find_latest] recipe persist failed: {e}")

        return {
            "ok": True,
            "detail": f'Browser found latest meeting: "{picked_title or "Council Meeting"}" ({picked_date or "date unknown"}) at {picked_url}, {len(final_text)} chars' + (f" (PDF {pages} pages)" if pages else ""),
            "data": {
                "meetingTitle": picked_title or "Council Meeting",
                "meetingUrl": picked_url,
                "meetingDate": picked_date,
                "agendaText": final_text,
                "pdfLinks": [picked_url] if is_pdf else [],
                "listingUrl": start_url,
                "platform": platform_guess,
                "navSteps": len(trail),
            },
        }
    except Exception as e:
        return {"ok": False, "detail": f"browser_find_latest failed: {e}", "data": {}}


_GENERIC_TITLES = ("council calendar", "meetings and agendas", "agenda search",
                   "meeting calendar", "upcoming meetings", "past meetings", "all meetings")
_MONTHS_RE = re.compile(
    r"\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|meeting|council|agenda|"
    r"public hearing|committee)\b", re.I)


def _extract_title(html: str, date_ms: float) -> str:
    m = re.search(r"""<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']""",
                  html, re.I)
    if m:
        return m[1].strip()
    m = re.search(r"<title[^>]*>([^<]+)</title>", html, re.I)
    if m:
        return re.split(r"[|\-–—]", m[1].strip())[0].strip()
    for tag in ("h1", "h2"):
        for hm in re.finditer(rf"<{tag}[^>]*>([\s\S]*?)</{tag}>", html, re.I):
            text = re.sub(r"<[^>]+>", "", hm[1]).strip()
            low = text.lower()
            if (0 < len(low) < 200 and not any(g in low for g in _GENERIC_TITLES)
                    and (_MONTHS_RE.search(text) or (tag == "h1" and re.search(r"\b\d{1,2}\b", text)))):
                return text
    if date_ms:
        d = datetime.fromtimestamp(date_ms / 1000, timezone.utc)
        return f"Regular Council Meeting — {d.strftime('%B %d, %Y')}"
    return "Council Meeting"


def _html_to_text(html: str) -> str:
    for tag in ("script", "style", "nav", "footer", "header"):
        html = re.sub(rf"<{tag}[\s\S]*?</{tag}>", "", html, flags=re.I)
    text = re.sub(r"<[^>]+>", "\n", html)
    for a, b in (("&nbsp;", " "), ("&amp;", "&"), ("&lt;", "<"), ("&gt;", ">"),
                 ("&quot;", '"')):
        text = text.replace(a, b)
    text = re.sub(r"&#\d+;", "", text)
    text = re.sub(r"\n\s*\n", "\n", text)
    text = re.sub(r"^\s+", "", text, flags=re.M)
    return text.strip()
