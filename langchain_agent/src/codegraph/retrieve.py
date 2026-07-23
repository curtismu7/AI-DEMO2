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

# Shared with db._sanitize_fts — keep filler out of identifier search too.
_STOPWORDS = frozenset({
    "a", "an", "the", "and", "or", "but", "if", "then", "else", "when",
    "how", "what", "where", "why", "who", "which", "whom", "whose",
    "is", "are", "was", "were", "be", "been", "being", "do", "does", "did",
    "to", "of", "in", "on", "for", "with", "from", "by", "as", "at", "into",
    "about", "over", "after", "before", "between", "through",
    "this", "that", "these", "those", "it", "its", "they", "them", "their",
    "we", "our", "you", "your", "me", "my", "i",
    "can", "could", "should", "would", "will", "may", "might", "must",
    "please", "show", "tell", "explain", "describe", "walk", "work", "works",
    "working", "code", "file", "files", "function", "functions", "class",
})


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
    """Pull identifier-like tokens and compound variants for symbol search."""
    tokens = re.findall(r"[A-Za-z_][A-Za-z0-9_]{2,}", question)
    content = [t for t in tokens if t.lower() not in _STOPWORDS]
    scored = sorted(
        set(content),
        key=lambda t: (("_" in t) or any(c.isupper() for c in t[1:]), len(t)),
        reverse=True,
    )
    # "MCP gateway" → also try mcpGateway / McpGateway / mcp_gateway.
    words = [t for t in re.findall(r"[A-Za-z][A-Za-z0-9]+", question) if t.lower() not in _STOPWORDS]
    compounds: list[str] = []
    if len(words) >= 2:
        a, b = words[0], words[1]
        al, bl = a.lower(), b.lower()
        compounds.extend([
            f"{al}{bl}",
            f"{al}_{bl}",
            f"{al}{b[:1].upper()}{b[1:]}",
            f"{a[:1].upper()}{al[1:]}{b[:1].upper()}{bl[1:]}",
        ])
    out: list[str] = []
    seen: set[str] = set()
    for term in [*compounds, *scored]:
        if not term or term.lower() in seen:
            continue
        seen.add(term.lower())
        out.append(term)
        if len(out) >= 6:
            break
    return out


def _hit_relevance(row: dict, terms: list[str]) -> int:
    """Score how well a hit matches distinctive query terms (name/path)."""
    path = (row.get("file_path") or "").lower()
    name = (row.get("name") or "").lower()
    qn = (row.get("qualified_name") or "").lower()
    blob = f"{name} {qn} {path}"
    score = 0
    for term in terms:
        t = term.lower()
        if not t:
            continue
        if t in name:
            score += 4
        elif t in blob:
            score += 1
    # Prefer implementation packages over UI chrome / test fixtures.
    if path.startswith("demo_mcp_gateway/") and "/tests/" not in path:
        score += 6
    # BFF→gateway chokepoint — Code Explorer starter chip "How does the MCP gateway work?"
    if "mcpgatewayclient" in path or name in ("calltoolviagateway", "calltoolviaresolvedgateway"):
        score += 7
    if "authorizemcprequest" in name:
        score += 5
    if "/services/" in path or "/src/" in path:
        score += 2
    if "/tests/" in path or "/__tests__/" in path or ".test." in path or ".spec." in path:
        score -= 8
    if path.startswith("demo_api_ui/"):
        score -= 2
    return score


def gather_context(question: str) -> str:
    """Build a compact context pack for the synthesizer LLM."""
    terms = _extra_terms(question)
    rows = list(db.explore(question) or [])

    # Always blend symbol-name search. FTS OR-queries often return plentiful
    # but irrelevant hits (enough to skip a "thin results" gate); search on
    # identifiers like mcpGateway is what actually finds the right files.
    seen = {(r.get("file_path"), r.get("name")) for r in rows}
    for term in terms:
        for r in db.search(term) or []:
            key = (r.get("file_path"), r.get("name"))
            if key in seen:
                continue
            rows.append(r)
            seen.add(key)
        if len(rows) >= _MAX_HITS * 2:
            break

    if terms:
        rows.sort(key=lambda r: _hit_relevance(r, terms), reverse=True)
    rows = rows[:_MAX_HITS]

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
