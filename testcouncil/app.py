"""City of Testville: a pretend council at testcouncil.agenda.delivery.

agenda.delivery watches it like any real council. A release posts the next
meeting's agenda and the minutes of the meeting before it, written by the
agent model (glm-5.3-flash on Ollama Cloud); a revert takes the newest
release back down. A timer also releases every TESTCOUNCIL_RELEASE_DAYS, so
the site keeps moving on its own. TESTING.md covers how to use it.

    python app.py release [committee]    e.g. public-hearing
    python app.py revert
"""
import hmac
import html
import json
import os
import sys
import textwrap
import threading
import time
from contextlib import contextmanager
from datetime import date, timedelta

from flask import Flask, Response, abort, jsonify, request

from agenda_shared.llm import complete_json

try:
    import fcntl
except ImportError:  # a Windows dev box; the container is Linux
    fcntl = None

STATE_PATH = os.environ.get("TESTCOUNCIL_STATE", "/data/state.json")
TOKEN = os.environ.get("TESTCOUNCIL_TOKEN", "")
PUBLIC_URL = os.environ.get("TESTCOUNCIL_URL", "https://testcouncil.agenda.delivery").rstrip("/")
RELEASE_DAYS = float(os.environ.get("TESTCOUNCIL_RELEASE_DAYS", "7"))

CITY = "City of Testville"
HALL = "Council Chambers, City Hall, 100 Main Street"
COUNCIL = ["Mayor Dana Whitlock", "Councillor Priya Natarajan", "Councillor Owen Fairbairn",
           "Councillor Mei-Lin Cho", "Councillor Rafael Ortiz", "Councillor Grace Adeyemi",
           "Councillor Tom Kowalczyk"]
COMMITTEES = {
    "regular-council": {
        "name": "Regular Council Meeting", "time": "7:00 pm", "where": HALL, "members": COUNCIL,
        "about": "Council's business meeting, where bylaws are read and adopted and staff "
                 "recommendations are decided."},
    "committee-of-the-whole": {
        "name": "Committee of the Whole", "time": "3:00 pm", "where": HALL, "members": COUNCIL,
        "about": "All of Council meeting less formally to hear delegations and staff "
                 "presentations before items go to a Regular Council Meeting."},
    "public-hearing": {
        "name": "Public Hearing", "time": "7:00 pm", "where": HALL, "members": COUNCIL,
        "about": "Residents speak to rezoning and Official Community Plan bylaws before "
                 "Council votes on them."},
    "advisory-planning-commission": {
        "name": "Advisory Planning Commission", "time": "6:00 pm",
        "where": "Committee Room 2, City Hall, 100 Main Street",
        "members": ["Ayesha Rahman (Chair)", "Liam Gallagher", "Sofia Marchetti", "Daniel Osei",
                    "Councillor Owen Fairbairn (Council liaison)"],
        "about": "Residents appointed by Council to review development applications and land "
                 "use policy and advise Council on them."},
}
# Scheduled releases walk this list, so most meetings are regular council
# meetings and the other bodies turn up in between, as on a real site.
ROTATION = ["regular-council", "committee-of-the-whole", "regular-council", "public-hearing",
            "regular-council", "advisory-planning-commission"]

app = Flask(__name__)
LOCK = threading.Lock()


