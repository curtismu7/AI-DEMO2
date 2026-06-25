# Code Explorer Hybrid Retrieval — P1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the existing Code Explorer ReAct agent two new pure-Python tools — `grep` and `read_file` — over the actual repo source, and ship that source into the langchain_agent image, so it answers from real implementation instead of metadata only.

**Architecture:** Add a `src/codegraph/repo.py` module that resolves a `REPO_SRC_ROOT` (the repo root locally; `/app/repo-src` in the image), iterates the same source files `build-codegraph.py` indexes, and safely resolves paths. Two new `BaseTool` subclasses (`RepoGrepTool`, `ReadFileTool`) use it; the agent factory registers them and the system prompt is updated to grep-first → read_file → codegraph-structure. `build-codegraph.py` gains a `--stage-src` flag to copy the indexed source into a staging dir the Dockerfile COPYs.

**Tech Stack:** Python 3.11, LangChain (`langchain_core.tools.BaseTool`), LangGraph `create_react_agent`, pytest, Docker.

**Spec:** `docs/superpowers/specs/2026-06-12-code-explorer-hybrid-retrieval-design.md` (Phase P1 = sections 5.2-A and 5.2-B).

**Working directory:** all paths are relative to the repo root `/Users/curtismuir/Development/AI-Demo`. Python tests run from `langchain_agent/` (its pytest config). Use that repo's existing venv/interpreter.

---

## File Structure

- **Create** `langchain_agent/src/codegraph/repo.py` — repo-source root resolution, source-file iteration, path-traversal-safe resolution. One responsibility: "where is the source and which files may the agent read."
- **Create** `langchain_agent/tests/test_codegraph_repo.py` — unit tests for `repo.py`.
- **Modify** `langchain_agent/src/codegraph/tools.py` — append `RepoGrepTool` + `ReadFileTool`; extend `get_codegraph_tools()`.
- **Modify** `langchain_agent/tests/test_codegraph_tools.py` — add tests for the two new tools; update the factory tests (4 → 6 tools).
- **Modify** `langchain_agent/src/codegraph/agent.py` — update `SYSTEM_PROMPT` (grep-first strategy).
- **Modify** `scripts/build-codegraph.py` — add `--stage-src <dir>` flag (reuses the existing walk).
- **Modify** `langchain_agent/Dockerfile` — COPY the staged source + `ENV REPO_SRC_ROOT=/app/repo-src`.
- **Modify** `demo_api_server/scripts/setupFresh.js` — stage the source alongside the codegraph build.
- **Modify** `.gitignore` — ignore `langchain_agent/repo-src/` (generated staging dir).

---

## Task 1: `repo.py` — source root, iteration, safe resolve

**Files:**
- Create: `langchain_agent/src/codegraph/repo.py`
- Test: `langchain_agent/tests/test_codegraph_repo.py`

- [ ] **Step 1: Write the failing test**

Create `langchain_agent/tests/test_codegraph_repo.py`:

