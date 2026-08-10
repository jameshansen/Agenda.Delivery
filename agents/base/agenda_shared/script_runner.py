"""Executes an untrusted `extract()` script in a restricted namespace with a wall-clock timeout."""
import builtins as _builtins_module
import json
import re
import threading
from datetime import date, datetime

import requests

from .tools import (
    _find_pdfs,
    _get,
    _html_to_text,
    _links_with_text,
    _pdf_text,
    extract_domain,
    render_html,
)

_SAFE_BUILTINS = {
    "len", "str", "int", "float", "bool", "dict", "list", "tuple", "set",
    "frozenset", "range", "enumerate", "sorted", "reversed", "zip", "min",
    "max", "sum", "any", "all", "abs", "round", "isinstance", "issubclass",
    "type", "repr", "format", "chr", "ord", "hash", "map", "filter", "iter",
    "next", "divmod", "pow", "print",
    "Exception", "BaseException", "ValueError", "TypeError", "KeyError",
    "IndexError", "AttributeError", "RuntimeError", "StopIteration",
    "NotImplementedError", "ZeroDivisionError", "OverflowError",
    "ArithmeticError", "LookupError", "NameError", "AssertionError",
    "ImportError", "ModuleNotFoundError", "FileNotFoundError",
    "TimeoutError", "RecursionError", "GeneratorExit",
    "True", "False", "None", "NotImplemented", "Ellipsis",
    "object", "bytes", "bytearray", "memoryview", "complex",
    "slice", "staticmethod", "classmethod", "property", "super",
}


# Modules the generated script is allowed to `import` -- returns our own
# pre-loaded reference rather than doing a real filesystem/sys.path import,
# so this can't be used to reach anything outside the allowlist.
_IMPORTABLE = {"re": re, "json": json, "requests": requests, "datetime": datetime}


def _safe_import(name, *args, **kwargs):
    if name in _IMPORTABLE:
        return _IMPORTABLE[name]
    raise ImportError(f"import of {name!r} is not allowed in extract scripts")


def _build_namespace() -> dict:
    all_builtins = vars(_builtins_module)
    safe = {name: all_builtins[name] for name in _SAFE_BUILTINS if name in all_builtins}
    safe["__import__"] = _safe_import
    ns: dict = {"__builtins__": safe}
    ns.update({
        "requests": requests,
        "re": re,
        "json": json,
        "datetime": datetime,
        "date": date,
        "_get": _get,
        "_links_with_text": _links_with_text,
        "_find_pdfs": _find_pdfs,
        "_pdf_text": _pdf_text,
        "_html_to_text": _html_to_text,
        "render_html": render_html,
        "extract_domain": extract_domain,
    })
    return ns


def _fail(detail: str, data: dict | None = None) -> dict:
    return {"ok": False, "detail": detail, "data": data if data is not None else {}}


def _validate_result(value: object) -> dict | None:
    if not isinstance(value, dict):
        return _fail(f"extract() must return a dict, got {type(value).__name__}")
    for key in ("ok", "detail", "data"):
        if key not in value:
            return _fail(f"extract() return missing required key: {key!r}")
    if not isinstance(value["ok"], bool):
        return _fail(f"extract() return 'ok' must be bool, got {type(value['ok']).__name__}")
    if not isinstance(value["detail"], str):
        return _fail(f"extract() return 'detail' must be str, got {type(value['detail']).__name__}")
    if not isinstance(value["data"], dict):
        return _fail(f"extract() return 'data' must be dict, got {type(value['data']).__name__}")
    return None


def run_extract_script(script_text: str, timeout_secs: int = 20) -> dict:
    if not isinstance(script_text, str) or not script_text.strip():
        return _fail("script_text must be a non-empty string")

    holder: dict = {"result": None, "error": None}

    def _run() -> None:
        try:
            ns = _build_namespace()
            exec(compile(script_text, "<extract_script>", "exec"), ns)
            extract_fn = ns.get("extract")
            if not callable(extract_fn):
                holder["error"] = "script does not define a top-level callable `extract`"
                return
            holder["result"] = extract_fn()
        except BaseException as exc:
            holder["error"] = f"{type(exc).__name__}: {exc}"

    thread = threading.Thread(target=_run, daemon=True)
    thread.start()
    thread.join(timeout_secs)

    if thread.is_alive():
        return _fail(f"extract() timed out after {timeout_secs}s")

    if holder["error"] is not None:
        return _fail(f"extract() raised: {holder['error']}")

    value = holder["result"]
    bad = _validate_result(value)
    if bad is not None:
        return bad

    return {"ok": bool(value["ok"]), "detail": str(value["detail"]), "data": dict(value["data"])}
