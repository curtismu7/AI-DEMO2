"""
LangChain tool wrappers for the CodeGraph SQLite query layer.

Provides four BaseTool subclasses wrapping db.py functions:
- CodeGraphExploreTool: FTS5 full-text search
- CodeGraphSearchTool: Symbol name search
- CodeGraphCallersTool: Find callers of a symbol
- CodeGraphCalleesTool: Find callees of a symbol

All tools format output as newline-separated records with max 4000 chars.
"""

import re

from langchain_core.tools import BaseTool
from src.codegraph import db
from src.codegraph import repo

_TRUNCATE_AT = 3970
_TRUNCATE_SUFFIX = "\n... (truncated)"


def _format_rows(rows: list[dict], *, call_line: bool = False) -> str:
    """Format db result rows as a compact newline-separated string, capped at 4000 chars."""
    if not rows:
        return "No results found."
    lines = []
    for row in rows:
        entry = (
            f"{row.get('name', '')} ({row.get('kind', '')}) — "
            f"{row.get('file_path', '')}:{row.get('start_line', '')}"
        )
        if call_line:
            entry += f" (calls at line {row.get('call_line', '')})"
        lines.append(entry)
    result = "\n".join(lines)
    if len(result) > 4000:
        result = result[:_TRUNCATE_AT] + _TRUNCATE_SUFFIX
    return result


class CodeGraphExploreTool(BaseTool):
    """Full-text search across code symbols."""

    name: str = "codegraph_explore"
    description: str = (
        "Full-text search across all code symbols. "
        "Use for broad questions like 'how does X work' or 'what is Y'. "
        "Input: a natural-language query string."
    )

    def _run(self, query: str) -> str:
        return _format_rows(db.explore(query))

    async def _arun(self, query: str) -> str:
        # SQLite is synchronous; no async driver available. Fine for this use case.
        return self._run(query)


class CodeGraphSearchTool(BaseTool):
    """Search for a specific symbol by name."""

    name: str = "codegraph_search"
    description: str = (
        "Search for a specific symbol by name. "
        "Returns qualified names and file:line locations. "
        "Input: a symbol name or partial name."
    )

    def _run(self, term: str = "", **kwargs) -> str:
        return _format_rows(db.search(term or kwargs.get("query", "")))

    async def _arun(self, term: str = "", **kwargs) -> str:
        return self._run(term, **kwargs)


class CodeGraphCallersTool(BaseTool):
    """Find all code locations that call a given symbol."""

    name: str = "codegraph_callers"
    description: str = (
        "Find all code locations that call a given symbol. "
        "Input: exact symbol name."
    )

    def _run(self, symbol: str = "", **kwargs) -> str:
        return _format_rows(db.callers(symbol or kwargs.get("query", "")), call_line=True)

    async def _arun(self, symbol: str = "", **kwargs) -> str:
        return self._run(symbol, **kwargs)


class CodeGraphCalleesTool(BaseTool):
    """Find all symbols called by a given function."""

    name: str = "codegraph_callees"
    description: str = (
        "Find all symbols called by a given function. "
        "Input: exact symbol name."
    )

    def _run(self, symbol: str = "", **kwargs) -> str:
        return _format_rows(db.callees(symbol or kwargs.get("query", "")), call_line=True)

    async def _arun(self, symbol: str = "", **kwargs) -> str:
        return self._run(symbol, **kwargs)


_READ_MAX_CHARS = 8000