```python
"""Tests for repo.py — source root resolution, iteration, and safe path resolve."""
import os
from pathlib import Path

import pytest

from src.codegraph import repo


def _make_tree(tmp_path: Path) -> Path:
    (tmp_path / "demo_api_server" / "services").mkdir(parents=True)
    (tmp_path / "demo_api_server" / "services" / "a.js").write_text("const a = 1;\n")
    (tmp_path / "demo_api_server" / "b.py").write_text("x = 1\n")
    (tmp_path / "node_modules" / "dep").mkdir(parents=True)
    (tmp_path / "node_modules" / "dep" / "c.js").write_text("ignored\n")
    (tmp_path / ".codegraph").mkdir()
    (tmp_path / ".codegraph" / "d.js").write_text("ignored\n")
    (tmp_path / "readme.md").write_text("# not source\n")
    return tmp_path


def test_repo_src_root_prefers_env(monkeypatch, tmp_path):
    monkeypatch.setenv("REPO_SRC_ROOT", str(tmp_path))
    assert repo.repo_src_root() == tmp_path.resolve()


def test_repo_src_root_falls_back_to_repo_root(monkeypatch):
    monkeypatch.delenv("REPO_SRC_ROOT", raising=False)
    root = repo.repo_src_root()
    # The fallback is the repo root inferred from this module's location.
    assert (root / "langchain_agent").is_dir()


def test_iter_source_files_includes_code_excludes_vendor(tmp_path):
    _make_tree(tmp_path)
    found = {p.relative_to(tmp_path).as_posix() for p in repo.iter_source_files(tmp_path)}
    assert "demo_api_server/services/a.js" in found
    assert "demo_api_server/b.py" in found
    assert "node_modules/dep/c.js" not in found
    assert ".codegraph/d.js" not in found
    assert "readme.md" not in found  # .md is not a source extension


def test_resolve_in_root_ok(tmp_path):
    _make_tree(tmp_path)
    target = repo.resolve_in_root("demo_api_server/b.py", tmp_path)
    assert target is not None and target.name == "b.py"


def test_resolve_in_root_rejects_traversal(tmp_path):
    _make_tree(tmp_path)
    assert repo.resolve_in_root("../etc/passwd", tmp_path) is None
    assert repo.resolve_in_root("/etc/passwd", tmp_path) is None


def test_resolve_in_root_missing_file(tmp_path):
    _make_tree(tmp_path)
    assert repo.resolve_in_root("demo_api_server/nope.js", tmp_path) is None
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd langchain_agent && python -m pytest tests/test_codegraph_repo.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'src.codegraph.repo'`.

- [ ] **Step 3: Write the minimal implementation**

Create `langchain_agent/src/codegraph/repo.py`:

```python
"""Repo source access for the Code Explorer agent's grep/read_file tools.

The agent answers from ACTUAL source, not just the codegraph metadata DB. In
production the indexed source subset is shipped into the image and REPO_SRC_ROOT
points at it (/app/repo-src); locally it defaults to the repo root (live files).

The skip/extension sets mirror scripts/build-codegraph.py so grep/read see
exactly what the graph indexes.
"""
import os
from pathlib import Path
from typing import Iterator, Optional

# Mirror scripts/build-codegraph.py SKIP_DIRS (+ the generated graph dirs) and
# its PY_EXTS|JS_EXTS, plus the React extensions the codebase uses.
SKIP_DIRS = {
    "node_modules", ".git", "__pycache__", ".venv", "venv", "env",
    ".codegraph", "graphify-out", ".planning", "dist", "build", "coverage",
}
SOURCE_EXTENSIONS = {".py", ".js", ".ts", ".mjs", ".cjs", ".jsx", ".tsx"}


def repo_src_root() -> Path:
    """Root of the source tree the agent may read.

    REPO_SRC_ROOT wins (set to /app/repo-src in the image). Otherwise fall back
    to the repo root inferred from this file's location:
    langchain_agent/src/codegraph/repo.py -> parents[3] == repo root.
    """
    env = os.getenv("REPO_SRC_ROOT")
    if env:
        return Path(env).resolve()
    return Path(__file__).resolve().parents[3]


def iter_source_files(root: Optional[Path] = None) -> Iterator[Path]:
    """Yield indexed source files under root, skipping vendored/generated dirs."""
    base = root or repo_src_root()
    for dirpath, dirnames, filenames in os.walk(base):
        dirnames[:] = [
            d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".")
        ]
        for fn in filenames:
            p = Path(dirpath) / fn
            if p.suffix.lower() in SOURCE_EXTENSIONS:
                yield p


def resolve_in_root(rel_path: str, root: Optional[Path] = None) -> Optional[Path]:
    """Resolve rel_path under root. Return None if it escapes root or is missing."""
    base = (root or repo_src_root()).resolve()
    try:
        candidate = (base / rel_path).resolve()
    except (ValueError, OSError):
        return None
    if candidate != base and not candidate.is_relative_to(base):
        return None
    if not candidate.is_file():
        return None
    return candidate
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd langchain_agent && python -m pytest tests/test_codegraph_repo.py -v`
Expected: PASS (6 passed).

- [ ] **Step 5: Commit**

```bash
git add langchain_agent/src/codegraph/repo.py langchain_agent/tests/test_codegraph_repo.py
git commit -m "feat(code-explorer): repo source access module (root/iter/safe-resolve)"
```

