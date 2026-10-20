"""Run a module's actions for its newest recorded meeting, as the pipeline does
when it finds a new agenda. Tests delivery without waiting for a council to
publish (TESTING.md):

    docker exec agenda-orchestrator python notify_now.py test-council
"""
import sys

from agenda_shared import db
from agenda_shared.notify import run_automation_rules
from agenda_shared.tools import _pdf_text

slug = sys.argv[1] if len(sys.argv) > 1 else sys.exit(__doc__)
mod = db.one("SELECT id, name, slug, summary FROM module WHERE slug = %s", (slug,))
meeting = mod and db.one(
    "SELECT title, pdf_url FROM meeting WHERE module_id = %s ORDER BY date DESC LIMIT 1",
    (mod["id"],))
if not meeting:
    sys.exit(f"{slug}: no such module, or no meeting recorded yet")
try:
    agenda_text = _pdf_text(meeting["pdf_url"])[0] if meeting["pdf_url"] else ""
except Exception as exc:  # noqa: BLE001 -- link-only meetings still notify
    print(f"agenda text unavailable ({exc}); sending without it")
    agenda_text = ""
run_automation_rules(mod["id"], {
    "module_id": mod["id"], "module_name": mod["name"], "module_slug": mod["slug"],
    "meeting_title": meeting["title"], "agenda_text": agenda_text,
    "summary": mod["summary"] or "",
})
print(f"{mod['name']}: ran its actions for {meeting['title']!r}")
