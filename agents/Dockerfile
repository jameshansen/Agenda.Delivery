# Shared Dockerfile for every agent container.
# Build with context ./agents and build-arg AGENT=<dir> (see docker-compose).
FROM python:3.12-slim

WORKDIR /app
ARG AGENT

# System deps: lxml needs libxml2; pypdf is pure-python.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libxml2 libxslt1.1 && rm -rf /var/lib/apt/lists/*

COPY base/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Shared utility (Ollama client + key handling, db, redis bus, base agent).
COPY base/agenda_shared ./agenda_shared
# The specific agent's app.py + agent_impl.py.
COPY ${AGENT}/ ./
# Logic self-check: `docker compose exec escalation python selfcheck.py`.
COPY selfcheck.py ./

EXPOSE 8000

# 2 sync workers, 600s timeout (agent runs can take minutes).
CMD ["gunicorn", "-b", "0.0.0.0:8000", "-w", "2", "-t", "600", "app:app"]
