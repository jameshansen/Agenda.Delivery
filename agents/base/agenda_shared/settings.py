"""Shared environment config for every agent + the orchestrator."""
import os

DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql://agenda:agenda@postgres:5432/agenda"
)
REDIS_URL = os.environ.get("REDIS_URL", "redis://redis:6379/0")

# Charm Hyper (OpenAI-compatible). Empty key => deterministic mock (dev without a key).
HYPER_BASE_URL = os.environ.get("HYPER_BASE_URL", "https://hyper.charm.land/v1").rstrip("/")
HYPER_API_KEY = os.environ.get("HYPER_API_KEY", "")
AGENT_MODEL = os.environ.get("AGENT_MODEL", "glm-5.3-flash")
SUMMARY_MODEL = os.environ.get("SUMMARY_MODEL", "gemma-4-26b-a4b-it")
# Every call that carries an image goes here, whatever model the agent uses.
IMAGE_MODEL = os.environ.get("IMAGE_MODEL", "prism")

# Redis pub/sub channel the orchestrator relays to the UI as SSE.
EVENTS_CHANNEL = "agent-events"

# Email dispatch: relay through the host's Postfix (which DKIM-signs + sends).
# Reached over the Docker bridge; no auth. Empty SMTP_HOST => email leg skipped.
SMTP_HOST = os.environ.get("SMTP_HOST", "")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "25"))
MAIL_FROM = os.environ.get("MAIL_FROM", "agenda.delivery <update@agenda.delivery>")

# SMS/text alerts are off until a sender (e.g. Twilio) is wired into notify.py.
SMS_ENABLED = os.environ.get("SMS_ENABLED", "false").lower() == "true"

# Where the Escalation Agent sends anything a human needs to look at.
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "jameshansen.bc@gmail.com")

# Public base URL, used for unsubscribe links in mailing-list sends.
BASE_URL = os.environ.get("BASE_URL", "https://agenda.delivery").rstrip("/")