class ReadFileTool(BaseTool):
    """Read the actual source of a repo file (optionally a line window)."""

    name: str = "read_file"
    description: str = (
        "Read the ACTUAL source of a repo file. Input: a repo-relative path, "
        "optionally with a line range as ':start:end', e.g. "
        "'demo_api_server/services/mcpGatewayClient.js' or "
        "'demo_api_server/services/mcpGatewayClient.js:140:175'. Returns "
        "line-numbered source (capped). Use after grep or codegraph_search "
        "gives you a file:line."
    )

    def _run(self, path: str = "", **kwargs) -> str:
        path = path or kwargs.get("query", "")
        start = kwargs.get("start")
        end = kwargs.get("end")
        spec = path.strip()
        # Support both calling conventions:
        #   single-string:  "file.js:140:175"
        #   separate kwargs: path="file.js", start=140, end=175
        if start is None and end is None:
            m = re.match(r"^(.*?):(\d+):(\d+)$", spec)
            if m:
                spec, start, end = m.group(1), int(m.group(2)), int(m.group(3))
        elif start is not None:
            start = int(start)
            end = int(end) if end is not None else start + 100
        target = repo.resolve_in_root(spec)
        if target is None:
            return f"File not found or outside the repo: {spec}"
        lines = target.read_text(encoding="utf-8", errors="replace").splitlines()
        if start is not None:
            s = max(1, start)
            e = min(len(lines), end)
            window, offset = lines[s - 1:e], s
        else:
            window, offset = lines, 1
        if start is not None and not window:
            return f"Empty line range: {start}-{end}"
        numbered = "\n".join(f"{offset + i}\t{ln}" for i, ln in enumerate(window))
        if len(numbered) > _READ_MAX_CHARS:
            numbered = numbered[: _READ_MAX_CHARS - len(_TRUNCATE_SUFFIX)] + _TRUNCATE_SUFFIX
        return numbered or "(empty file)"

    async def _arun(self, path: str = "", **kwargs) -> str:
        return self._run(path, **kwargs)


_GREP_MAX_PER_FILE = 2
_GREP_MAX_FILES = 40
_GREP_MAX_CHARS = 6000


class RepoGrepTool(BaseTool):
    """Regex search across the repo source — the strongest keyword locator."""

    name: str = "grep"
    description: str = (
        "Search the repo source with a regular expression; returns up to a few "
        "matching lines per file as 'file:line: text', spanning many files. The "
        "strongest way to LOCATE code by keyword (identifier names, route "
        "strings, config keys). Input: a regex pattern. Then read_file the most "
        "relevant hits to explain them."
    )

    def _run(self, pattern: str = "", **kwargs) -> str:
        pattern = pattern or kwargs.get("query", "")
        try:
            rx = re.compile(pattern, re.IGNORECASE)
        except re.error as e:
            return f"Invalid regex: {e}"
        root = repo.repo_src_root()
        lines: list[str] = []
        files_with_matches = 0
        for path in repo.iter_source_files(root):
            if files_with_matches >= _GREP_MAX_FILES:
                break
            try:
                rel = path.relative_to(root).as_posix()
            except ValueError:
                continue
            file_hits: list[str] = []
            if rx.search(rel):
                file_hits.append(f"{rel}:0: (file name match)")
            try:
                with path.open(encoding="utf-8", errors="replace") as fh:
                    content_hits = 0
                    for n, line in enumerate(fh, 1):
                        if rx.search(line):
                            file_hits.append(f"{rel}:{n}: {line.strip()[:200]}")
                            content_hits += 1
                            if content_hits >= _GREP_MAX_PER_FILE:
                                break
            except (OSError, ValueError):
                # keep any filename match even if the file can't be read
                pass
            if file_hits:
                lines.extend(file_hits)
                files_with_matches += 1
        if not lines:
            return "No matches found."
        out = "\n".join(lines)
        if len(out) > _GREP_MAX_CHARS:
            out = out[: _GREP_MAX_CHARS - len(_TRUNCATE_SUFFIX)] + _TRUNCATE_SUFFIX
        if files_with_matches >= _GREP_MAX_FILES:
            out += f"\n... (showing first {_GREP_MAX_FILES} files with matches; refine the pattern)"
        return out

    async def _arun(self, pattern: str = "", **kwargs) -> str:
        return self._run(pattern, **kwargs)


def get_codegraph_tools() -> list[BaseTool]:
    """All Code Explorer agent tools: structural codegraph + source grep/read."""
    return [
        CodeGraphExploreTool(),
        CodeGraphSearchTool(),
        CodeGraphCallersTool(),
        CodeGraphCalleesTool(),
        RepoGrepTool(),
        ReadFileTool(),
    ]
