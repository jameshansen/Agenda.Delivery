"""Headless renderer — renders JS-heavy council pages to HTML.

Many council sites (SPAs, eSCRIBE/iCompass calendars) load their meeting list
via JavaScript, so static fetch sees only an app shell. The scraper/checking
agents call this as a fallback to get the real, rendered HTML.

Contract:
    POST /render {"url": str, "wait_ms"?: int} -> {"ok", "html", "final_url"}
    GET  /health -> {"ok": true}
"""
import ipaddress
import socket
import threading
from urllib.parse import urlparse

from flask import Flask, request, jsonify
from playwright.sync_api import TimeoutError as PlaywrightTimeout, sync_playwright

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
    """The worker's Chromium, relaunched if it has crashed: before, one crash
    failed every render in the worker until a restart."""
    global _pw, _browser
    if _browser is None or not _browser.is_connected():
        _pw = _pw or sync_playwright().start()
        _browser = _pw.chromium.launch(
            args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"]
        )
    return _browser


def _public_host(host: str, seen: dict) -> bool:
    """Every address `host` resolves to is on the public internet. Council
    pages are untrusted, and this container sits on the Docker network."""
    if host not in seen:
        try:
            infos = socket.getaddrinfo(host, None)
            seen[host] = bool(infos) and all(
                ipaddress.ip_address(i[4][0].split("%")[0]).is_global for i in infos)
        except (OSError, UnicodeError, ValueError):
            seen[host] = False
    return seen[host]


def _allowed(url: str, seen: dict) -> bool:
    parts = urlparse(url)
    if parts.scheme in ("data", "blob", "about"):
        return True  # no network
    return parts.scheme in ("http", "https") and _public_host(parts.hostname or "", seen)


@app.post("/render")
def render():
    data = request.get_json(force=True, silent=True) or {}
    url = data.get("url")
    wait_ms = int(data.get("wait_ms", 2500))
    if not url:
        return jsonify(ok=False, error="no url"), 400

    seen: dict = {}
    if not _allowed(url, seen):
        return jsonify(ok=False, error=f"refused a non-public address: {url}"), 400

    with _lock:
        ctx = None
        try:
            ctx = _browser_instance().new_context(user_agent=USER_AGENT)
            # Every request the page makes, redirects and subresources too.
            ctx.route("**/*", lambda route: route.continue_() if _allowed(route.request.url, seen)
                      else route.abort())
            page = ctx.new_page()
            page.goto(url, wait_until="load", timeout=30000)
            try:
                page.wait_for_load_state("networkidle", timeout=15000)
            except PlaywrightTimeout:
                pass  # a long-polling page never goes idle; what loaded is enough
            page.wait_for_timeout(wait_ms)
            return jsonify(ok=True, html=page.content(), final_url=page.url)
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