---

## Task 2: `read_file` tool

**Files:**
- Modify: `langchain_agent/src/codegraph/tools.py`
- Test: `langchain_agent/tests/test_codegraph_tools.py`

- [ ] **Step 1: Write the failing test**

Append to `langchain_agent/tests/test_codegraph_tools.py`:

```python
class TestReadFileTool:
    """Tests for ReadFileTool."""

    def test_reads_whole_file_numbered(self, tmp_path, monkeypatch):
        from src.codegraph.tools import ReadFileTool
        (tmp_path / "x.js").write_text("const a = 1;\nconst b = 2;\n")
        monkeypatch.setenv("REPO_SRC_ROOT", str(tmp_path))
        result = ReadFileTool()._run("x.js")
        assert "1\tconst a = 1;" in result
        assert "2\tconst b = 2;" in result

    def test_reads_line_window(self, tmp_path, monkeypatch):
        from src.codegraph.tools import ReadFileTool
        (tmp_path / "x.py").write_text("\n".join(f"line{i}" for i in range(1, 21)) + "\n")
        monkeypatch.setenv("REPO_SRC_ROOT", str(tmp_path))
        result = ReadFileTool()._run("x.py:5:7")
        assert "5\tline5" in result
        assert "7\tline7" in result
        assert "line4" not in result
        assert "line8" not in result

    def test_missing_or_escaping_path(self, tmp_path, monkeypatch):
        from src.codegraph.tools import ReadFileTool
        monkeypatch.setenv("REPO_SRC_ROOT", str(tmp_path))
        assert "not found" in ReadFileTool()._run("nope.js").lower()
        assert "not found" in ReadFileTool()._run("../escape.js").lower()
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd langchain_agent && python -m pytest tests/test_codegraph_tools.py::TestReadFileTool -v`
Expected: FAIL — `ImportError: cannot import name 'ReadFileTool'`.

- [ ] **Step 3: Write the minimal implementation**

In `langchain_agent/src/codegraph/tools.py`, add `import re` near the top (after the existing imports) and `from src.codegraph import repo`, then append before `get_codegraph_tools`:

```python
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

    def _run(self, path: str) -> str:
        spec = path.strip()
        start = end = None
        m = re.match(r"^(.*?):(\d+):(\d+)$", spec)
        if m:
            spec, start, end = m.group(1), int(m.group(2)), int(m.group(3))
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
        numbered = "\n".join(f"{offset + i}\t{ln}" for i, ln in enumerate(window))
        if len(numbered) > _READ_MAX_CHARS:
            numbered = numbered[: _READ_MAX_CHARS - len(_TRUNCATE_SUFFIX)] + _TRUNCATE_SUFFIX
        return numbered or "(empty file)"

    async def _arun(self, path: str) -> str:
        return self._run(path)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd langchain_agent && python -m pytest tests/test_codegraph_tools.py::TestReadFileTool -v`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add langchain_agent/src/codegraph/tools.py langchain_agent/tests/test_codegraph_tools.py
