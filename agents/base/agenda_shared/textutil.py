"""Shared agenda text helpers used by more than one agent."""
import re

_END_MARKERS = [
    r"\bADJOURNMENT\b", r"\bTermination\b",
    r"\bEnd of (the )?(Council )?Meeting\b", r"\bADJOURN\b",
    r"\bMotion to (adjourn|terminate)\b", r"\bNEXT (COUNCIL )?MEETING\b",
]


def find_meeting_end(text: str) -> str:
    """Return text up to the first end-of-meeting marker (inclusive of its line)."""
    end_idx = len(text)
    for pat in _END_MARKERS:
        m = re.search(pat, text, flags=re.I)
        if m and m.start() < end_idx:
            end_idx = m.start()
    if end_idx < len(text):
        line_end = text.find("\n", end_idx)
        if line_end != -1:
            end_idx = min(line_end + 1, len(text))
    return text[:end_idx]
