# Undetected-chromedriver + Selenium browser service.
#
# Real Google Chrome, NOT Debian's Chromium package: Chromium doesn't self-
# report as "Google Chrome" in Client Hints (navigator.userAgentData.brands),
# which anti-bot systems (Cloudflare included) can check independently of
# the spoofable User-Agent header -- a real fingerprint mismatch a patched
# WebDriver can't paper over. undetected-chromedriver also downloads a
# matching chromedriver for whatever Chrome build it finds at runtime, so we
# don't need to apt-install chromium-driver separately.
#
# Runs headful (not --headless / --headless=new) under Xvfb: genuine
# rendering pipeline is the most reliable way to avoid headless-specific
# fingerprints, more so than either headless mode. See
# agenda-shared/restructure-progress.md 2026-08-09 session notes for the
# research behind this (undetected-chromedriver's own author moved to
# `nodriver` after concluding WebDriver-patching alone is a losing battle
# against Cloudflare -- headful-via-Xvfb + real Chrome is the cheap rung
# to try before a bigger nodriver migration).
#
# Python 3.11 (not 3.12): undetected-chromedriver still imports distutils.
FROM python:3.11-slim

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget gnupg fonts-liberation ca-certificates tzdata xvfb \
    && wget -q -O /tmp/chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
    && apt-get install -y --no-install-recommends /tmp/chrome.deb \
    && rm -f /tmp/chrome.deb \
    && rm -rf /var/lib/apt/lists/*

ENV CHROME_BIN=/usr/bin/google-chrome
# No CHROMEDRIVER_PATH: undetected-chromedriver auto-downloads the driver
# version-matched to CHROME_BIN, which matters more once Chrome auto-updates
# inside the image than it did pinning to Debian's (version-locked) package.

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py .
COPY entrypoint.sh .
RUN chmod +x entrypoint.sh

EXPOSE 8000

# Single worker so browser sessions live in one process; threads handle
# concurrent requests, guarded by a per-session lock.
CMD ["./entrypoint.sh"]