git commit -m "feat(code-explorer): add read_file tool over repo source"
```

---

## Task 3: `grep` tool

**Files:**
- Modify: `langchain_agent/src/codegraph/tools.py`
- Test: `langchain_agent/tests/test_codegraph_tools.py`

- [ ] **Step 1: Write the failing test**

Append to `langchain_agent/tests/test_codegraph_tools.py`:

```python
class TestRepoGrepTool:
    """Tests for RepoGrepTool."""

    def test_finds_matches_with_file_line(self, tmp_path, monkeypatch):
        from src.codegraph.tools import RepoGrepTool
        (tmp_path / "svc").mkdir()
        (tmp_path / "svc" / "auth.js").write_text("function ruleStore() {}\nconst x = 1;\n")
        monkeypatch.setenv("REPO_SRC_ROOT", str(tmp_path))
        result = RepoGrepTool()._run("ruleStore")
        assert "svc/auth.js:1:" in result
        assert "ruleStore" in result

    def test_case_insensitive(self, tmp_path, monkeypatch):
        from src.codegraph.tools import RepoGrepTool
        (tmp_path / "a.py").write_text("DELEGATION_DB = 'x'\n")
        monkeypatch.setenv("REPO_SRC_ROOT", str(tmp_path))
        assert "a.py:1:" in RepoGrepTool()._run("delegation")

    def test_no_matches(self, tmp_path, monkeypatch):
        from src.codegraph.tools import RepoGrepTool
        (tmp_path / "a.py").write_text("nothing here\n")
        monkeypatch.setenv("REPO_SRC_ROOT", str(tmp_path))
        assert RepoGrepTool()._run("zzz_no_match") == "No matches found."

    def test_invalid_regex(self, tmp_path, monkeypatch):
        from src.codegraph.tools import RepoGrepTool
        monkeypatch.setenv("REPO_SRC_ROOT", str(tmp_path))
        assert "invalid regex" in RepoGrepTool()._run("(unclosed").lower()
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd langchain_agent && python -m pytest tests/test_codegraph_tools.py::TestRepoGrepTool -v`
Expected: FAIL — `ImportError: cannot import name 'RepoGrepTool'`.

- [ ] **Step 3: Write the minimal implementation**

In `langchain_agent/src/codegraph/tools.py`, append before `get_codegraph_tools`:

```python
_GREP_MAX_MATCHES = 60


class RepoGrepTool(BaseTool):
    """Regex search across the repo source — the strongest keyword locator."""

    name: str = "grep"
    description: str = (
        "Search the repo source with a regular expression; returns matching "
        "file:line: text. The strongest way to LOCATE code by keyword "
        "(identifier names, route strings, config keys). Input: a regex "
        "pattern. Then read_file the most relevant hits to explain them."
    )

    def _run(self, pattern: str) -> str:
        try:
            rx = re.compile(pattern, re.IGNORECASE)
        except re.error as e:
            return f"Invalid regex: {e}"
        root = repo.repo_src_root()
        hits: list[str] = []
        for path in repo.iter_source_files(root):
            try:
                with path.open(encoding="utf-8", errors="replace") as fh:
                    for n, line in enumerate(fh, 1):
                        if rx.search(line):
                            rel = path.relative_to(root).as_posix()
                            hits.append(f"{rel}:{n}: {line.strip()[:200]}")
                            if len(hits) >= _GREP_MAX_MATCHES:
                                break
            except (OSError, ValueError):
                continue
            if len(hits) >= _GREP_MAX_MATCHES:
                break
        if not hits:
            return "No matches found."
        out = "\n".join(hits)
        if len(hits) >= _GREP_MAX_MATCHES:
            out += f"\n... (capped at {_GREP_MAX_MATCHES} matches; refine the pattern)"
        return out

    async def _arun(self, pattern: str) -> str:
        return self._run(pattern)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd langchain_agent && python -m pytest tests/test_codegraph_tools.py::TestRepoGrepTool -v`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add langchain_agent/src/codegraph/tools.py langchain_agent/tests/test_codegraph_tools.py
git commit -m "feat(code-explorer): add grep tool over repo source"
```

---

## Task 4: Register the new tools + update the factory tests

**Files:**
- Modify: `langchain_agent/src/codegraph/tools.py:106-113` (the `get_codegraph_tools` factory)
- Test: `langchain_agent/tests/test_codegraph_tools.py` (the `TestGetCodegraphTools` class)

- [ ] **Step 1: Update the failing factory tests**

In `langchain_agent/tests/test_codegraph_tools.py`, replace `test_returns_four_tools` and `test_tool_names` in `TestGetCodegraphTools` with:

```python
    def test_returns_six_tools(self):
        """Factory returns the four codegraph tools plus grep + read_file."""
        tools = get_codegraph_tools()
        assert len(tools) == 6

    def test_tool_names(self):
        tools = get_codegraph_tools()
        names = {t.name for t in tools}
        expected_names = {
            "codegraph_explore",
            "codegraph_search",
            "codegraph_callers",
            "codegraph_callees",
            "grep",
            "read_file",
        }
        assert names == expected_names
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd langchain_agent && python -m pytest tests/test_codegraph_tools.py::TestGetCodegraphTools -v`
Expected: FAIL — factory returns 4, names set mismatch.

- [ ] **Step 3: Update the factory**

