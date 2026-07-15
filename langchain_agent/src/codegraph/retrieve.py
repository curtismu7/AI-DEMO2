# langchain_agent/src/codegraph/retrieve.py
"""Deterministic retrieval for Code Explorer — works with any chat LLM.

ReAct/tool-calling is provider-specific (Helix cannot emit native tool_calls;
some local GGUFs are unreliable). This module always gathers index+source
context first, then any LLM can answer from the packed prompt.
"""
from __future__ import annotations

import re
from typing import Optional

from codegraph import db
from codegraph import repo

_MAX_HITS = 8
_MAX_FILES = 3
_WINDOW = 80
_CONTEXT_CAP = 14000


def _format_hits(rows: list[dict]) -> str:
    if not rows:
        return "(no symbol hits)"
    lines = []
    for row in rows[:_MAX_HITS]:
        lines.append(
            f"- {row.get('name', '')} ({row.get('kind', '')}) — "
            f"{row.get('file_path', '')}:{row.get('start_line', '')}"
            + (f"-{row.get('end_line')}" if row.get("end_line") else "")
        )
    return "\n".join(lines)


def _read_window(file_path: str, start_line: int, end_line: Optional[int]) -> str:
    target = repo.resolve_in_root(file_path)
    if target is None:
        return f"(file not found: {file_path})"
    lines = target.read_text(encoding="utf-8", errors="replace").splitlines()
    s = max(1, int(start_line or 1) - 5)
    e = int(end_line or (s + _WINDOW))
    e = min(len(lines), max(s, e))
    window = lines[s - 1:e]
    return "\n".join(f"{s + i}\t{ln}" for i, ln in enumerate(window)) or "(empty)"


def _extra_terms(question: str) -> list[str]:
    """Pull identifier-like tokens to widen search when FTS is thin."""
    tokens = re.findall(r"[A-Za-z_][A-Za-z0-9_]{2,}", question)
    # Prefer distinctive tokens (CamelCase / snake with underscore / long).
    scored = sorted(
        set(tokens),
        key=lambda t: (("_" in t) or any(c.isupper() for c in t[1:]), len(t)),
        reverse=True,
    )
    return scored[:4]


def gather_context(question: str) -> str:
    """Build a compact context pack for the synthesizer LLM."""
    rows = list(db.explore(question) or [])
    if len(rows) < 3:
        for term in _extra_terms(question):
            more = db.search(term) or []
            seen = {(r.get("file_path"), r.get("name")) for r in rows}
            for r in more:
                key = (r.get("file_path"), r.get("name"))
                if key not in seen:
                    rows.append(r)
                    seen.add(key)
            if len(rows) >= _MAX_HITS:
                break

    parts = [
        "## Symbol index hits",
        _format_hits(rows),
        "",
        "## Source excerpts",
    ]

    used_files: set[str] = set()
    for row in rows:
        if len(used_files) >= _MAX_FILES:
            break
        path = row.get("file_path") or ""
        if not path or path in used_files:
            continue
        used_files.add(path)
        start = int(row.get("start_line") or 1)
        end = int(row.get("end_line") or (start + _WINDOW))
        parts.append(f"### {path}:{start}-{end}")
        parts.append(_read_window(path, start, end))
        parts.append("")

    if not used_files:
        parts.append("(no source excerpts — index miss)")

    context = "\n".join(parts)
    if len(context) > _CONTEXT_CAP:
        context = context[: _CONTEXT_CAP - 20] + "\n... (truncated)"
    return context
