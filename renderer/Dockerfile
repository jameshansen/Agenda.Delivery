# Playwright's official image ships Chromium + all system deps + Python.
FROM mcr.microsoft.com/playwright/python:v1.49.0-noble

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .

EXPOSE 8000

# 2 single-threaded workers (sync Playwright must stay on one thread per proc).
CMD ["gunicorn", "-w", "2", "--threads", "1", "-t", "90", "-b", "0.0.0.0:8000", "app:app"]
