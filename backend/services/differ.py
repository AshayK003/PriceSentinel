"""
HTML diff engine using Python's stdlib difflib.
Returns structured JSON diff (not rendered HTML).

SequenceMatcher from stdlib difflib, no npm packages needed.
         Upgrade to semantic HTML diffing if false-positive rate is too high.
         BeautifulSoup4 added for CSS-selector-based element extraction.
"""

import difflib
import re
from bs4 import BeautifulSoup


def _extract_by_selector(html: str, selector: str) -> str:
    """Extract the HTML of the first element matching a CSS selector.
    Falls back to full HTML if the selector doesn't match."""
    soup = BeautifulSoup(html, 'html.parser')
    el = soup.select_one(selector)
    return str(el) if el else html


def _tagify(html: str) -> list[str]:
    """Split HTML into tag-or-text tokens for structural comparison."""
    return re.split(r'(<[^>]+>)', html)


def diff_text(old: str, new: str, selector: str | None = None) -> list[dict]:
    """
    Compare two HTML strings and return a list of diff segments.

    If a CSS selector is provided, only the matching element is compared.
    Each segment: {"type": "added"|"removed"|"unchanged", "text": "..."}
    """
    if selector:
        old = _extract_by_selector(old, selector)
        new = _extract_by_selector(new, selector)

    old_tokens = _tagify(old)
    new_tokens = _tagify(new)

    matcher = difflib.SequenceMatcher(None, old_tokens, new_tokens)
    result: list[dict] = []

    for op, i1, i2, j1, j2 in matcher.get_opcodes():
        if op == "equal":
            text = "".join(old_tokens[i1:i2])
            if text.strip():
                result.append({"type": "unchanged", "text": text})
        elif op == "insert":
            text = "".join(new_tokens[j1:j2])
            if text.strip():
                result.append({"type": "added", "text": text})
        elif op == "delete":
            text = "".join(old_tokens[i1:i2])
            if text.strip():
                result.append({"type": "removed", "text": text})
        elif op == "replace":
            removed = "".join(old_tokens[i1:i2])
            added = "".join(new_tokens[j1:j2])
            if removed.strip():
                result.append({"type": "removed", "text": removed})
            if added.strip():
                result.append({"type": "added", "text": added})

    return result


def has_meaningful_change(diff: list[dict]) -> bool:
    """Heuristic: ignore diffs that only change whitespace/non-visible chars."""
    adds = [s for s in diff if s["type"] == "added" and s["text"].strip()]
    rems = [s for s in diff if s["type"] == "removed" and s["text"].strip()]
    if not adds and not rems:
        return False
    # If every added segment has a whitespace-only difference from a removed segment, skip
    if len(adds) == len(rems):
        added_texts = {a["text"].strip() for a in adds}
        removed_texts = {r["text"].strip() for r in rems}
        if added_texts == removed_texts:
            return False
    return True