In `langchain_agent/src/codegraph/tools.py`, replace `get_codegraph_tools`:

```python
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
```

- [ ] **Step 4: Run the full tools test file to verify it passes**

Run: `cd langchain_agent && python -m pytest tests/test_codegraph_tools.py -v`
Expected: PASS (all, including the new TestReadFileTool/TestRepoGrepTool and the updated factory tests).

- [ ] **Step 5: Commit**

```bash
git add langchain_agent/src/codegraph/tools.py langchain_agent/tests/test_codegraph_tools.py
git commit -m "feat(code-explorer): register grep + read_file in the agent toolset"
```

---

## Task 5: Update the agent system prompt (grep-first strategy)

**Files:**
- Modify: `langchain_agent/src/codegraph/agent.py:10-21` (the `SYSTEM_PROMPT`)
- Test: `langchain_agent/tests/test_codegraph_agent.py`

- [ ] **Step 1: Write the failing test**

Append to `langchain_agent/tests/test_codegraph_agent.py` (new test asserting the prompt teaches the new strategy):

```python
def test_system_prompt_mentions_grep_and_read_file():
    from src.codegraph.agent import SYSTEM_PROMPT
    lowered = SYSTEM_PROMPT.lower()
    assert "grep" in lowered
    assert "read_file" in lowered
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd langchain_agent && python -m pytest tests/test_codegraph_agent.py::test_system_prompt_mentions_grep_and_read_file -v`
Expected: FAIL — prompt does not mention grep/read_file.

- [ ] **Step 3: Update the prompt**

In `langchain_agent/src/codegraph/agent.py`, replace `SYSTEM_PROMPT`:

```python
SYSTEM_PROMPT = """You are a code navigator for the AI-Demo repository — a multi-vertical AI agent \
security demo built on PingOne, MCP, and LangChain. The repo contains:
- demo_api_server: Node.js BFF
- demo_mcp_gateway / demo_mcp_server: MCP protocol services
- langchain_agent: Python LangChain agent
- demo_api_ui: React frontend
- demo_authz_server: mock PingOne Authorize

Answer ONLY from real code you have looked up. Recommended flow:
1. `grep` with a keyword from the question (an identifier, route, or config key) \
to LOCATE the relevant files — this is your strongest tool.
2. `read_file` on the most relevant hit (optionally a ':start:end' line window) \
to read the ACTUAL implementation you will explain.
3. `codegraph_search` / `codegraph_callers` / `codegraph_callees` to trace \
structure ("what calls X", "what does X call") when the question is about flow.
Always cite file:line references. Keep answers focused and concrete. If grep \
finds nothing, try a synonym or a broader pattern before giving up."""
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd langchain_agent && python -m pytest tests/test_codegraph_agent.py -v`
Expected: PASS (the new test plus the existing agent tests).

- [ ] **Step 5: Commit**

```bash
git add langchain_agent/src/codegraph/agent.py langchain_agent/tests/test_codegraph_agent.py
git commit -m "feat(code-explorer): grep-first agent prompt for the hybrid toolset"
```

---

## Task 6: `--stage-src` flag on build-codegraph.py

**Files:**
- Modify: `scripts/build-codegraph.py`
- Test: `langchain_agent/tests/test_stage_src.py` (a thin integration test invoking the script)

The flag copies every indexed source file (preserving its repo-relative path) into a staging dir, reusing the script's existing walk so the staged set exactly matches the graph.

- [ ] **Step 1: Write the failing test**

Create `langchain_agent/tests/test_stage_src.py`:

```python
"""Integration test for `build-codegraph.py --stage-src`."""
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "scripts" / "build-codegraph.py"


def test_stage_src_copies_indexed_files(tmp_path):
    src = tmp_path / "src_repo"
    (src / "demo_api_server").mkdir(parents=True)
    (src / "demo_api_server" / "a.js").write_text("const a = 1;\n")
    (src / "node_modules").mkdir()
    (src / "node_modules" / "b.js").write_text("ignored\n")
    dest = tmp_path / "staged"

    result = subprocess.run(
        [sys.executable, str(SCRIPT), str(src), "--stage-src", str(dest)],
        capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stderr
    assert (dest / "demo_api_server" / "a.js").is_file()
    assert not (dest / "node_modules" / "b.js").exists()
```

