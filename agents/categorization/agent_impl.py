"""Categorization Agent — classify the latest meeting's kind.

Port of src/agents/agents/categorization.ts. Updates the `kind` of the most
recent meeting (created by the Checking Agent); never creates a new row.
Job inputs: {"slug": str, "agenda_text": str}
"""
from agenda_shared.agent import BaseAgent, module_by_slug
from agenda_shared import db
from agenda_shared.llm import complete_json


class CategorizationAgent(BaseAgent):
    name = "Categorization Agent"
    agent_type = "categorization"

    def run(self, job: dict) -> str:
        slug = job["slug"]
        agenda_text = job.get("inputs", {}).get("agenda_text", "") or ""

        mod = module_by_slug(slug)
        if not mod:
            raise RuntimeError(f"Module {slug} not found")
        self.module_id = mod["id"]

        self.emit("Categorizing the agenda type from the title and content.",
                  "llm.summarize", "classifying meeting type")

        latest = db.one(
            "SELECT * FROM meeting WHERE module_id = %s ORDER BY date DESC LIMIT 1",
            (mod["id"],),
        )
        meeting_title = (latest or {}).get("title") or mod["name"]

        result = complete_json(
            "You are a meeting categorization assistant. Given an agenda title "
            "and content, classify it into one of: Council Meeting, Committee "
            "Meeting, Public Hearing, Special Meeting, Workshop, Board Meeting. "
            'Respond with JSON: {"kind":"...","confidence":0.0-1.0}',
            f"Title: {meeting_title}\nAgenda title for categorization:\n{agenda_text[:2000]}",
            model=self.model(),
        )
        kind = result.get("kind", "Council Meeting")
        conf = result.get("confidence", 0.9)

        if latest:
            db.execute("UPDATE meeting SET kind = %s WHERE id = %s",
                       (kind, latest["id"]))
            self.emit(f'Categorized "{latest["title"]}" as "{kind}" (confidence {conf}).',
                      "llm.summarize", f"category: {kind}")
        else:
            self.emit(f'Categorized as "{kind}" (confidence {conf}) — no meeting row to update.',
                      "llm.summarize", f"category: {kind}")

        return f"Categorized as {kind}"
