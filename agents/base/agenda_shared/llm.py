"""Ollama Cloud chat client — the shared LLM utility, with the API key.

Port of the old src/agents/llm.ts. Talks to the Ollama native /api/chat
endpoint. If OLLAMA_BASE_URL is unset it falls back to a deterministic
mock so agents still run end-to-end in dev.
"""
import json
import re

import requests

from .settings import OLLAMA_BASE_URL, OLLAMA_API_KEY, AGENT_MODEL, SUMMARY_MODEL


def _chat(
    messages: list[dict],
    model: str | None = None,
    temperature: float = 0.4,
    summary: bool = False,
) -> str:
    model = model or (SUMMARY_MODEL if summary else AGENT_MODEL)

    if not OLLAMA_BASE_URL:
        return _mock(messages, model)

    headers = {"Content-Type": "application/json"}
    if OLLAMA_API_KEY:
        headers["Authorization"] = f"Bearer {OLLAMA_API_KEY}"

    res = requests.post(
        f"{OLLAMA_BASE_URL}/api/chat",
        headers=headers,
        json={
            "model": model,
            "messages": messages,
            "stream": False,
            "options": {"temperature": temperature},
        },
        timeout=300,
    )
    if res.status_code == 429:
        # Shared account quota. Surface loudly; the caller/orchestrator
        # should pause rather than hammer.
        raise RuntimeError(f"OLLAMA_RATE_LIMITED: {res.text[:300]}")
    if not res.ok:
        raise RuntimeError(f"Ollama {model} returned {res.status_code}: {res.text[:300]}")

    data = res.json()
    return (data.get("message") or {}).get("content", "")


def complete(system: str, user: str, model: str | None = None,
             temperature: float = 0.4, summary: bool = False) -> str:
    return _chat(
        [{"role": "system", "content": system},
         {"role": "user", "content": user}],
        model=model, temperature=temperature, summary=summary,
    )


def complete_json(system: str, user: str, model: str | None = None,
                  temperature: float = 0.4, summary: bool = False) -> dict:
    """Ask for a JSON object and parse the first {...} block."""
    raw = _chat(
        [{"role": "system", "content": system + "\n\nRespond with valid JSON only."},
         {"role": "user", "content": user}],
        model=model, temperature=temperature, summary=summary,
    )
    return extract_json(raw)


def summarize(system: str, content: str, model: str | None = None) -> str:
    """Summarize with the lighter model."""
    return _chat(
        [{"role": "system", "content": system},
         {"role": "user", "content": content}],
        model=model, summary=True,
    )


def extract_json(raw: str) -> dict:
    cleaned = re.sub(r"<think>.*?</think>", "", raw, flags=re.I | re.S)
    cleaned = cleaned.replace("```json", "").replace("```", "")
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start == -1 or end == -1:
        raise RuntimeError(f"LLM did not return JSON. Raw: {raw[:300]}")
    return json.loads(cleaned[start:end + 1])


def _mock(messages: list[dict], model: str) -> str:
    text = (messages[-1].get("content") if messages else "") or ""
    low = text.lower()
    if "summar" in low:
        return ("The council meeting addressed several key items. Council approved "
                "an infrastructure funding allocation and discussed a zoning "
                "amendment for mixed-use development. A public hearing was scheduled "
                "for the next meeting cycle.")
    if "selector" in low or "scrape" in low:
        return json.dumps({
            "agendaUrl": "https://example.ca/council/meetings",
            "linkSelector": "a[href$='.pdf']",
            "fileTypes": ["pdf"],
            "hints": "Look for the .agenda-list container; PDFs are linked by date.",
        })
    if "geoloc" in low or "lat" in low or "lng" in low:
        return json.dumps({"lat": 49.1013, "lng": -122.6587,
                           "region": "Langley, British Columbia"})
    if "categor" in low:
        return json.dumps({"kind": "Council Meeting", "confidence": 0.9})
    if "keyword" in low:
        return json.dumps({"summary": "The agenda includes items relevant to this "
                                      "keyword, including a staff report and a "
                                      "council resolution."})
    return f"({model} mock) I have analysed the request and determined the action."
