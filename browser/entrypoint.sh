#!/bin/sh
# Starts a virtual display so Chrome can run headful (not --headless), then
# hands off to gunicorn. See Dockerfile for why headful-via-Xvfb beats
# headless mode for Cloudflare-protected sites.
set -e
Xvfb :99 -screen 0 1280x1600x24 -nolisten tcp &
export DISPLAY=:99
exec gunicorn -w 1 --threads 8 -t 180 -b 0.0.0.0:8000 app:app
