"""Self-check: release, revert, and the PDFs the agents read back.

Runs offline: with no OLLAMA_BASE_URL the model call fails over to the stock
agenda items, and with no DATABASE_URL a revert leaves agenda.delivery alone.

    python testcouncil/test_app.py
"""
import json
import os
import sys
import tempfile
import time
from io import BytesIO

here = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [here, os.path.join(here, "..", "agents", "base")]
state = os.path.join(tempfile.mkdtemp(), "state.json")
os.environ.update(TESTCOUNCIL_STATE=state, TESTCOUNCIL_TOKEN="t", OLLAMA_BASE_URL="",
                  DATABASE_URL="")
with open(state, "w") as f:  # a recent release keeps the timer thread idle
    json.dump({"next_id": 1, "released_at": time.time(), "news": [], "meetings": []}, f)

import app  # noqa: E402
from pypdf import PdfReader  # noqa: E402

client = app.app.test_client()
first = app.release()
second = app.release("public-hearing")
meetings = app.load()["meetings"]
assert [m["committee"] for m in meetings] == ["regular-council", "public-hearing"]
assert meetings[0]["minutes"] and meetings[1]["minutes_for"] == first["id"]

listing = client.get("/meetings").get_data(as_text=True)
assert app.doc_path(second, "agenda") in listing and app.doc_path(first, "minutes") in listing
pdf = client.get(app.doc_path(second, "agenda")).data
text = PdfReader(BytesIO(pdf)).pages[0].extract_text()
assert "PUBLIC HEARING" in text and second["items"][0]["title"] in text, text
assert "Adjournment" in text, text
long_pdf = PdfReader(BytesIO(app.pdf([f"Line {n} (with parens) \\ and a café" for n in range(130)])))
assert len(long_pdf.pages) == 3 and "Line 129 (with parens)" in long_pdf.pages[2].extract_text()

assert client.post("/admin/release").status_code == 401
assert client.post("/admin/revert", headers={"Authorization": "Bearer t"}).json["reverted"]["id"] == 2
meetings = app.load()["meetings"]
assert len(meetings) == 1 and meetings[0]["minutes"] is None
assert client.get(app.doc_path(first, "minutes")).status_code == 404
assert app.release()["id"] == 3  # ids are never reused, so a re-release gets fresh URLs
print("testcouncil self-check passed")
