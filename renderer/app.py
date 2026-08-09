"""Headless renderer — renders JS-heavy council pages to HTML.

Many council sites (SPAs, eSCRIBE/iCompass calendars) load their meeting list
via JavaScript, so static fetch sees only an app shell. The scraper/checking
agents call this as a fallback to get the real, rendered HTML.

Contract:
    POST /render {"url": str, "wait_ms"?: int} -> {"ok", "html", "final_url"}
    GET  /health -> {"ok": true}
"""
import threading

from flask import Flask, request, jsonify
from playwright.sync_api import sync_playwright

app = Flask(__name__)

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like "
    "Gecko) Chrome/120.0.0.0 Safari/537.36 AgendaDelivery/1.0"
)

_pw = None
_browser = None
# sync Playwright is not thread-safe; serialize use within a worker process.
_lock = threading.Lock()


def _browser_instance():
    global _pw, _browser
    if _browser is None:
        _pw = sync_playwright().start()
        _browser = _pw.chromium.launch(
            args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"]
        )
    return _browser


@app.post("/render")
def render():
    data = request.get_json(force=True, silent=True) or {}
    url = data.get("url")
    wait_ms = int(data.get("wait_ms", 2500))
    if not url:
        return jsonify(ok=False, error="no url"), 400

    with _lock:
        ctx = None
        try:
            page = (ctx := _browser_instance().new_context(user_agent=USER_AGENT)).new_page()
            page.goto(url, wait_until="networkidle", timeout=30000)
            page.wait_for_timeout(wait_ms)
            html = page.content()
            final_url = page.url
            return jsonify(ok=True, html=html, final_url=final_url)
        except Exception as e:  # noqa: BLE001
            return jsonify(ok=False, error=str(e)), 500
        finally:
            if ctx is not None:
                try:
                    ctx.close()
                except Exception:
                    pass


@app.get("/health")
def health():
    return jsonify(ok=True)