NOTE: confirm during implementation whether `build-codegraph.py` accepts a positional root argument. If it only indexes the repo root, add an optional positional `root` argument as part of this task (it already computes `REPO_ROOT`; make the walk honor an explicit root when given). Keep that change minimal and covered by this test.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd langchain_agent && python -m pytest tests/test_stage_src.py -v`
Expected: FAIL — unrecognized `--stage-src` (or the staged file is absent).

- [ ] **Step 3: Implement the flag**

In `scripts/build-codegraph.py`: parse `--stage-src <dir>` and an optional positional `root` (default `REPO_ROOT`). After (or instead of) building the DB, when `--stage-src` is set, walk the same files (reuse the existing walk that honors `SKIP_DIRS` and `not d.startswith('.')`) and copy each into `<dir>` preserving the path relative to `root`. Concretely add a helper and call it from `main()`:

```python
import shutil

def stage_source(root: Path, dest: Path) -> int:
    """Copy every indexed source file into dest, preserving relative paths."""
    count = 0
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith('.')]
        for fn in filenames:
            p = Path(dirpath) / fn
            if p.suffix.lower() in (PY_EXTS | JS_EXTS):
                rel = p.relative_to(root)
                out = dest / rel
                out.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(p, out)
                count += 1
    return count
```

Wire into argument parsing: accept `--stage-src DIR`; if present, call `stage_source(root, Path(dir))`, print `Staged N source files into <dir>`, and exit 0 (staging may run with or without a DB build — keep it independent and simple).

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd langchain_agent && python -m pytest tests/test_stage_src.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/build-codegraph.py langchain_agent/tests/test_stage_src.py
git commit -m "feat(code-explorer): build-codegraph --stage-src to copy indexed source"
```

---

## Task 7: Ship the source into the image + wire staging into setup

**Files:**
- Modify: `langchain_agent/Dockerfile:36-46`
- Modify: `demo_api_server/scripts/setupFresh.js` (the `buildCodeGraph` area)
- Modify: `.gitignore`

- [ ] **Step 1: Ignore the generated staging dir**

Append to `.gitignore`:

```
# Code Explorer: source subset staged into the langchain_agent image (generated
# by `build-codegraph.py --stage-src`). Regenerable; never commit.
langchain_agent/repo-src/
```

- [ ] **Step 2: Stage source during fresh setup**

In `demo_api_server/scripts/setupFresh.js`, immediately after the existing `buildCodeGraph()` step runs `build-codegraph.py`, add a second invocation that stages the source for the image. Mirror the existing spawn pattern used for the indexer (same `py` interpreter resolution, same graceful-skip on missing python3). The command is:

```
<py> scripts/build-codegraph.py --stage-src langchain_agent/repo-src
```