@contextmanager
def locked():
    """One release or revert at a time across processes too: the CLI, the
    timer and the admin endpoints each load, change and save the same file,
    and the thread lock alone let two of them interleave."""
    with LOCK:
        if fcntl is None:
            yield
            return
        with open(STATE_PATH + ".lock", "w") as fh:
            fcntl.flock(fh, fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(fh, fcntl.LOCK_UN)
e = html.escape


# -- state: one JSON file on the testcouncil volume --------------
def load() -> dict:
    try:
        with open(STATE_PATH) as f:
            return json.load(f)
    except FileNotFoundError:
        return {"next_id": 1, "released_at": 0, "news": [], "meetings": []}


def save(state: dict) -> None:
    tmp = f"{STATE_PATH}.{os.getpid()}.tmp"
    with open(tmp, "w") as f:
        json.dump(state, f, indent=1)
    os.replace(tmp, STATE_PATH)


def release(committee: str | None = None, day: date | None = None) -> dict:
    """Post the next meeting's agenda and the minutes of the meeting before it."""
    with locked():
        state = load()
        slug = committee or ROTATION[(state["next_id"] - 1) % len(ROTATION)]
        if slug not in COMMITTEES:
            raise ValueError(f"unknown committee {slug!r}, use one of: {', '.join(COMMITTEES)}")
        day = day or date.today()
        prev = state["meetings"][-1] if state["meetings"] else None
        written = _write(slug, day, prev, state["meetings"])
        meeting = {"id": state["next_id"], "committee": slug, "date": day.isoformat(),
                   "items": written["items"], "minutes": None,
                   "minutes_for": prev["id"] if prev and not prev["minutes"] else None,
                   "prev_news": state["news"]}
        if meeting["minutes_for"]:
            prev["minutes"] = written["minutes"]
        state["news"] = written["news"] or state["news"]
        state["meetings"].append(meeting)
        state["next_id"] += 1
        state["released_at"] = time.time()
        save(state)
    return meeting


def revert() -> dict | None:
    """Take the newest release back down, here and in agenda.delivery."""
    with locked():
        state = load()
        if not state["meetings"]:
            return None
        meeting = state["meetings"].pop()
        for m in state["meetings"]:
            if m["id"] == meeting["minutes_for"]:
                m["minutes"] = None
        state["news"] = meeting["prev_news"]
        save(state)
    meeting["forgotten"] = _forget(meeting)
    return meeting


def _forget(meeting: dict) -> int:
    """Delete agenda.delivery's record of a reverted meeting. It only counts a
    meeting dated after its newest one as new, so without this a re-release
    on the same day would be passed over."""
    if not os.environ.get("DATABASE_URL"):
        return 0
    from agenda_shared import db  # opens a pool, which only a revert needs
    urls = [f"{PUBLIC_URL}/meetings/{meeting['id']}", PUBLIC_URL + doc_path(meeting, "agenda")]
    row = db.execute(
        "WITH gone AS (DELETE FROM meeting WHERE meeting_url = ANY(%s) OR pdf_url = ANY(%s) "
        "RETURNING 1) SELECT count(*) AS n FROM gone", (urls, urls))
    return row["n"]


def _write(slug: str, day: date, prev: dict | None, meetings: list) -> dict:
    """Agenda items, minutes for prev and homepage news, from the agent model."""
    com = COMMITTEES[slug]
    ask = {
        "city": CITY, "meeting": com["name"], "date": day.isoformat(), "members": com["members"],
        "previous_meeting": prev and {
            "meeting": COMMITTEES[prev["committee"]]["name"], "date": prev["date"],
            "members": COMMITTEES[prev["committee"]]["members"],
            "items": [i["title"] for i in prev["items"]]},
        "recent_topics": [i["title"] for m in meetings[-6:] for i in m["items"]],
    }
    system = (
        f"You write the public records of the {CITY}, a fictional mid-sized Canadian city. "
        "Return a JSON object with three keys. "
        '"items": 5 to 8 substantive agenda items for this meeting, each {"title", "body"}; the '
        "body is 2 to 4 sentences in the plain style of a staff report: what is proposed, street "
        "addresses, bylaw or file numbers, dollar amounts, and the staff recommendation. Include "
        "at least one rezoning or development permit, one budget or finance item, and one parks, "
        "transportation or infrastructure item. Suit the items to the kind of meeting and do not "
        "repeat recent_topics. Leave out procedural items (call to order, adoption of the agenda "
        "or minutes, adjournment); they are added for you. "
        '"minutes": the minutes of previous_meeting as a list of short paragraphs: who attended, '
        "then for each of its items the motion, its mover and seconder (from its members) and "
        "whether it CARRIED or was DEFEATED, then the time it adjourned. An empty list if "
        "previous_meeting is null. "
        '"news": 3 homepage news items, each {"headline", "text"}, text one or two sentences. '
        "Plain text only, no markdown."
    )
    try:
        out = complete_json(system, json.dumps(ask), temperature=0.9)
        items = [{"title": str(i.get("title", "")).strip(), "body": str(i.get("body", "")).strip()}
                 for i in out.get("items") or [] if isinstance(i, dict)]
        items = [i for i in items if i["title"]]
        if not items:
            raise ValueError("no agenda items in the reply")
        return {"items": items,
                "minutes": [str(p) for p in out.get("minutes") or []] if prev else [],
                "news": [{"headline": str(n["headline"]), "text": str(n.get("text", ""))}
                         for n in out.get("news") or [] if isinstance(n, dict) and n.get("headline")]}
    except Exception as err:  # noqa: BLE001 -- no key, rate limit or bad JSON
        print(f"[testcouncil] model unavailable, using stock items: {err}", flush=True)
    bylaw = day.strftime("%y%m%d")
    return {
        "items": [
            {"title": f"Rezoning Bylaw No. {bylaw}: 4410 Elm Street",
             "body": "Rezone 4410 Elm Street from RS-1 Single Family to RM-2 Townhouse to allow "
                     "18 townhouses. Staff recommend first and second reading."},
            {"title": "Quarterly Financial Report",
             "body": "Operating spending is 2.1% under budget at the end of the quarter. Staff "
                     "recommend Council receive the report for information."},
            {"title": "Riverside Park Playground Replacement",
             "body": "Award contract PR-26-14 for $412,000 to replace the Riverside Park "
                     "playground. Staff recommend Council approve the award."},
        ],
        "minutes": ([f"Present: {', '.join(COMMITTEES[prev['committee']]['members'])}."]
                    + [f"{i['title']}: moved and seconded that the recommendation be adopted. "
                       "CARRIED." for i in prev["items"]]
                    + ["The meeting adjourned at 8:42 pm."]) if prev else [],
        "news": [],
    }


def _timer() -> None:
    """Scheduled releases. A fresh site first gets three weeks of history."""
    while True:
        try:
            if not load()["released_at"]:
                for weeks in (3, 2, 1):
                    release(day=date.today() - timedelta(weeks=weeks))
            if time.time() - load()["released_at"] >= RELEASE_DAYS * 86400:
                release()
        except Exception as err:  # noqa: BLE001 -- try again next hour
            print(f"[testcouncil] scheduled release failed: {err}", flush=True)
        time.sleep(3600)


# -- documents -------------------------------------------------------
def long_date(iso: str) -> str:
    d = date.fromisoformat(iso)
    return f"{d:%A, %B} {d.day}, {d.year}"


def doc_path(m: dict, kind: str) -> str:
    return f"/meetings/{m['id']}/{m['date']}-{m['committee']}-{kind}.pdf"


def agenda(m: dict) -> list[tuple[str, str]]:
    return ([("Call to Order", ""),
             ("Adoption of the Agenda", "That the agenda be adopted as circulated."),
             ("Adoption of Minutes", "That the minutes of the previous meeting be adopted.")]
            + [(i["title"], i["body"]) for i in m["items"]]
            + [("Adjournment", "")])


def heading(m: dict) -> list[str]:
    com = COMMITTEES[m["committee"]]
    return [CITY.upper(), com["name"].upper(), f"{long_date(m['date'])}, {com['time']}",
            com["where"], ""]


def pdf(lines: list[str]) -> bytes:
    """A plain Helvetica PDF, paginated, that pypdf reads back as text."""
    rows = []
    for line in lines:
        indent = " " * (len(line) - len(line.lstrip()))
        rows += textwrap.wrap(line, 92, subsequent_indent=indent) or [""]
    pages = [rows[i:i + 52] for i in range(0, len(rows), 52)] or [[]]

    def esc(s):
        return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")

    objs = ["<< /Type /Catalog /Pages 2 0 R >>",
            "<< /Type /Pages /Count %d /Kids [%s] >>"
            % (len(pages), " ".join(f"{4 + 2 * i} 0 R" for i in range(len(pages)))),
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"]
    for i, page in enumerate(pages):
        text = "BT /F1 10 Tf 14 TL 56 756 Td " + " ".join(f"({esc(r)}) '" for r in page) + " ET"
        objs += [f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
                 f"/Resources << /Font << /F1 3 0 R >> >> /Contents {5 + 2 * i} 0 R >>",
                 f"<< /Length {len(text)} >>\nstream\n{text}\nendstream"]
    out, offsets = b"%PDF-1.4\n", []
    for n, obj in enumerate(objs, 1):
        offsets.append(len(out))
        # cp1252 is one byte a character, so /Length above counts bytes.
        out += f"{n} 0 obj\n{obj}\nendobj\n".encode("cp1252", "replace")
    xref = len(out)
    out += (f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n"
            + "".join(f"{o:010d} 00000 n \n" for o in offsets)
            + f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n"
            ).encode()
    return out


# -- pages ------------------------------------------------------------
CSS = """
:root{--ink:#1d2a33;--muted:#5b6b75;--brand:#1f5f4a;--line:#d9e1e5;--bg:#eef2f3}
*{box-sizing:border-box}body{margin:0;font:16px/1.55 system-ui,sans-serif;color:var(--ink);background:var(--bg)}
.wrap{max-width:980px;margin:0 auto;padding:0 16px}a{color:var(--brand)}h1,h2,h3{line-height:1.25}
header{background:var(--brand)}header .wrap{display:flex;flex-wrap:wrap;gap:8px 24px;align-items:center;justify-content:space-between;padding:14px 16px}
header a{color:#fff;text-decoration:none}.brand{font-weight:700;font-size:1.25rem}nav{display:flex;flex-wrap:wrap;gap:4px 18px}
main.wrap{background:#fff;padding:24px 16px 48px}.muted{color:var(--muted)}
.grid{display:grid;gap:32px;grid-template-columns:2fr 1fr}@media(max-width:720px){.grid{grid-template-columns:1fr}}
.card{border:1px solid var(--line);border-radius:6px;padding:4px 16px;margin-bottom:16px}
.scroll{overflow-x:auto}table{width:100%;border-collapse:collapse}
th,td{text-align:left;padding:8px;border-bottom:1px solid var(--line);vertical-align:top}
footer{color:var(--muted);font-size:.875rem;padding:24px 0}
"""


def page(title: str, body: str) -> str:
    nav = "".join(f'<a href="{h}">{t}</a>' for h, t in
                  (("/", "Home"), ("/council", "Council &amp; Committees"),
                   ("/meetings", "Agendas &amp; Minutes")))
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>{e(title)} | {CITY}</title><style>{CSS}</style></head><body>
<header><div class="wrap"><a class="brand" href="/">{CITY}</a><nav>{nav}</nav></div></header>
<main class="wrap">{body}</main>
<footer><div class="wrap">Testville is fictional. This site exists to test agenda.delivery, and a
language model writes its agendas, minutes and news.<br>City Hall, 100 Main Street, Testville
&middot; 604-555-0100</div></footer></body></html>"""


def meeting_name(m: dict) -> str:
    return f"{COMMITTEES[m['committee']]['name']}, {long_date(m['date'])}"


def find(mid: int) -> dict:
    m = next((m for m in load()["meetings"] if m["id"] == mid), None)
    if not m:
        abort(404)
    return m


@app.get("/")
def home():
    state = load()
    news = "".join(f"<article><h3>{e(n['headline'])}</h3><p>{e(n['text'])}</p></article>"
                   for n in state["news"]) or "<p class=muted>No news yet.</p>"
    latest = state["meetings"][-1] if state["meetings"] else None
    latest_html = (f'<div class=card><p><a href="/meetings/{latest["id"]}">{e(meeting_name(latest))}'
                   f'</a></p><p><a href="{doc_path(latest, "agenda")}">Agenda (PDF)</a></p></div>'
                   if latest else "<p class=muted>No agendas posted yet.</p>")
    members = "".join(f"<li>{e(c)}</li>" for c in COUNCIL)
    return page("Home", f"""<h1>Welcome to the {CITY}</h1>
<p class=muted>Testville Council meets in the Council Chambers at City Hall. Agendas are posted
here before each meeting and minutes once Council adopts them.</p>
<div class=grid><section><h2>City news</h2>{news}</section>
<aside><h2>Latest agenda</h2>{latest_html}<p><a href="/meetings">All agendas and minutes</a></p>
<h2>Your Council</h2><ul>{members}</ul></aside></div>""")


@app.get("/council")
def council():
    sections = "".join(
        f"""<section class=card><h2>{e(c['name'])}</h2><p>{e(c['about'])}</p>
<p class=muted>Meets at {c['time']} in {e(c['where'])}.</p>
<p><strong>Members:</strong> {e(', '.join(c['members']))}</p>
<p><a href="/meetings?committee={slug}">{e(c['name'])} agendas and minutes</a></p></section>"""
        for slug, c in COMMITTEES.items())
    return page("Council & Committees", f"<h1>Council &amp; Committees</h1>{sections}")


@app.get("/meetings")
def meetings():
    only = request.args.get("committee")
    rows = "".join(
        f"""<tr><td>{e(long_date(m['date']))}</td>
<td><a href="/meetings/{m['id']}">{e(meeting_name(m))}</a></td>
<td><a href="{doc_path(m, 'agenda')}">Agenda (PDF)</a></td>
<td>{f'<a href="{doc_path(m, "minutes")}">Minutes (PDF)</a>' if m['minutes'] else
     '<span class=muted>Not yet adopted</span>'}</td></tr>"""
        for m in reversed(load()["meetings"]) if not only or m["committee"] == only)
    title = COMMITTEES[only]["name"] if only in COMMITTEES else "Agendas & Minutes"
    return page(title, f"""<h1>{e(title)}</h1>
<p class=muted>Agendas are posted before each meeting. Minutes follow once they are adopted.</p>
<div class=scroll><table><thead><tr><th>Date</th><th>Meeting</th><th>Agenda</th><th>Minutes</th>
</tr></thead><tbody>{rows or '<tr><td colspan=4>No meetings posted yet.</td></tr>'}</tbody>
</table></div>""")


@app.get("/meetings/<int:mid>")
def meeting(mid: int):
    m = find(mid)
    com = COMMITTEES[m["committee"]]
    items = "".join(f"<li><h3>{e(t)}</h3>{f'<p>{e(b)}</p>' if b else ''}</li>"
                    for t, b in agenda(m))
    docs = f'<a href="{doc_path(m, "agenda")}">Agenda (PDF)</a>'
    minutes = ""
    if m["minutes"]:
        docs += f' &middot; <a href="{doc_path(m, "minutes")}">Minutes (PDF)</a>'
        minutes = "<h2>Minutes</h2>" + "".join(f"<p>{e(p)}</p>" for p in m["minutes"])
    return page(meeting_name(m), f"""<h1>{e(com['name'])}</h1>
<p class=muted>{e(long_date(m['date']))}, {com['time']}<br>{e(com['where'])}</p>
<p>{docs}</p><h2>Agenda</h2><ol>{items}</ol>{minutes}""")


@app.get("/meetings/<int:mid>/<name>.pdf")
def document(mid: int, name: str):
    m = find(mid)
    if name.endswith("agenda"):
        lines = heading(m) + ["AGENDA", ""]
        for n, (title, body) in enumerate(agenda(m), 1):
            lines += [f"{n}. {title}"] + ([f"    {body}"] if body else []) + [""]
    elif name.endswith("minutes") and m["minutes"]:
        lines = heading(m) + ["MINUTES", ""]
        for para in m["minutes"]:
            lines += [para, ""]
    else:
        abort(404)
    return Response(pdf(lines), mimetype="application/pdf")


# -- controls -------------------------------------------------------
def _authorized() -> bool:
    given = request.headers.get("Authorization", "").encode()
    return bool(TOKEN) and hmac.compare_digest(given, f"Bearer {TOKEN}".encode())


def _brief(m: dict) -> dict:
    return {"id": m["id"], "title": meeting_name(m), "date": m["date"],
            "url": f"{PUBLIC_URL}/meetings/{m['id']}"}


@app.post("/admin/release")
def admin_release():
    if not _authorized():
        abort(401)
    try:
        return jsonify(ok=True, released=_brief(release(request.args.get("committee"))))
    except ValueError as err:
        return jsonify(ok=False, error=str(err)), 400


@app.post("/admin/revert")
def admin_revert():
    if not _authorized():
        abort(401)
    m = revert()
    if not m:
        return jsonify(ok=False, error="nothing to revert"), 409
    return jsonify(ok=True, reverted=_brief(m), forgotten=m["forgotten"])


if __name__ == "__main__":
    if sys.argv[1:2] == ["release"]:
        print(json.dumps(_brief(release(sys.argv[2] if len(sys.argv) > 2 else None))))
    elif sys.argv[1:2] == ["revert"]:
        m = revert()
        print(json.dumps(m and {**_brief(m), "forgotten": m["forgotten"]}))
    else:
        sys.exit(__doc__)
else:
    # Under gunicorn (one worker, so one timer). The CLI above must not start it.
    threading.Thread(target=_timer, daemon=True, name="releases").start()
