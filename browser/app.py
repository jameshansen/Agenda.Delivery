import base64
import io
import os
import time
import threading
import uuid

from flask import Flask, request, jsonify
from PIL import Image

import undetected_chromedriver as uc
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.common.exceptions import (
    NoSuchElementException,
    WebDriverException,
    StaleElementReferenceException,
)

app = Flask(__name__)

SESSIONS = {}
GLOBAL_LOCK = threading.Lock()

CHROME_BIN = os.environ.get("CHROME_BIN")
CHROMEDRIVER_PATH = os.environ.get("CHROMEDRIVER_PATH")


def _make_driver():
    # Headful (not headless/--headless=new) under the entrypoint's Xvfb
    # display: real rendering pipeline is a stronger anti-detection signal
    # than either headless mode against Cloudflare-class bot checks.
    options = uc.ChromeOptions()
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-gpu")
    options.add_argument("--window-size=1280,1600")
    if CHROME_BIN:
        options.binary_location = CHROME_BIN
    kwargs = {"options": options}
    if CHROMEDRIVER_PATH:
        kwargs["driver_executable_path"] = CHROMEDRIVER_PATH
    driver = uc.Chrome(**kwargs)
    driver.set_page_load_timeout(60)
    return driver


def _parse_ref(ref):
    if not isinstance(ref, str):
        raise ValueError("ref must be a string")
    parts = ref.split(".")
    if not parts:
        raise ValueError("empty ref")
    last = parts[-1]
    if not last.startswith("e"):
        raise ValueError("last segment must start with 'e'")
    local_idx = int(last[1:])
    frame_path = [int(p) for p in parts[:-1]]
    return frame_path, local_idx


def _goto_frame(driver, frame_path):
    driver.switch_to.default_content()
    if not frame_path:
        return
    for idx in frame_path:
        frames = driver.find_elements(By.CSS_SELECTOR, "iframe, frame")
        if idx < 0 or idx >= len(frames):
            raise IndexError("frame index out of range: %d (have %d)" % (idx, len(frames)))
        driver.switch_to.frame(frames[idx])


def _iter_frame_tree(driver, max_depth=3, max_total=40):
    visited = {"count": 0}

    def walk(path):
        if visited["count"] >= max_total:
            return
        if len(path) > max_depth:
            return
        visited["count"] += 1
        yield list(path)

        # Enumerate children at current context (we are currently switched into path).
        if len(path) >= max_depth:
            return
        if visited["count"] >= max_total:
            return
        try:
            frames = driver.find_elements(By.CSS_SELECTOR, "iframe, frame")
        except Exception:
            return
        n = len(frames)
        for i in range(n):
            if visited["count"] >= max_total:
                return
            # Switch into child i from current context.
            try:
                driver.switch_to.frame(i)
            except Exception:
                # Skip this subtree, restore current context before trying next sibling.
                try:
                    driver.switch_to.default_content()
                    for idx in path:
                        f = driver.find_elements(By.CSS_SELECTOR, "iframe, frame")
                        driver.switch_to.frame(f[idx])
                except Exception:
                    return
                continue

            try:
                yield from walk(path + [i])
            except Exception:
                pass

            # Restore current context from scratch.
            try:
                driver.switch_to.default_content()
                for idx in path:
                    f = driver.find_elements(By.CSS_SELECTOR, "iframe, frame")
                    if idx >= len(f):
                        return
                    driver.switch_to.frame(f[idx])
            except Exception:
                return

    # Start at top.
    driver.switch_to.default_content()
    yield from walk([])


_JS_STATE = r"""
(function(){
  var sels = ['a[href]','button','input','select','textarea','[role="button"]','[onclick]','[tabindex]'];
  var set = new Set();
  var out = [];
  for (var si=0; si<sels.length; si++){
    var els = document.querySelectorAll(sels[si]);
    for (var i=0; i<els.length; i++){
      var el = els[i];
      if (set.has(el)) continue;
      set.add(el);
      var r = el.getBoundingClientRect();
      var style = window.getComputedStyle(el);
      if (r.width <= 0 || r.height <= 0) continue;
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      if (style.opacity === '0') continue;
      var tag = el.tagName.toLowerCase();
      if ((tag === 'button' || tag === 'input' || tag === 'select' || tag === 'textarea') && el.disabled) continue;
      if (el.getAttribute('aria-hidden') === 'true') continue;
      if (el.getAttribute('tabindex') === '-1' && tag !== 'a' && tag !== 'button' && tag !== 'input' && tag !== 'select' && tag !== 'textarea' && !el.hasAttribute('onclick') && el.getAttribute('role') !== 'button') continue;
      var text = (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('title') || '').replace(/\s+/g,' ').trim();
      if (text.length > 100) text = text.slice(0,100);
      var idx = out.length;
      el.setAttribute('data-agx', String(idx));
      out.push({idx: idx, tag: tag, text: text, href: el.href || ''});
    }
  }
  return out;
})();
"""


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"ok": True, "sessions": len(SESSIONS)})


