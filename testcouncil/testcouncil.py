#!/usr/bin/env python3
"""A pretend municipality for testing agenda.delivery's agents end to end.

Each copy serves one made-up council on a loopback port, with five meeting types, agenda PDFs
whose bylaws move through their readings from meeting to meeting, and three site layouts.
Switching layout moves every page and file, which breaks whatever an agent learned about the
site, so it tests noticing the break and repairing it. Standard library only.

    python3 testcouncil.py serve --name "City of Testville" --port 8091 --state /var/lib/agenda/testcouncil/testville.json
    curl http://127.0.0.1:8091/admin/release                 # post the next meeting
    curl http://127.0.0.1:8091/admin/release/public-hearing  # post a given type
    curl http://127.0.0.1:8091/admin/layout/2                # redesign the site (1, 2 or 3)
    curl http://127.0.0.1:8091/admin/reset                   # back to the starting meetings, layout 1

Layout 1: a meetings table at /meetings, each row linking its agenda PDF directly.
Layout 2: a calendar at /council-calendar; each meeting has its own page holding the PDF link.
Layout 3: /meeting-portal, where the meeting list is drawn by a script (needs a real browser).
"""
import argparse
import html
import json
import os
import random
import textwrap
import threading
from datetime import date, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TYPES = {
    "regular": ("Regular Council Meeting", "7:00 pm"),
    "special": ("Special Council Meeting", "5:00 pm"),
    "cow": ("Committee of the Whole", "3:00 pm"),
    "hearing": ("Public Hearing", "7:00 pm"),
    "apc": ("Advisory Planning Commission", "6:00 pm"),
}
ALIASES = {"public-hearing": "hearing", "committee-of-the-whole": "cow", "advisory-planning-commission": "apc",
           "regular-council": "regular", "special-council": "special"}
# Most meetings are regular council meetings, with the other bodies in between, as on a real site.
ROTATION = ["regular", "hearing", "regular", "cow", "regular", "special", "regular", "apc"]
STREETS = ["Main Street", "Fraser Highway", "8 Avenue", "Glover Road", "200 Street", "Willow Lane", "Ridge Road", "Harbour Drive"]


class Council:
    def __init__(self, name: str, state_path: str, seed: int):
        self.name, self.path, self.seed = name, state_path, seed
        self.lock = threading.Lock()
        self.state = self.load()

    # ---- state -------------------------------------------------------------------
    def load(self) -> dict:
        try:
            with open(self.path) as f:
                return json.load(f)
        except (OSError, ValueError):
            return self.fresh()

    def save(self) -> None:
        os.makedirs(os.path.dirname(os.path.abspath(self.path)), exist_ok=True)
        tmp = self.path + ".tmp"
        with open(tmp, "w") as f:
            json.dump(self.state, f, indent=1)
        os.replace(tmp, self.path)

    def fresh(self) -> dict:
        start = date(2026, 11, 2)
        st = {"layout": 1, "meetings": [], "next_bylaw": 7001 + self.seed * 100}
        for i, t in enumerate(["regular", "hearing", "regular", "cow", "regular", "special"]):
            self._add(st, t, start + timedelta(days=3 * i))
        return st

    def _add(self, st: dict, kind: str, day: date) -> dict:
        mid = len(st["meetings"]) + 1
        rnd = random.Random(self.seed * 1000 + mid)
        items = self._items(st, kind, rnd)
        m = {"id": mid, "type": kind, "date": day.isoformat(), "items": items}
        st["meetings"].append(m)
        return m

    def _items(self, st: dict, kind: str, rnd: random.Random) -> list:
        """Agenda items. Each regular meeting introduces a bylaw at first and second reading, gives the
        previous one third reading and adopts the one before, so pending items move between meetings."""
        def addr():
            return f"{rnd.randint(1, 299) * 100 + rnd.randint(1, 99)} {rnd.choice(STREETS)}"
        regulars = [m for m in st["meetings"] if m["type"] == "regular"]
        if kind == "regular":
            n = st["next_bylaw"]; st["next_bylaw"] += 1
            items = ["Adoption of the agenda", "Adoption of the minutes of the previous Regular Council Meeting",
                     f"Delegation: residents of {rnd.choice(STREETS)} on traffic calming",
                     f"Bylaw No. {n}, Zoning Amendment ({addr()}, from RS-1 to RM-2 for {rnd.randint(4, 40)} townhomes): first and second reading",
                     f"Report 26-{rnd.randint(10, 99)}: {rnd.choice(['Sidewalk program', 'Water main renewal', 'Parks master plan', 'Transit priority study'])}, "
                     f"${rnd.randint(2, 90) * 10_000:,} from reserves, staff recommend approval"]
            if len(regulars) >= 1:
                items.append(f"Bylaw No. {n - 1}, Zoning Amendment: third reading, following the public hearing")
            if len(regulars) >= 2:
                items.append(f"Bylaw No. {n - 2}, Zoning Amendment: final adoption")
            items.append(f"Motion: that staff report back on {rnd.choice(['a tree protection bylaw', 'secondary suites', 'a parking strategy', 'e-bike share'])} within 90 days")
            return items
        if kind == "hearing":
            n = st["next_bylaw"] - 1
            return [f"Bylaw No. {n}, Zoning Amendment at {addr()}: residents may speak or write in before the hearing closes",
                    "Written submissions received", "Close of the public hearing"]
        if kind == "special":
            return [f"{rnd.choice(['2027 operating budget', '2027 capital plan', 'Fire hall replacement'])}: presentation and discussion",
                    "Motion to close the meeting to the public under section 90 of the Community Charter (land and legal matters)"]
        if kind == "cow":
            return [f"Presentation: {rnd.choice(['Active transportation plan update', 'Housing needs report', 'Climate action strategy'])}",
                    f"Delegation: {rnd.choice(['Chamber of Commerce', 'Youth Council', 'Seniors Network'])}",
                    "Recommendations to the next Regular Council Meeting"]
        return [f"Development Permit DP 26-{rnd.randint(10, 99)} at {addr()}: {rnd.randint(3, 12)} storey mixed use building",
                f"Rezoning RZ 26-{rnd.randint(10, 99)} at {addr()}: recommendation to Council"]

    # ---- admin -------------------------------------------------------------------
    def release(self, kind: str | None) -> dict:
        with self.lock:
            kind = ALIASES.get(kind or "", kind) or ROTATION[len(self.state["meetings"]) % len(ROTATION)]
            if kind not in TYPES:
                raise ValueError(f"unknown meeting type {kind}")
            last = date.fromisoformat(self.state["meetings"][-1]["date"])
            m = self._add(self.state, kind, last + timedelta(days=3))
            self.save()
            return m

    def set_layout(self, n: int) -> None:
        with self.lock:
            self.state["layout"] = n
            self.save()

    def reset(self) -> None:
        with self.lock:
            self.state = self.fresh()
            self.save()

    # ---- documents ---------------------------------------------------------------
    def agenda_pdf(self, m: dict) -> bytes:
        name, time = TYPES[m["type"]]
        lines = [self.name.upper(), f"{name.upper()} AGENDA", f"{long_date(m['date'])} at {time}",
                 "Council Chambers, City Hall", ""]
        lines += [f"{chr(65 + i)}. {it}" for i, it in enumerate(m["items"])]
        lines += ["", "Members of the public may speak to agenda items by signing the speakers list before the meeting."]
        return pdf(lines)

    def find(self, mid: int) -> dict | None:
        return next((m for m in self.state["meetings"] if m["id"] == mid), None)


