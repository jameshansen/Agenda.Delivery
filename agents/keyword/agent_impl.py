"""Keyword Agent — bespoke per-keyword summaries (max 5 per module).

Port of src/agents/agents/keyword.ts.
Job inputs: {"slug": str, "agenda_text": str}
"""
from agenda_shared.agent import BaseAgent, module_by_slug
from agenda_shared import db
from agenda_shared.llm import summarize
from agenda_shared.settings import AGENT_MODEL
from agenda_shared.textutil import find_meeting_end, strip_markdown


class KeywordAgent(BaseAgent):
    name = "Keyword Agent"
    agent_type = "keyword"

    def run(self, job: dict) -> str:
        slug = job["slug"]
        agenda_text = job.get("inputs", {}).get("agenda_text", "") or ""

        mod = module_by_slug(slug)
        if not mod:
            raise RuntimeError(f"Module {slug} not found")
        self.module_id = mod["id"]

        kws = db.query(
            "SELECT * FROM keyword WHERE module_id = %s LIMIT 5", (mod["id"],)
        )
        if not kws:
            self.emit("No tracked keywords for this module — skipping.",
                      None, "0 keywords")
            return "No keywords to summarize"

        body = find_meeting_end(agenda_text)
        self.emit(
            f"Generating bespoke summaries for {len(kws)} tracked keyword"
            f"{'s' if len(kws) > 1 else ''}.",
            "llm.summarize", ", ".join(k["keyword"] for k in kws),
        )

        for kw in kws:
            kw_system = (
                "You are a keyword-focused summarizer for council agendas. "
                f'Focus only on items related to "{kw["keyword"]}". '
                "Write 1-3 sentences highlighting what the agenda says about this "
                "topic, plain running text -- NOT markdown, no **bold**, no "
                "bullet points (this is displayed as a plain paragraph). "
                "If nothing relevant is found, say so briefly."
            )
            kw_user = body[:8000]
            model_name = self.model() or AGENT_MODEL
            raw_kw_summary = summarize(kw_system, kw_user, model=model_name)
            kw_summary = strip_markdown(raw_kw_summary)
            db.execute("UPDATE keyword SET summary = %s WHERE id = %s",
                       (kw_summary, kw["id"]))
            self.emit(f'Summarized "{kw["keyword"]}".',
                      "llm.summarize", f'{kw["followers"]} followers',
                      prompt=f"SYSTEM:\n{kw_system}\n\nUSER:\n{kw_user}", response=raw_kw_summary,
                      model=model_name)

        return f"Generated {len(kws)} keyword summaries"