@app.route("/session", methods=["POST"])
def create_session():
    with GLOBAL_LOCK:
        sid = str(uuid.uuid4())
        try:
            driver = _make_driver()
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)}), 500
        SESSIONS[sid] = {"driver": driver, "lock": threading.Lock(), "frame_map": {}}
        return jsonify({"ok": True, "session_id": sid})


@app.route("/session/<sid>", methods=["DELETE"])
def delete_session(sid):
    with GLOBAL_LOCK:
        entry = SESSIONS.pop(sid, None)
    if not entry:
        return jsonify({"ok": False, "error": "no such session"}), 404
    with entry["lock"]:
        try:
            entry["driver"].quit()
        except Exception:
            pass
    return jsonify({"ok": True})


@app.route("/session/<sid>/goto", methods=["POST"])
def goto(sid):
    with GLOBAL_LOCK:
        entry = SESSIONS.get(sid)
    if not entry:
        return jsonify({"ok": False, "error": "no such session"}), 404
    data = request.get_json(silent=True) or {}
    url = data.get("url")
    if not url:
        return jsonify({"ok": False, "error": "missing url"}), 400
    with entry["lock"]:
        try:
            entry["driver"].get(url)
            entry["frame_map"] = {}
            entry["driver"].switch_to.default_content()
            return jsonify({"ok": True, "url": entry["driver"].current_url, "title": entry["driver"].title})
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/session/<sid>/state", methods=["GET"])
def state(sid):
    with GLOBAL_LOCK:
        entry = SESSIONS.get(sid)
    if not entry:
        return jsonify({"ok": False, "error": "no such session"}), 404
    max_chars = request.args.get("max_chars", default=6000, type=int)
    with entry["lock"]:
        driver = entry["driver"]
        elements = []
        frame_map = {}
        try:
            driver.switch_to.default_content()
            try:
                top_text = driver.execute_script("return document.body ? document.body.innerText : '';") or ""
            except Exception:
                top_text = ""
            if len(top_text) > max_chars:
                top_text = top_text[:max_chars]

            for frame_path in _iter_frame_tree(driver):
                try:
                    _goto_frame(driver, frame_path)
                except Exception:
                    continue
                try:
                    # _JS_STATE is already a self-invoking IIFE ("(function(){...})();").
                    # Prepend "return " with .strip() so no newline sits between
                    # "return" and "(" -- otherwise ASI turns it into "return;".
                    items = driver.execute_script("return " + _JS_STATE.strip())
                except Exception:
                    continue
                if not items:
                    continue
                prefix = ".".join(str(p) for p in frame_path)
                for item in items:
                    if prefix:
                        ref = prefix + ".e" + str(item["idx"])
                    else:
                        ref = "e" + str(item["idx"])
                    elements.append({
                        "ref": ref,
                        "tag": item.get("tag"),
                        "text": item.get("text", ""),
                        "href": item.get("href", ""),
                        "frame_path": list(frame_path),
                    })
                    frame_map[ref] = list(frame_path)
            entry["frame_map"] = frame_map
            return jsonify({
                "ok": True,
                "url": driver.current_url,
                "title": driver.title,
                "text": top_text,
                "elements": elements,
            })
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)}), 500
        finally:
            try:
                driver.switch_to.default_content()
            except Exception:
                pass


