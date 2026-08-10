"""Summary Agent — general summary + 3-5 highlights from agenda text.

Port of src/agents/agents/summary.ts. Uses the lighter summary model.
Detects the end-of-meeting marker so it summarizes only the real meeting
body, not trailing appendices in the PDF package.

Job inputs: {"slug": str, "agenda_text": str}
"""

import json

from agenda_shared.agent import BaseAgent, module_by_slug
from agenda_shared import db
from agenda_shared.llm import summarize, complete_json
from agenda_shared.settings import AGENT_MODEL
from agenda_shared.textutil import find_meeting_end, strip_markdown

# Phrases an LLM uses when it's declining/confused rather than actually
# summarizing (e.g. it was handed a nav menu instead of real agenda text,
# same false-positive class the scraper's own _looks_like_a_real_meeting
# gate guards against). Seen live: Calgary's "summary" was literally
# "Please provide the agenda text you would like me to summarize..."
# published verbatim to the public search page. A summary that talks
# ABOUT summarizing, instead of just summarizing, is not a summary.
_REFUSAL_MARKERS = (
    "please provide", "i cannot", "i can't", "i'm unable", "i am unable",
    "as an ai", "does not appear to be", "doesn't appear to be",
    "you would like me to", "rather than a meeting", "no agenda content",
)


def _looks_like_a_real_summary(text: str) -> bool:
    low = text.lower()
    return not any(marker in low for marker in _REFUSAL_MARKERS)


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

        summary_system = self.prompt(
            "You are a concise summarizer for municipal council agendas. "
            "Write EXACTLY 2-4 sentences as ONE flowing paragraph -- like "
            "a short news blurb, not a report. This is displayed as a "
            "single plain-text paragraph with no formatting support, so: "
            "no markdown, no **bold**, no bullet points, no headers. And "
            "just as important -- no labeled sections either, even as "
            "plain text: do NOT write things like 'Topic: detail' one "
            "per line/sentence (e.g. 'Infrastructure: council approved "
            "X. Housing: council discussed Y.'). That is a list wearing "
            "prose's clothes, not prose. Write the way you'd actually "
            "describe the meeting to someone out loud in a few sentences "
            "-- topics flow into each other naturally, not as a labeled "
            "inventory. Focus on the most significant decisions and "
            "discussions. If the text given is not actually meeting/"
            "agenda content (e.g. it's a website navigation menu, an "
            "error page, or otherwise not a meeting), respond with "
            "exactly: NOT_AN_AGENDA -- do not explain why."
        )
        summary_user = body[:8000]
        model_name = self.model() or AGENT_MODEL
        raw_summary = summarize(summary_system, summary_user, model=model_name)
        summary_text = strip_markdown(raw_summary)

        if "NOT_AN_AGENDA" in summary_text or not _looks_like_a_real_summary(summary_text):
            self.emit(
                "The fetched text isn't real agenda content — declining to summarize rather than publish a bad result.",
                "llm.summarize", f"rejected: {summary_text[:120]}",
                prompt=f"SYSTEM:\n{summary_system}\n\nUSER:\n{summary_user}", response=raw_summary,
                model=model_name,
            )
            return "Declined: fetched text was not a real agenda"

        db.execute(
            "UPDATE module SET summary = %s, last_updated = now() WHERE id = %s",
            (summary_text, mod["id"]),
        )
        self.emit("Wrote the general meeting summary.", "llm.summarize",
                  f"{len(summary_text)} chars written",
                  prompt=f"SYSTEM:\n{summary_system}\n\nUSER:\n{summary_user}", response=raw_summary,
                  model=model_name)

        self.emit("Extracting key highlights from the agenda.",
                  "llm.highlights", "extracting 3-5 tagged highlights")

        highlights_system = (
            "You are a highlight extractor for council agendas. Extract 3-5 "
            "significant items. Each has a short tag and one-sentence text. "
            'Respond with JSON: {"highlights":[{"tag":"...","text":"..."}]}'
        )
        highlights_user = f"Extract highlights from:\n{body[:8000]}"
        result = complete_json(highlights_system, highlights_user, model=model_name)
        hls = result.get("highlights") or []

        db.execute("DELETE FROM highlight WHERE module_id = %s", (mod["id"],))
        for i, h in enumerate(hls):
            db.execute(
                "INSERT INTO highlight (module_id, tag, text, sort) VALUES (%s,%s,%s,%s)",
                (mod["id"], strip_markdown(h.get("tag", "")), strip_markdown(h.get("text", "")), i),
            )

        self.emit(f"Wrote general summary and {len(hls)} highlights.",
                  "llm.summarize", f"1 summary + {len(hls)} highlights",
                  prompt=f"SYSTEM:\n{highlights_system}\n\nUSER:\n{highlights_user}",
                  response=json.dumps(result, indent=2), model=model_name)
        return f"Summary: {summary_text[:100]}..."
