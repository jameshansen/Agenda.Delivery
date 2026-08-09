import os
import time
import threading
import uuid
from flask import Flask, request, jsonify
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

app = Flask(__name__)

SESSIONS = {}
GLOBAL_LOCK = threading.Lock()

_COLLECT_JS = """
(function() {
    var results = [];
    var interactiveSelector = 'a,button,select,textarea,input:not([type="hidden"]),[role="button"],[onclick]';
    var els = document.querySelectorAll(interactiveSelector);
    var count = 0;
    for (var i = 0; i < els.length && count < 120; i++) {
        var el = els[i];
        try {
            var visible = el.offsetParent !== null && el.offsetWidth > 0 && el.offsetHeight > 0;
        } catch(e) {
            var visible = false;
        }
        if (!visible) {
            continue;
        }
        var ref = 'e' + count;
        el.setAttribute('data-agx', ref);
        var text = (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 100);
        var href = el.href || '';
        results.push({ref: ref, tag: el.tagName.toLowerCase(), text: text, href: href});
        count++;
    }
    return results;
})();
"""


def _make_driver():
    import undetected_chromedriver as uc
    options = uc.ChromeOptions()
    options.add_argument('--no-sandbox')
    options.add_argument('--disable-dev-shm-usage')
    options.add_argument('--disable-gpu')
    options.add_argument('--window-size=1400,1800')
    options.add_argument('--headless=new')
    options.add_argument('--lang=en-CA')
    options.binary_location = os.environ['CHROME_BIN']
    driver = uc.Chrome(
        options=options,
        browser_executable_path=os.environ['CHROME_BIN'],
        driver_executable_path=os.environ.get('CHROMEDRIVER_PATH'),
        headless=True,
        use_subprocess=False,
    )
    driver.set_page_load_timeout(45)
    return driver


def _sess(sid):
    return SESSIONS.get(sid)


def _wait_ready(driver, timeout):
    end = time.time() + timeout
    while time.time() < end:
        try:
            state = driver.execute_script('return document.readyState')
            if state == 'complete':
                return True
        except Exception:
            pass
        time.sleep(0.3)
    return False


@app.route('/health', methods=['GET'])
def health():
    return jsonify({'ok': True})


@app.route('/session', methods=['POST'])
def create_session():
    try:
        driver = _make_driver()
        sid = uuid.uuid4().hex
        with GLOBAL_LOCK:
            SESSIONS[sid] = {'driver': driver, 'lock': threading.Lock()}
        return jsonify({'ok': True, 'session_id': sid})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/session/<sid>', methods=['DELETE'])
def delete_session(sid):
    with GLOBAL_LOCK:
        entry = SESSIONS.pop(sid, None)
    if entry is None:
        return jsonify({'ok': False, 'error': 'session not found'}), 404
    try:
        with entry['lock']:
            try:
                entry['driver'].quit()
            except Exception:
                pass
        return jsonify({'ok': True})
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/session/<sid>/goto', methods=['POST'])
def session_goto(sid):
    with GLOBAL_LOCK:
        entry = _sess(sid)
    if entry is None:
        return jsonify({'ok': False, 'error': 'session not found'}), 404
    try:
        data = request.get_json(force=True, silent=True) or {}
        url = data.get('url')
        if not url:
            return jsonify({'ok': False, 'error': 'missing url'}), 400
        with entry['lock']:
            driver = entry['driver']
            driver.get(url)
            _wait_ready(driver, 20)
            time.sleep(2.0)
            return jsonify({
                'ok': True,
                'url': driver.current_url,
                'title': driver.title,
            })
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/session/<sid>/state', methods=['GET'])
def session_state(sid):
    with GLOBAL_LOCK:
        entry = _sess(sid)
    if entry is None:
        return jsonify({'ok': False, 'error': 'session not found'}), 404
    try:
        max_chars = request.args.get('max_chars', default=6000, type=int)
        with entry['lock']:
            driver = entry['driver']
            els = driver.execute_script('return ' + _COLLECT_JS)
            text = driver.execute_script('return document.body.innerText') or ''
            text = text.strip()
            if max_chars and len(text) > max_chars:
                text = text[:max_chars]
            return jsonify({
                'ok': True,
                'url': driver.current_url,
                'title': driver.title,
                'text': text,
                'elements': els,
            })
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/session/<sid>/click', methods=['POST'])
def session_click(sid):
    with GLOBAL_LOCK:
        entry = _sess(sid)
    if entry is None:
        return jsonify({'ok': False, 'error': 'session not found'}), 404
    try:
        data = request.get_json(force=True, silent=True) or {}
        ref = data.get('ref')
        if not ref:
            return jsonify({'ok': False, 'error': 'missing ref'}), 400
        with entry['lock']:
            driver = entry['driver']
            el = driver.find_element(By.CSS_SELECTOR, '[data-agx="{}"]'.format(ref))
            driver.execute_script('arguments[0].scrollIntoView({block:"center"})', el)
            try:
                el.click()
            except Exception:
                driver.execute_script('arguments[0].click()', el)
            _wait_ready(driver, 15)
            time.sleep(1.5)
            return jsonify({
                'ok': True,
                'url': driver.current_url,
                'title': driver.title,
            })
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/session/<sid>/type', methods=['POST'])
def session_type(sid):
    with GLOBAL_LOCK:
        entry = _sess(sid)
    if entry is None:
        return jsonify({'ok': False, 'error': 'session not found'}), 404
    try:
        data = request.get_json(force=True, silent=True) or {}
        ref = data.get('ref')
        text = data.get('text', '')
        submit = bool(data.get('submit', False))
        if not ref:
            return jsonify({'ok': False, 'error': 'missing ref'}), 400
        with entry['lock']:
            driver = entry['driver']
            el = driver.find_element(By.CSS_SELECTOR, '[data-agx="{}"]'.format(ref))
            el.clear()
            el.send_keys(text)
            if submit:
                el.send_keys(Keys.RETURN)
            time.sleep(1.5)
            return jsonify({
                'ok': True,
                'url': driver.current_url,
                'title': driver.title,
            })
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


@app.route('/session/<sid>/links', methods=['GET'])
def session_links(sid):
    with GLOBAL_LOCK:
        entry = _sess(sid)
    if entry is None:
        return jsonify({'ok': False, 'error': 'session not found'}), 404
    try:
        with entry['lock']:
            driver = entry['driver']
            anchors = driver.execute_script(
                "return Array.from(document.querySelectorAll('a[href]')).map(function(a){return a.href;});"
            ) or []
            seen = set()
            deduped = []
            for u in anchors:
                if u not in seen:
                    seen.add(u)
                    deduped.append(u)
            pdfs = [u for u in deduped if u.lower().split('?')[0].endswith('.pdf')]
            return jsonify({
                'ok': True,
                'links': deduped[:300],
                'pdfs': pdfs,
            })
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8080, threaded=True)
