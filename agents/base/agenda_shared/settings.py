"""Shared environment config for every agent + the orchestrator."""
import os

DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql://agenda:agenda@postgres:5432/agenda"
)
REDIS_URL = os.environ.get("REDIS_URL", "redis://redis:6379/0")

# Ollama Cloud. Empty base URL => deterministic mock (dev without a key).
OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "").rstrip("/")
OLLAMA_API_KEY = os.environ.get("OLLAMA_API_KEY", "")
AGENT_MODEL = os.environ.get("AGENT_MODEL", "glm-5.2")
SUMMARY_MODEL = os.environ.get("SUMMARY_MODEL", "gemma4:31b")

# Redis pub/sub channel the orchestrator relays to the UI as SSE.
EVENTS_CHANNEL = "agent-events"
