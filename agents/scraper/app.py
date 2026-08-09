"""Scraper container — routes on job["agent"]: scraper_create | scraper_repair."""
from flask import Flask, request, jsonify

from agent_impl import ScraperCreateAgent, ScraperRepairAgent

_CLASSES = {
    "scraper_create": ScraperCreateAgent,
    "scraper_repair": ScraperRepairAgent,
}

app = Flask(__name__)


@app.post("/run")
def run():
    job = request.get_json(force=True, silent=True) or {}
    cls = _CLASSES.get(job.get("agent"), ScraperCreateAgent)
    agent = cls()
    try:
        result = agent._dispatch(job)
        return jsonify(ok=True, result=result, data=agent.output)
    except Exception as e:  # noqa: BLE001
        return jsonify(ok=False, error=str(e)), 500


@app.get("/health")
def health():
    return jsonify(ok=True, agent="Scraper Agent")
