# Undetected-chromedriver + Selenium browser service.
# Chromium + matching chromedriver come from Debian so versions align.
# Python 3.11 (not 3.12): undetected-chromedriver still imports distutils.
FROM python:3.11-slim

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium chromium-driver \
    fonts-liberation ca-certificates tzdata xvfb \
    && rm -rf /var/lib/apt/lists/*

ENV CHROME_BIN=/usr/bin/chromium
ENV CHROMEDRIVER_PATH=/usr/bin/chromedriver

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py .

EXPOSE 8000

# Single worker so browser sessions live in one process; threads handle
# concurrent requests, guarded by a per-session lock.
CMD ["gunicorn", "-w", "1", "--threads", "8", "-t", "180", "-b", "0.0.0.0:8000", "app:app"]
