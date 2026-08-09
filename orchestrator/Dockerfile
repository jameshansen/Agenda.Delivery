# Orchestrator. Build context = repo root (needs agents/base/agenda_shared).
FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libxml2 libxslt1.1 && rm -rf /var/lib/apt/lists/*

COPY agents/base/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY agents/base/agenda_shared ./agenda_shared
COPY orchestrator/ ./

EXPOSE 8000

# Single worker so scheduler + queue-worker threads run exactly once;
# gthread gives us threads for the long-lived SSE connections.
CMD ["gunicorn", "-w", "1", "--threads", "8", "-t", "610", \
     "-b", "0.0.0.0:8000", "app:app"]
