"""Scraper Create & Repair Agent — one container, two modes.

Port of src/agents/agents/scraper.ts. Autonomous: crawls, web-searches when
the URL is broken, infers selectors via LLM, saves config, self-verifies, and
fetches the first agenda. The orchestrator routes on job["agent"]
(scraper_create | scraper_repair).
"""
from datetime import datetime, timezone

from agenda_shared.agent import BaseAgent, module_by_slug
from agenda_shared import db, tools
from agenda_shared.llm import complete_json


class _ScraperBase(BaseAgent):
    mode = "create"  # or "repair"

    def run(self, job: dict) -> str:
        slug = job["slug"]
        mod = module_by_slug(slug)
        if not mod:
            raise RuntimeError(f"Module {slug} not found")
        self.module_id = mod["id"]
        repair = self.mode == "repair"

        old_cfg = db.one("SELECT * FROM scrape_config WHERE module_id=%s", (mod["id"],))
        if repair:
            db.execute("UPDATE module SET health='repairing' WHERE id=%s", (mod["id"],))
            start_url = (old_cfg or {}).get("agenda_url") or mod["source_url"]
            self.emit("The agenda page broke. Re-crawling the site to locate the new agenda listing.",
                      "site.crawl", f"old URL: {start_url} no longer works")
        else:
            start_url = mod["source_url"]
            self.emit(f"Crawling {mod['name']} to locate the agenda listing page.",
                      "site.crawl", f"crawling {start_url}")

        crawl = tools.site_crawl(start_url)
        agenda_url = start_url
        links = (crawl.get("data") or {}).get("links") or []
        not_found = (not crawl["ok"]) or (crawl.get("data") or {}).get("notFound") or not links

        if not_found:
            agenda_url, crawl, links = self._search_for_page(mod, agenda_url, links)
        elif not repair:
            self.emit("Found agenda-related links on the site.", "site.crawl", crawl["detail"])
        else:
            self.emit("Found the agenda listing page after re-crawling.", "site.crawl", crawl["detail"])

        html_sample = tools.fetch_html(agenda_url)
        self.emit("Analysing the page structure to determine extraction selectors."
                  if not repair else "Inferring the new page structure and rewriting extraction selectors.",
                  "llm.repair", f"analysing {len(html_sample)} chars of HTML from {agenda_url}")

        cfg = complete_json(
            "You are a scraper configuration agent. Given a website URL and HTML, "
            "determine the best CSS selector to find agenda links. "
            'Respond with JSON: {"agendaUrl":"...","linkSelector":"...","fileTypes":["pdf"],"hints":"..."}',
            f"URL: {agenda_url}\nOld selector: {(old_cfg or {}).get('link_selector', 'none')}\n"
            f"Found links: {', '.join(links[:10])}\nHTML sample:\n{html_sample[:3000]}",
        )
        final_url = cfg.get("agendaUrl") or agenda_url

        self.emit(f"Saving the {'repaired ' if repair else ''}scraping configuration"
                  f"{f' (updated URL: {final_url})' if final_url != mod['source_url'] else '.'}",
                  "db.save_config", f"selector: {cfg.get('linkSelector')}")
        tools.db_save_config(slug, final_url, cfg.get("linkSelector", ""),
                             ",".join(cfg.get("fileTypes") or ["pdf"]), cfg.get("hints", ""))
        if final_url != mod["source_url"]:
            db.execute("UPDATE module SET source_url=%s WHERE id=%s", (final_url, mod["id"]))

        verify = tools.verify_selfcheck(slug)
        self.emit(
            ("Re-ran extraction against the new layout — fix confirmed." if repair
             else "Scrape config verified and ready.") if verify["ok"]
            else "Config saved but verification had issues — will need a repair run.",
            "verify.selfcheck", verify["detail"])

        if verify["ok"]:
            self._fetch_first_agenda(mod, slug, repair)

        if repair:
            db.execute("UPDATE module SET health='healthy', last_checked=now() WHERE id=%s",
                       (mod["id"],))
            return "Module repaired and healthy"
        return "Scrape config created and verified"

    def _search_for_page(self, mod, agenda_url, links):
        domain = tools.extract_domain(mod["source_url"])
        self.emit(f"The known URL ({mod['source_url']}) returned no agenda content. "
                  "Searching the web for the correct page.",
                  "web.search", f"searching for: {mod['name']} council agenda meetings")
        search = tools.web_search(f"{mod['name']} council agenda meetings", site=domain)
        valid = (search.get("data") or {}).get("validUrls") or []
        for cand in valid[:3]:
            self.emit(f"Trying candidate URL: {cand}", "site.crawl", f"crawling {cand}")
            c = tools.site_crawl(cand)
            clinks = (c.get("data") or {}).get("links") or []
            if c["ok"] and clinks:
                self.emit(f"Found the agenda page at {cand} with {len(clinks)} agenda links.",
                          "site.crawl", c["detail"])
                return cand, c, clinks
        # Fall back to ranked links off the root domain.
        root = tools.site_crawl(f"https://{domain}")
        rlinks = (root.get("data") or {}).get("links") or []
        if root["ok"] and rlinks:
            def score(u):
                return (3 if "agenda" in u else 0) + (2 if "meeting" in u else 0) \
                    + (2 if "calendar" in u else 0) + (1 if "council" in u else 0)
            for cand in sorted(rlinks, key=score, reverse=True)[:3]:
                self.emit(f"Following link from root: {cand}", "site.crawl", f"deep-crawling {cand}")
                d = tools.site_crawl(cand)
                dlinks = (d.get("data") or {}).get("links") or []
                if d["ok"] and dlinks:
                    self.emit(f"Found {len(dlinks)} agenda links at {cand}.", "site.crawl", d["detail"])
                    return cand, d, dlinks
        return agenda_url, {"ok": False, "detail": "no agenda page found", "data": {}}, links

    def _fetch_first_agenda(self, mod, slug, repair):
        self.emit("Repair confirmed. Re-fetching the latest agenda to populate the module."
                  if repair else "Scrape config is live. Searching for the first agenda to populate the module.",
                  "agenda.find_latest", f"initial agenda fetch for {slug}")
        found = tools.agenda_find_latest(slug)
        if not found["ok"]:
            self.emit("Could not find an agenda on the first try — the Checking Agent will retry automatically.",
                      "agenda.find_latest", found["detail"])
            return
        d = found["data"]
        title = d.get("meetingTitle")
        if title and title != "Council Meeting":
            mdate = _parse_dt(d.get("meetingDate")) or _now()
            db.execute(
                """INSERT INTO meeting (module_id, date, title, kind, pages, pdf_url, meeting_url)
                   VALUES (%s,%s,%s,'Council Meeting',%s,%s,%s)
                   ON CONFLICT (module_id, date, title) DO NOTHING""",
                (mod["id"], _naive(mdate), title, len(d.get("pdfLinks") or []),
                 (d.get("pdfLinks") or [None])[0], d.get("meetingUrl")))
            self.emit(f'{"Post-repair: found" if repair else "Found"} and recorded '
                      f'"{title}" ({len(d.get("pdfLinks") or [])} PDF links).',
                      "agenda.find_latest", found["detail"])
            # Expose agenda_text; the orchestrator runs summary/keyword/categorize.
            self.output["agenda_text"] = d.get("agendaText", "")
        else:
            self.emit("No specific meeting title found yet — the Checking Agent will populate it next run.",
                      "agenda.find_latest", found["detail"])


class ScraperCreateAgent(_ScraperBase):
    name = "Scraper Agent"
    agent_type = "scraper_create"
    mode = "create"


class ScraperRepairAgent(_ScraperBase):
    name = "Scraper Repair Agent"
    agent_type = "scraper_repair"
    mode = "repair"


def _parse_dt(iso):
    if not iso:
        return None
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        return None


def _naive(dt):
    return dt.astimezone(timezone.utc).replace(tzinfo=None)


def _now():
    return datetime.now(timezone.utc).replace(tzinfo=None)
