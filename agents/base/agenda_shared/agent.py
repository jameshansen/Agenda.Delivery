"""Base agent + Flask app factory.

Contract (orchestrator -> agent):
    POST /run   body: {"run_id", "agent", "module_id"?, "slug"?, "trigger",
                       "inputs": {...}}
                -> 200 {"ok": true, "result": "..."}  or  500 {"ok": false, "error"}
    GET  /health -> {"ok": true, "agent": "..."}

The orchestrator owns the agent_run lifecycle (creates the row, marks it
completed/failed). An agent only: emits events, does the work, writes app
results to Postgres, and returns a short result string.
"""
from flask import Flask, request, jsonify

from . import db
from .bus import emit_event


class BaseAgent:
    name: str = "Agent"          # display name, stored on agent_event.agent
    agent_type: str = "agent"    # agent_type enum value

    def __init__(self):
        self.run_id: str | None = None
        self.module_id: str | None = None
        # Structured output the orchestrator reads back (e.g. the Checking
        # Agent's extracted agenda_text, which downstream agents consume).
        self.output: dict = {}

    # -- config (editable in admin panel) ----------------------
    def config(self) -> dict:
        """Load this agent's editable row from agent_config (or {})."""
        row = db.one("SELECT * FROM agent_config WHERE agent = %s", (self.agent_type,))
        return row or {}

    def prompt(self, fallback: str) -> str:
        return self.config().get("system_prompt") or fallback

    def model(self, fallback: str | None = None) -> str | None:
        return self.config().get("model") or fallback

    # -- events ------------------------------------------------
    def emit(self, action: str, tool: str | None = None, detail: str | None = None,
             screenshot: str | None = None, prompt: str | None = None,
             response: str | None = None, model: str | None = None):
        emit_event(self.run_id, self.name, action, tool, detail, self.module_id,
                   screenshot, prompt, response, model)

    # -- subclass entry point ----------------------------------
    def run(self, job: dict) -> str:
        raise NotImplementedError

    # -- internal: wire up run context then dispatch -----------
    def _dispatch(self, job: dict) -> str:
        self.run_id = job.get("run_id")
        self.module_id = job.get("module_id")
        return self.run(job)


def module_by_slug(slug: str) -> dict | None:
    return db.one("SELECT * FROM module WHERE slug = %s", (slug,))


def create_agent_app(agent_class) -> Flask:
    """Build the Flask app for an agent container. Run with gunicorn app:app."""
    app = Flask(__name__)

    @app.post("/run")
    def run():
        job = request.get_json(force=True, silent=True) or {}
        agent = agent_class()  # fresh instance per request — no shared run state
        try:
            result = agent._dispatch(job)
            return jsonify(ok=True, result=result, data=agent.output)
        except Exception as e:  # noqa: BLE001 — report every failure to orchestrator
            return jsonify(ok=False, error=str(e)), 500

    @app.get("/health")
    def health():
        return jsonify(ok=True, agent=agent_class.name)

    return app
