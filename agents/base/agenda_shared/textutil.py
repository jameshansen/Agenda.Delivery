"""Shared agenda text helpers used by more than one agent."""
import re

_END_MARKERS = [
    r"\bADJOURNMENT\b", r"\bTermination\b",
    r"\bEnd of (the )?(Council )?Meeting\b", r"\bADJOURN\b",
    r"\bMotion to (adjourn|terminate)\b", r"\bNEXT (COUNCIL )?MEETING\b",
]


def strip_markdown(text: str) -> str:
    """LLM output that's displayed as a single flat paragraph everywhere,
    never rendered as markdown -- strip rather than trust prompt compliance
    alone. Models slip into **bold**/bullet/labeled-section formatting out
    of habit even when told to write flowing prose (e.g. "Topic: detail"
    on its own line, one per paragraph) -- since there's no renderer, that
    structure would show up as run-together label text, not sections.
    Collapsing newlines to spaces is the actual fix for that: it turns
    "Topic: detail\\nOther: detail" into one flat sentence stream instead
    of literal multi-line output in a single-paragraph UI slot."""
    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text)
    text = re.sub(r"^[#*\-•]+\s*", "", text, flags=re.M)
    # The model tacking on a "Key Highlights" recap after the actual
    # summary is common and genuinely redundant -- highlights already get
    # extracted separately (their own LLM call, shown as distinct tag/text
    # cards elsewhere in the UI), so this field never needs one. Rather
    # than reformat whatever bullet style shows up (dashes, colons, emoji
    # -- seen all three across different runs, an unbounded whack-a-mole),
    # just truncate the summary at the header and keep only what's before
    # it. Also handles the bare-header-with-no-separator case for free.
    text = re.split(r"(?:^|(?<=[.!?\n])\s*)(?:Key\s+Highlights|Highlights)\b", text, maxsplit=1)[0]
    # Bare "Summary " / "General Summary " prefix with no separator --
    # the model echoing a section-header habit. Strip at any sentence or
    # line boundary, must run before the newline collapse below.
    text = re.sub(
        r"(^|(?<=[.!?\n])\s*)(?:General\s+)?Summary\s+(?=[A-Z])",
        r"\1", text,
    )
    # Strip "Topic Label: " / "Topic Label – " prefixes models keep adding
    # even when told not to. A short (1-4 word) Title Case phrase followed
    # by a separator, at the start of the text or right after a sentence
    # OR line boundary -- narrow enough to not eat real content like
    # "7:00 PM" (no title-case word before the colon) or "Yangzhou, China."
    # (no colon at all). Crucially this runs against the RAW text, before
    # newlines are collapsed to spaces: these labels are usually originally
    # separate bullet lines with no trailing period, so a boundary that
    # only recognizes ".!?" (not "\n") misses every one after the first --
    # "bullet one\nLabel – detail" has no period before "Label", only a
    # newline. Separator varies by model/run too -- colon today, em-dash
    # tomorrow (seen live, apparently dodging a colon-only pattern) --
    # treat colon, en-dash, em-dash, and hyphen-as-separator the same way.
    text = re.sub(
        r"(^|(?<=[.!?\n])\s*)(?:[A-Z][a-zA-Z]*(?:\s+(?:[A-Z][a-zA-Z]*|&)){0,3}\s*[:–—-]\s+)+",
        r"\1", text,
    )
    text = text.replace("\n", " ")
    return re.sub(r"\s{2,}", " ", text).strip()


def looks_like_garbled_title(title: str) -> bool:
    """Catch scraped meeting titles that are actually mangled page junk, not
    a real title -- e.g. an unescaped HTML entity followed by a long run of
    space-separated numbers (seen live on Maple Ridge: "Regular Council
    Meeting&nbsp; ( 739 23 27 27 21 27 34 27 23 24 23 24 26 22 22 21 22 24
    25 26 34 24 37 31 34 26 21 26 22" -- looks like an obfuscated-email/
    JS char-code array that leaked into the scraped text). A real meeting
    title is prose; this is neither prose nor a real date/number a title
    would legitimately contain (an address, a bylaw number)."""
    if not title:
        return False
    if re.search(r"&[a-zA-Z]+;", title):
        return True
    numeric_tokens = re.findall(r"(?<!\d)\d{1,3}(?!\d)", title)
    if len(numeric_tokens) >= 6:
        return True
    return False


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