Log `  Staging repo source for the Code Explorer image → langchain_agent/repo-src` before running, and warn-but-continue on non-zero exit (parity with the indexer's graceful degradation).

- [ ] **Step 3: COPY the staged source into the image**

In `langchain_agent/Dockerfile`, after the `COPY langchain_agent/scripts/ ./scripts/` line (line 45), add:

```dockerfile
# Code Explorer: the indexed repo source subset, staged by
# `build-codegraph.py --stage-src langchain_agent/repo-src` (run in setup:fresh /
# pre-image build). The agent's grep/read_file tools read from here. If the dir
# is absent in the build context the COPY fails the build — staging is required
# for the hybrid agent, so that is the intended signal.
COPY langchain_agent/repo-src/ ./repo-src/
ENV REPO_SRC_ROOT=/app/repo-src
```

- [ ] **Step 4: Verify the build context and local default**

Run (local sanity — staging + tool over the live tree, no Docker needed):

```bash
cd /Users/curtismuir/Development/AI-Demo
python3 scripts/build-codegraph.py --stage-src langchain_agent/repo-src
ls langchain_agent/repo-src/demo_api_server/services/mcpGatewayClient.js
cd langchain_agent && REPO_SRC_ROOT="$PWD/repo-src" python -c "from src.codegraph.tools import RepoGrepTool; print(RepoGrepTool()._run('GATEWAY_TOKEN_REJECTED')[:200])"
```

Expected: the staged file exists; the grep prints a `demo_api_server/services/mcpGatewayClient.js:<line>:` hit.

- [ ] **Step 5: Commit**

```bash
git add .gitignore langchain_agent/Dockerfile demo_api_server/scripts/setupFresh.js
git commit -m "feat(code-explorer): ship indexed source into the agent image (REPO_SRC_ROOT)"
```

---

## Task 8: Full suite + bake-off regression gate

**Files:** none (validation only).

- [ ] **Step 1: Run the langchain_agent test suite**

Run: `cd langchain_agent && python -m pytest -q`
Expected: PASS (the prior green suite plus the new repo/grep/read/stage tests). Fix any regressions before proceeding.

- [ ] **Step 2: Re-run the 6-question bake-off against the NEW agent**

For each of the six spec questions (§1 of the design spec: OAuth login, authz server rules, tool authorization, RFC 8693 token chain, HITL consent, family delegation), exercise the new toolset over the live tree and score ground-truth file hits exactly as the design spec did. The mechanical way that mirrors what the agent now does:

```bash
cd /Users/curtismuir/Development/AI-Demo/langchain_agent
# grep-first locate, then read_file — what the agent will do per question:
python - <<'PY'
from src.codegraph.tools import RepoGrepTool
for q, pat in [
    ("OAuth login",       r"pkce|oauth.*callback|authStateCookie|generate_authorization_url"),
    ("Authz server rules", r"ruleStore|/decision|enforce_may_act"),
    ("Tool authorization", r"mcpToolAuthorization|pingOneAuthorize|pingAuthorizeGuard"),
    ("Token chain 8693",   r"agentMcpToken|mcpGatewayClient|tokenChainService|token-exchange"),
    ("HITL consent",       r"transactionConsentChallenge|AgentConsentModal|hitl"),
    ("Delegation",         r"delegationService|DelegatedAccess|routes/delegation"),
]:
    hits = RepoGrepTool()._run(pat)
    print(f"\n=== {q} ===\n" + "\n".join(hits.splitlines()[:6]))
PY
```

Expected: every question surfaces its ground-truth files (the grep tool alone scored 3.7/5 in the bake-off; with read_file for bodies the agent's answers should land at the spec's P1 gate of **average ≥ 4**). Record the per-question ground-truth hit counts in the spec's table format.

- [ ] **Step 3: Gate decision**

If the average meets the ≥ 4 bar, P1 is done — proceed to P2 (freshness/fresh-install). If a question still misses its ground-truth files, note which keywords failed and refine that tool's behavior (e.g., default-include `.md` docs for config-rule questions) before closing P1. Do not start P2 until this gate passes.

- [ ] **Step 4: Commit the bake-off result note**

Record the scores in a short note and commit (optional, recommended):

```bash
git add docs/superpowers/specs/2026-06-12-code-explorer-hybrid-retrieval-design.md
git commit -m "docs(code-explorer): P1 bake-off results (hybrid agent)"
```

---

## Self-Review notes

- **Spec coverage:** §5.2-A (source access) → Tasks 6,7. §5.2-B (grep/read tools + prompt) → Tasks 1-5. §7 testing (tool unit tests + bake-off gate) → Tasks 1-5 + Task 8. P2 (freshness/fresh-install) and P3 (page affordance) are explicitly out of this plan — separate plans.
- **Open questions deferred to their phases:** §8.1 app DB path and §8.4 rebuild cadence belong to P2 (not touched here); §8.3 (retire `codegraph_explore`) is left in place for now (kept in the factory) and can be revisited after the bake-off; §8.2 (COPY vs volume) is resolved here as COPY (Task 7).
- **Type/name consistency:** tool classes `RepoGrepTool` (name `"grep"`), `ReadFileTool` (name `"read_file"`); module `src.codegraph.repo` with `repo_src_root()`, `iter_source_files(root)`, `resolve_in_root(rel_path, root)`; env var `REPO_SRC_ROOT`; staging flag `--stage-src`; staging dir `langchain_agent/repo-src/`. These are used identically across all tasks.
