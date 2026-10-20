# Test council (testcouncil.agenda.delivery). Build context = repo root,
# for the shared Ollama client in agents/base/agenda_shared.
FROM python:3.12-slim

WORKDIR /app

COPY agents/base/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY agents/base/agenda_shared ./agenda_shared
COPY testcouncil/app.py ./

EXPOSE 8000

# One worker so the release timer runs once. A release waits on the model,
# hence the long timeout.
CMD ["gunicorn", "-w", "1", "-k", "gthread", "--threads", "4", "-t", "300", \
     "-b", "0.0.0.0:8000", "app:app"]
