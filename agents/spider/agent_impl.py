"""Spider Agent — process the council registry (sources.toml), one per run.

Port of src/agents/agents/spider.ts, minus the direct call to the scraper:
in the container world the orchestrator hands the new module to the scraper.
Returns {slug, module_id, created, candidate_url} in self.output.
"""
import os
import re
import tomllib

from agenda_shared.agent import BaseAgent
from agenda_shared import db, tools

SOURCES_PATH = os.environ.get("SOURCES_PATH", "/app/sources.toml")


def _load_sources() -> list[dict]:
    with open(SOURCES_PATH, "rb") as f:
        data = tomllib.load(f)
    return [s for s in data.get("source", []) if s.get("name") and s.get("url")]


def _slugify(name: str) -> str:
    return re.sub(r"^-+|-+$", "", re.sub(r"[^a-z0-9]+", "-", name.lower()))


class SpiderAgent(BaseAgent):
    name = "Spider Agent"
    agent_type = "spider"

    def run(self, job: dict) -> str:
        # Active (non-growth) mode: find a working agenda page for an existing
        # council that needs help, instead of discovering a new council.
        if job.get("inputs", {}).get("mode") == "active" and job.get("slug"):
            return self._run_active(job["slug"])

        sources = _load_sources()
        existing_names = {r["name"].lower() for r in db.query("SELECT name FROM module")}
        existing_urls = {r["url"].lower() for r in db.query("SELECT url FROM spider_candidate")}

        nxt = next((s for s in sources
                    if s["name"].lower() not in existing_names
                    and s["url"].lower() not in existing_urls), None)
        if not nxt:
            self.emit("All sources from sources.toml have been processed.",
                      None, f"{len(sources)} sources, all processed")
            return "No sources to process"

        self.emit(f"Processing source from sources.toml: {nxt['name']} ({nxt.get('region', '')}).",
                  "site.crawl", f"source URL: {nxt['url']}")

        cand = db.execute(
            """INSERT INTO spider_candidate (name, url, region, source, status)
               VALUES (%s,%s,%s,'sources.toml','queued')
               ON CONFLICT (url) DO NOTHING RETURNING id""",
            (nxt["name"], nxt["url"], nxt.get("region")),
        )
        if not cand:
            self.emit(f"{nxt['name']} is already queued or processed — skipping.",
                      "queue.enqueue", "candidate already exists")
            return f"{nxt['name']} already queued"
        candidate_id = cand["id"]

        self.emit(f"Geolocating {nxt['name']} for the coverage map.",
                  "geo.locate", f"query: {nxt.get('region') or nxt['name']}")
        geo = tools.geo_locate(nxt.get("region") or nxt["name"])
        gd = geo.get("data") or {}
        lat, lng, region = gd.get("lat"), gd.get("lng"), gd.get("region")

        slug = _slugify(nxt["name"])
        gov_type = nxt.get("kind") or "council"
        newmod = db.execute(
            """INSERT INTO module (name, slug, region, source_url, health, followers, lat, lng, gov_type)
               VALUES (%s,%s,%s,%s,'healthy',0,%s,%s,%s)
               ON CONFLICT (slug) DO NOTHING RETURNING id""",
            (nxt["name"], slug, nxt.get("region") or "Unknown", nxt["url"], lat, lng, gov_type),
        )
        if not newmod:
            self.emit(f"{nxt['name']} already exists as a module (slug conflict) — skipping.",
                      "queue.enqueue", "module already exists (slug conflict)")
            db.execute("UPDATE spider_candidate SET status='created' WHERE id=%s", (candidate_id,))
            return f"{nxt['name']} already exists (slug conflict)"

        if lat is not None and lng is not None:
            self.emit(f'Resolved {nxt["name"]} to {region} ({lat}, {lng}). Created module "{slug}".',
                      "geo.locate", geo["detail"])
        else:
            self.emit(f'Created module "{slug}" for {nxt["name"]} (geolocation pending).',
                      "queue.enqueue", f"module slug: {slug}")

        db.execute(
            "UPDATE spider_candidate SET geo=%s, region=%s, status='geo_located' WHERE id=%s",
            (f"{lat},{lng}" if lat is not None and lng is not None else None,
             region or nxt.get("region"), candidate_id))

        self.emit(f"Handing {nxt['name']} to the Scraper Create Agent to find the agenda page.",
                  "queue.enqueue", f"module: {slug}")

        self.output.update({"slug": slug, "module_id": newmod["id"],
                            "created": True, "candidate_url": nxt["url"]})
        return f"Created module for {nxt['name']} — handed to scraper"

    def _run_active(self, slug: str) -> str:
        """Find a better/working agenda page for an existing council. Updates
        module.source_url so the scraper can (re)build a config against it.
        Never creates a new module."""
        mod = db.one("SELECT id, name, region, source_url FROM module WHERE slug = %s", (slug,))
        if not mod:
            return f"Module {slug} not found"

        self.emit(
            f"Active mode: searching for a working agenda page for {mod['name']} "
            "(helping an existing council, not adding a new one).",
            "web.search", f"current source: {mod['source_url']}")

        query = f"{mod['name']} {mod.get('region') or ''} council meeting agendas".strip()
        res = tools.web_search(query)
        urls = (res.get("data") or {}).get("validUrls") or []
        # Don't just re-pick the URL we already know is failing.
        urls = [u for u in urls if u.rstrip("/") != (mod["source_url"] or "").rstrip("/")] or urls
        if not urls:
            self.emit("No working agenda page found this pass — will retry another council next run.",
                      "web.search", res.get("detail", ""))
            return f"No agenda page found for {mod['name']}"

        best = urls[0]
        db.execute("UPDATE module SET source_url = %s, health = 'repairing' WHERE id = %s",
                   (best, mod["id"]))
        self.emit(f'Found a candidate agenda page for {mod["name"]}: {best}. '
                  "Handing to the Scraper to build a config.",
                  "web.search", res.get("detail", ""))

        self.output.update({"slug": slug, "module_id": mod["id"],
                            "created": True, "candidate_url": best, "active": True})
        return f"Updated source for {mod['name']} — handed to scraper"