def long_date(iso: str) -> str:
    d = date.fromisoformat(iso)
    return d.strftime("%A, %B ") + str(d.day) + d.strftime(", %Y")


def pdf(lines: list) -> bytes:
    """A plain Helvetica PDF that pdftotext reads back as text."""
    rows = []
    for line in lines:
        rows += textwrap.wrap(line, 92) or [""]
    pages = [rows[i:i + 52] for i in range(0, len(rows), 52)] or [[]]

    def esc(s):
        return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")

    objs = ["<< /Type /Catalog /Pages 2 0 R >>",
            "<< /Type /Pages /Count %d /Kids [%s] >>" % (len(pages), " ".join(f"{4 + 2 * i} 0 R" for i in range(len(pages)))),
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"]
    for i, page in enumerate(pages):
        text = "BT /F1 10 Tf 14 TL 56 756 Td " + " ".join(f"({esc(r)}) '" for r in page) + " ET"
        objs += [f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents {5 + 2 * i} 0 R >>",
                 f"<< /Length {len(text)} >>\nstream\n{text}\nendstream"]
    out, offsets = b"%PDF-1.4\n", []
    for n, obj in enumerate(objs, 1):
        offsets.append(len(out))
        out += f"{n} 0 obj\n{obj}\nendobj\n".encode("cp1252", "replace")
    xref = len(out)
    out += (f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n" + "".join(f"{o:010d} 00000 n \n" for o in offsets)
            + f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n").encode()
    return out


# ---- pages -------------------------------------------------------------------------

def page(c: Council, title: str, body: str) -> str:
    layout = c.state["layout"]
    agendas = {1: ("/meetings", "Agendas &amp; Minutes"), 2: ("/council-calendar", "Council Calendar"),
               3: ("/meeting-portal", "Meeting Portal")}[layout]
    nav = "".join(f'<a href="{h}">{t}</a> ' for h, t in (("/", "Home"), ("/news", "News"), agendas, ("/contact", "Contact")))
    return (f"<!doctype html><html><head><meta charset=utf-8><title>{html.escape(title)} | {html.escape(c.name)}</title></head>"
            f"<body><header><strong>{html.escape(c.name)}</strong><nav>{nav}</nav></header>"
            f"<main><h1>{html.escape(title)}</h1>{body}</main><footer>{html.escape(c.name)}, City Hall, 100 Main Street</footer></body></html>")


def meeting_title(m: dict) -> str:
    return f"{TYPES[m['type']][0]}, {long_date(m['date'])}"


def make_handler(c: Council):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def send(self, code: int, body, ctype="text/html; charset=utf-8"):
            data = body if isinstance(body, bytes) else body.encode()
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def not_found(self):
            self.send(404, page(c, "Page not found", '<p>Sorry, we couldn\'t find that page. It may have moved. <a href="/">Go to the home page</a>.</p>'))

        def do_GET(self):
            path = self.path.split("?")[0].rstrip("/") or "/"
            layout = c.state["layout"]
            meetings = sorted(c.state["meetings"], key=lambda m: m["date"], reverse=True)
            if path.startswith("/admin/"):
                return self.admin(path)
            if path == "/":
                return self.send(200, page(c, c.name, "<p>Welcome to the official website. Council meeting agendas are posted the week before each meeting.</p>"))
            if path in ("/news", "/contact"):
                return self.send(200, page(c, path[1:].title(), "<p>Nothing new this week.</p>"))

            if layout == 1:
                if path == "/meetings":
                    rows = "".join(f"<tr><td>{m['date']}</td><td>{TYPES[m['type']][0]}</td>"
                                   f"<td><a href=\"/files/agenda-{m['id']}.pdf\">Agenda (PDF)</a></td></tr>" for m in meetings)
                    return self.send(200, page(c, "Agendas & Minutes", f"<table><tr><th>Date</th><th>Meeting</th><th>Documents</th></tr>{rows}</table>"))
                if path.startswith("/files/agenda-") and path.endswith(".pdf"):
                    return self.pdf(path[len("/files/agenda-"):-4])
            elif layout == 2:
                if path == "/council-calendar":
                    cards = "".join(f"<div class=card><h3>{html.escape(meeting_title(m))}</h3><p>{TYPES[m['type']][1]}, Council Chambers</p>"
                                    f"<a href=\"/calendar/meeting/{m['id']}\">View meeting details</a></div>" for m in meetings)
                    return self.send(200, page(c, "Council Calendar", cards))
                if path.startswith("/calendar/meeting/"):
                    m = c.find(int(path.rsplit("/", 1)[1])) if path.rsplit("/", 1)[1].isdigit() else None
                    if m:
                        return self.send(200, page(c, meeting_title(m),
                                                   f"<p>Location: Council Chambers. Starts at {TYPES[m['type']][1]}.</p>"
                                                   f"<ul><li><a href=\"/docs/{m['id']}/agenda-package.pdf\">Agenda Package (PDF)</a></li></ul>"))
                if path.startswith("/docs/") and path.endswith("/agenda-package.pdf"):
                    return self.pdf(path.split("/")[2])
            else:
                if path == "/meeting-portal":
                    script = ("<div id=app>Loading meetings...</div><script>fetch('/api/meetings').then(r=>r.json()).then(ms=>{"
                              "document.getElementById('app').innerHTML=ms.map(m=>`<p>${m.title} <a href=\"/portal/file/${m.id}\">Agenda</a></p>`).join('')})</script>")
                    return self.send(200, page(c, "Meeting Portal", script))
                if path == "/api/meetings":
                    return self.send(200, json.dumps([{"id": m["id"], "title": meeting_title(m)} for m in meetings]), "application/json")
                if path.startswith("/portal/file/"):
                    return self.pdf(path.rsplit("/", 1)[1])
            return self.not_found()

        def pdf(self, mid: str):
            m = c.find(int(mid)) if mid.isdigit() else None
            return self.send(200, c.agenda_pdf(m), "application/pdf") if m else self.not_found()

        def admin(self, path: str):
            parts = path.split("/")[2:]
            try:
                if parts[0] == "release":
                    m = c.release(parts[1] if len(parts) > 1 else None)
                    return self.send(200, json.dumps({"released": meeting_title(m), "id": m["id"]}), "application/json")
                if parts[0] == "layout" and len(parts) > 1 and parts[1] in ("1", "2", "3"):
                    c.set_layout(int(parts[1]))
                    return self.send(200, json.dumps({"layout": int(parts[1])}), "application/json")
                if parts[0] == "reset":
                    c.reset()
                    return self.send(200, json.dumps({"reset": True}), "application/json")
                if parts[0] == "state":
                    return self.send(200, json.dumps({"layout": c.state["layout"], "meetings": [meeting_title(m) for m in c.state["meetings"]]}), "application/json")
            except ValueError as e:
                return self.send(400, json.dumps({"error": str(e)}), "application/json")
            return self.not_found()

    return Handler


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["serve"])
    ap.add_argument("--name", default="City of Testville")
    ap.add_argument("--port", type=int, default=8091)
    ap.add_argument("--state", required=True)
    ap.add_argument("--seed", type=int, default=1)
    a = ap.parse_args()
    c = Council(a.name, a.state, a.seed)
    c.save()
    # Loopback only: the admin endpoints have no password.
    ThreadingHTTPServer(("127.0.0.1", a.port), make_handler(c)).serve_forever()


if __name__ == "__main__":
    main()
