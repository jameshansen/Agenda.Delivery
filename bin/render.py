"""Load one page in headless Chrome and print its HTML, frames included.

Usage: render.py URL PROFILE_DIR [--save FILE]
With --save, the URL is downloaded through the browser to FILE instead, for files a site only
hands to a real browser. adtool runs this inside a browser slot, so at most two run at once.
"""
import base64
import fcntl
import os
import re
import subprocess
import sys
import time
from urllib.parse import urlsplit

# Every render shares one patched chromedriver, kept beside the slot profiles rather than in each agent's home.
if len(sys.argv) >= 3:
    os.environ["HOME"] = os.path.dirname(os.path.abspath(sys.argv[2]))

import undetected_chromedriver as uc  # noqa: E402  (reads HOME on import)

# Bot checks such as Cloudflare's turn headless Chrome away, so when adtool provides a virtual display
# (xvfb-run) Chrome runs as a normal window on it, which nobody sees.
HEADLESS = not os.environ.get("DISPLAY")

CHALLENGE = re.compile(r"just a moment|checking your browser|verify you are human|attention required", re.I)


def chrome_major() -> int | None:
    """uc fetches the newest chromedriver unless told which Chrome is installed."""
    for binary in ("google-chrome", "google-chrome-stable", "chromium"):
        try:
            out = subprocess.run([binary, "--version"], capture_output=True, text=True, timeout=10).stdout
        except (OSError, subprocess.TimeoutExpired):
            continue
        if m := re.search(r"(\d+)\.\d+\.\d+", out):
            return int(m.group(1))
    return None


def uc_options() -> uc.ChromeOptions:
    opts = uc.ChromeOptions()
    for arg in ("--no-first-run", "--disable-dev-shm-usage", "--window-size=1366,900", "--lang=en-CA"):
        opts.add_argument(arg)
    return opts


def start(profile: str) -> uc.Chrome:
    # The first render downloads and patches chromedriver; later ones reuse it (user_multi_procs) so a
    # second slot never rewrites the binary a running render is using. If Chrome was upgraded since,
    # the old driver won't start a session, so it's deleted and a matching one fetched once.
    drivers = os.path.join(os.environ["HOME"], ".local/share/undetected_chromedriver")
    with open(os.path.join(os.environ["HOME"], "driver.lock"), "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        have_driver = os.path.isdir(drivers) and any("chromedriver" in f for f in os.listdir(drivers))
        try:
            return uc.Chrome(options=uc_options(), headless=HEADLESS, user_data_dir=profile, use_subprocess=True,
                             version_main=chrome_major(), user_multi_procs=have_driver)
        except Exception:
            if not have_driver:
                raise
            for f in os.listdir(drivers):
                os.remove(os.path.join(drivers, f))
            return uc.Chrome(options=uc_options(), headless=HEADLESS, user_data_dir=profile, use_subprocess=True,
                             version_main=chrome_major())


def settle(driver: uc.Chrome) -> None:
    """Give script-built pages time to draw, and bot checks up to 25 seconds to clear."""
    time.sleep(4)
    deadline = time.time() + 25
    while time.time() < deadline and CHALLENGE.search(driver.title + " " + driver.page_source[:3000]):
        time.sleep(2)


def save(driver: uc.Chrome, url: str, path: str) -> None:
    # Fetching from inside the page sends the cookies the bot check just granted.
    data = driver.execute_async_script(
        """const done = arguments[arguments.length - 1];
        fetch(arguments[0], {credentials: 'include'})
          .then(r => r.ok ? r.arrayBuffer() : Promise.reject('HTTP ' + r.status))
          .then(b => { let s = ''; const a = new Uint8Array(b);
                       for (let i = 0; i < a.length; i += 32768) s += String.fromCharCode.apply(null, a.subarray(i, i + 32768));
                       done(btoa(s)); })
          .catch(e => done('ERROR ' + e));""", url)
    if data.startswith("ERROR "):
        sys.exit(f"download failed: {data[6:]}")
    with open(path, "wb") as f:
        f.write(base64.b64decode(data))


def main(url: str, profile: str, save_to: str | None) -> None:
    driver = start(profile)
    try:
        driver.set_page_load_timeout(60)
        driver.set_script_timeout(120)
        if save_to:
            # Opening a PDF directly lands in Chrome's own viewer, a different origin without the site's
            # cookies, so the bot check is passed on the site's home page and the file fetched from there.
            parts = urlsplit(url)
            driver.get(f"{parts.scheme}://{parts.netloc}/")
            settle(driver)
            save(driver, url, save_to)
            return
        driver.get(url)
        settle(driver)
        driver.execute_script("window.scrollTo(0, document.body.scrollHeight)")
        time.sleep(2)
        html = driver.page_source
        # Content inside same-origin frames is invisible in page_source; append it.
        for i, frame in enumerate(driver.find_elements("css selector", "iframe")[:5]):
            try:
                driver.switch_to.frame(frame)
                html += f"\n<!-- frame {i} -->\n" + driver.page_source
            except Exception:
                pass
            finally:
                driver.switch_to.default_content()
        sys.stdout.write(html)
    finally:
        driver.quit()


if __name__ == "__main__":
    if len(sys.argv) not in (3, 5) or (len(sys.argv) == 5 and sys.argv[3] != "--save"):
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2], sys.argv[4] if len(sys.argv) == 5 else None)
