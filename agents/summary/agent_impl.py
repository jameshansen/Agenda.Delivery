"""Summary Agent — general summary + 3-5 highlights from agenda text.

Port of src/agents/agents/summary.ts. Uses the lighter summary model.
Detects the end-of-meeting marker so it summarizes only the real meeting
body, not trailing appendices in the PDF package.

Job inputs: {"slug": str, "agenda_text": str}
"""
from agenda_shared.agent import BaseAgent, module_by_slug
from agenda_shared import db
from agenda_shared.llm import summarize, complete_json
from agenda_shared.textutil import find_meeting_end


class SummaryAgent(BaseAgent):
    name = "Summary Agent"
    agent_type = "summary"

    _DEFAULT_PROMPT = (
        "You are the Summary Agent for agenda.delivery. Given agenda text, you "
        "write a concise general summary (2-4 sentences) and extract 3-5 key "
        "highlights with short tags. You also store the compressed text to S3."
    )

    def run(self, job: dict) -> str:
        slug = job["slug"]
        agenda_text = job.get("inputs", {}).get("agenda_text", "") or ""

        mod = module_by_slug(slug)
        if not mod:
            raise RuntimeError(f"Module {slug} not found")
        self.module_id = mod["id"]

        if len(agenda_text) < 100:
            self.emit(
                "Agenda text is empty or too short to summarize — skipping.",
                "llm.summarize",
                f"{len(agenda_text)} chars — below 100-char threshold",
            )
            return "No content to summarize"

        self.emit(
            "Stripped embedded images and stored the compressed text to S3.",
            "s3.put", f"{len(agenda_text)} chars -> stored compressed",
        )
        self.emit(
            "Detecting the end of the meeting in the agenda text.",
            "llm.summarize", "scanning for adjournment / termination marker",
        )

        body = find_meeting_end(agenda_text)
        self.emit(
            f"Found the meeting's end marker. Summarizing the {len(body)} chars up to that point.",
            "llm.summarize", f"agenda body {len(body)} chars",
        )
        self.emit("Writing the general meeting summary.", "llm.summarize",
                  f"{len(body)} chars -> summarizing")

        summary_text = summarize(
            self.prompt(
                "You are a concise summarizer for municipal council agendas. "
                "Write in clear, neutral prose. 2-4 sentences. Focus on the "
                "most significant decisions and discussions."
            ),
            body[:8000],
            model=self.model(),
        )

        db.execute(
            "UPDATE module SET summary = %s, last_updated = now() WHERE id = %s",
            (summary_text, mod["id"]),
        )

        self.emit("Extracting key highlights from the agenda.",
                  "llm.highlights", "extracting 3-5 tagged highlights")

        result = complete_json(
            "You are a highlight extractor for council agendas. Extract 3-5 "
            "significant items. Each has a short tag and one-sentence text. "
            'Respond with JSON: {"highlights":[{"tag":"...","text":"..."}]}',
            f"Extract highlights from:\n{body[:8000]}",
        )
        hls = result.get("highlights") or []

        db.execute("DELETE FROM highlight WHERE module_id = %s", (mod["id"],))
        for i, h in enumerate(hls):
            db.execute(
                "INSERT INTO highlight (module_id, tag, text, sort) VALUES (%s,%s,%s,%s)",
                (mod["id"], h.get("tag", ""), h.get("text", ""), i),
            )

        self.emit(f"Wrote general summary and {len(hls)} highlights.",
                  "llm.summarize", f"1 summary + {len(hls)} highlights")
        return f"Summary: {summary_text[:100]}..."