@app.route("/session/<sid>/screenshot", methods=["GET"])
def screenshot(sid):
    """A resized/recompressed JPEG data URI, not the raw PNG capture --
    Selenium screenshots come back as full-resolution PNG (often 500KB+ for
    a 1280x1600 page), and these get stored per-step in Postgres and pushed
    over SSE to the live agent-activity UI, so a demo-quality thumbnail
    (max 640px wide, JPEG q60, typically 15-40KB) is the right tradeoff --
    it's for showing "here's what the browser saw", not forensic detail."""
    with GLOBAL_LOCK:
        entry = SESSIONS.get(sid)
    if not entry:
        return jsonify({"ok": False, "error": "no such session"}), 404
    with entry["lock"]:
        driver = entry["driver"]
        try:
            driver.switch_to.default_content()
            png_bytes = driver.get_screenshot_as_png()
            img = Image.open(io.BytesIO(png_bytes)).convert("RGB")
            if img.width > 640:
                ratio = 640 / img.width
                img = img.resize((640, int(img.height * ratio)), Image.LANCZOS)
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=60)
            data_uri = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")
            return jsonify({"ok": True, "screenshot": data_uri})
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/session/<sid>/click", methods=["POST"])
def click(sid):
    with GLOBAL_LOCK:
        entry = SESSIONS.get(sid)
    if not entry:
        return jsonify({"ok": False, "error": "no such session"}), 404
    data = request.get_json(silent=True) or {}
    ref = data.get("ref")
    if not ref:
        return jsonify({"ok": False, "error": "missing ref"}), 400
    try:
        frame_path, local_idx = _parse_ref(ref)
    except Exception as e:
        return jsonify({"ok": False, "error": "bad ref: %s" % e}), 400
    with entry["lock"]:
        driver = entry["driver"]
        try:
            handles_before = driver.window_handles
            try:
                _goto_frame(driver, frame_path)
            except Exception:
                return jsonify({"ok": False, "error": "stale ref -- frame structure changed, call /state again"}), 409
            try:
                el = driver.find_element(By.CSS_SELECTOR, '[data-agx="%d"]' % local_idx)
            except NoSuchElementException:
                return jsonify({"ok": False, "error": "stale ref -- element not found, call /state again"}), 404
            try:
                driver.execute_script("arguments[0].scrollIntoView({block:'center'});", el)
            except Exception:
                pass
            try:
                el.click()
            except Exception:
                try:
                    driver.execute_script("arguments[0].click();", el)
                except Exception as e:
                    return jsonify({"ok": False, "error": "click failed: %s" % e}), 500

            # Wait for top document ready.
            driver.switch_to.default_content()
            deadline = time.time() + 15
            while time.time() < deadline:
                try:
                    ready = driver.execute_script("return document.readyState;")
                    if ready == "complete":
                        break
                except Exception:
                    pass
                time.sleep(0.25)
            time.sleep(1.5)

            # Many portal links (civicweb.net, legistar.com, etc.) are
            # target="_blank" to a different domain -- the click opens a new
            # tab/window that Selenium doesn't auto-follow, leaving the old
            # window's url/title unchanged and the nav loop stuck reclicking
            # the same link forever. If a new window appeared, follow it and
            # close the one we came from -- the old tab is a dead end with
            # nothing further to discover.
            new_handles = [h for h in driver.window_handles if h not in handles_before]
            if new_handles:
                old_handle = driver.current_window_handle
                try:
                    driver.switch_to.window(old_handle)
                    driver.close()
                except Exception:
                    pass
                driver.switch_to.window(new_handles[-1])
                entry["frame_map"] = {}

            try:
                driver.switch_to.default_content()
            except Exception:
                pass
            return jsonify({"ok": True, "url": driver.current_url, "title": driver.title})
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)}), 500
        finally:
            try:
                driver.switch_to.default_content()
            except Exception:
                pass


@app.route("/session/<sid>/type", methods=["POST"])
def type_route(sid):
    with GLOBAL_LOCK:
        entry = SESSIONS.get(sid)
    if not entry:
        return jsonify({"ok": False, "error": "no such session"}), 404
    data = request.get_json(silent=True) or {}
    ref = data.get("ref")
    text = data.get("text", "")
    submit = bool(data.get("submit", False))
    if not ref:
        return jsonify({"ok": False, "error": "missing ref"}), 400
    try:
        frame_path, local_idx = _parse_ref(ref)
    except Exception as e:
        return jsonify({"ok": False, "error": "bad ref: %s" % e}), 400
    with entry["lock"]:
        driver = entry["driver"]
        try:
            try:
                _goto_frame(driver, frame_path)
            except Exception:
                return jsonify({"ok": False, "error": "stale ref -- frame structure changed, call /state again"}), 409
            try:
                el = driver.find_element(By.CSS_SELECTOR, '[data-agx="%d"]' % local_idx)
            except NoSuchElementException:
                return jsonify({"ok": False, "error": "stale ref -- element not found, call /state again"}), 404
            try:
                driver.execute_script("arguments[0].scrollIntoView({block:'center'});", el)
            except Exception:
                pass
            try:
                el.clear()
            except Exception:
                pass
            el.send_keys(text)
            if submit:
                el.send_keys(Keys.RETURN)
            time.sleep(1.5)
            try:
                driver.switch_to.default_content()
            except Exception:
                pass
            return jsonify({"ok": True, "url": driver.current_url, "title": driver.title})
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)}), 500
        finally:
            try:
                driver.switch_to.default_content()
            except Exception:
                pass


@app.route("/session/<sid>/links", methods=["GET"])
def links(sid):
    with GLOBAL_LOCK:
        entry = SESSIONS.get(sid)
    if not entry:
        return jsonify({"ok": False, "error": "no such session"}), 404
    with entry["lock"]:
        driver = entry["driver"]
        try:
            driver.switch_to.default_content()
            all_links = []
            seen = set()
            for frame_path in _iter_frame_tree(driver):
                try:
                    _goto_frame(driver, frame_path)
                except Exception:
                    continue
                try:
                    hrefs = driver.execute_script(
                        "return Array.from(document.querySelectorAll('a[href]')).map(function(a){return a.href;});"
                    ) or []
                except Exception:
                    continue
                for h in hrefs:
                    if not h or h in seen:
                        continue
                    seen.add(h)
                    all_links.append(h)
                    if len(all_links) >= 300:
                        break
                if len(all_links) >= 300:
                    break
            pdfs = []
            pdf_seen = set()
            for h in all_links:
                try:
                    stripped = h.split("?")[0].split("#")[0].lower()
                except Exception:
                    continue
                if stripped.endswith(".pdf") and stripped not in pdf_seen:
                    pdf_seen.add(stripped)
                    pdfs.append(h)
            return jsonify({"ok": True, "links": all_links, "pdfs": pdfs})
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)}), 500
        finally:
            try:
                driver.switch_to.default_content()
            except Exception:
                pass


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "5000")), threaded=True)