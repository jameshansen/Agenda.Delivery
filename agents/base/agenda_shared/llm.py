"""Charm Hyper chat client, the shared LLM utility, with the API key.

Talks to Hyper's OpenAI-compatible /chat/completions endpoint. If
HYPER_API_KEY is unset it falls back to a deterministic mock so agents
still run end-to-end in dev.
"""
import json
import re

import requests

from .settings import HYPER_BASE_URL, HYPER_API_KEY, AGENT_MODEL, SUMMARY_MODEL, IMAGE_MODEL


def _payload(messages: list[dict], model: str | None, temperature: float,
             summary: bool, images: list[str] | None) -> dict:
    """Request body. Anything carrying images goes to the vision model
    whatever the caller asked for; the text models are blind or pricier."""
    if images:
        last = messages[-1]
        messages = messages[:-1] + [{**last, "content": [
            {"type": "text", "text": last["content"]},
            *({"type": "image_url", "image_url": {"url": u}} for u in images),
        ]}]
        model = IMAGE_MODEL
    return {
        "model": model or (SUMMARY_MODEL if summary else AGENT_MODEL),
        "messages": messages,
        "temperature": temperature,
    }


def _chat(
    messages: list[dict],
    model: str | None = None,
    temperature: float = 0.4,
    summary: bool = False,
    images: list[str] | None = None,
) -> str:
    body = _payload(messages, model, temperature, summary, images)

    if not HYPER_API_KEY:
        return _mock(messages, body["model"])

    res = requests.post(
        f"{HYPER_BASE_URL}/chat/completions",
        headers={"Authorization": f"Bearer {HYPER_API_KEY}"},
        json=body,
        timeout=300,
    )
    if res.status_code in (402, 429):
        # 429 is the rate limit, 402 is the account out of Hypercredits.
        # Either way every further call fails too, so surface loudly and
        # let the orchestrator pause rather than hammer.
        raise RuntimeError(f"LLM_RATE_LIMITED ({res.status_code}): {res.text[:300]}")
    if not res.ok:
        raise RuntimeError(f"Hyper {body['model']} returned {res.status_code}: {res.text[:300]}")

    choices = res.json().get("choices") or [{}]
    return (choices[0].get("message") or {}).get("content") or ""


def complete(system: str, user: str, model: str | None = None,
             temperature: float = 0.4, summary: bool = False,
             images: list[str] | None = None) -> str:
    """`images` are URLs or data URIs; passing any routes the call to IMAGE_MODEL."""
    return _chat(
        [{"role": "system", "content": system},
         {"role": "user", "content": user}],
        model=model, temperature=temperature, summary=summary, images=images,
    )


def complete_json(system: str, user: str, model: str | None = None,
                  temperature: float = 0.4, summary: bool = False,
                  images: list[str] | None = None) -> dict:
    """Ask for a JSON object and parse the first {...} block."""
    raw = _chat(
        [{"role": "system", "content": system + "\n\nRespond with valid JSON only."},
         {"role": "user", "content": user}],
        model=model, temperature=temperature, summary=summary, images=images,
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
