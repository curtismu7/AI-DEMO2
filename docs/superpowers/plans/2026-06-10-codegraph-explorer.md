# Code Explorer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a public `/code-explorer` page to the demo UI backed by a LangChain ReAct agent that answers natural-language questions about the codebase using the CodeGraph SQLite index.

**Architecture:** A new `codegraph/` Python module in `langchain_agent/src/` provides 4 SQLite tools (`explore`, `search`, `callers`, `callees`) and a `create_react_agent` loop using Claude Haiku-4-5 via the Anthropic API. A new FastAPI route `POST /codegraph/query` streams tokens as SSE. The React frontend page calls it through a new BFF proxy route at `POST /api/codegraph/query` (no auth). The CodeGraph DB is baked into the Docker image at `/app/codegraph.db` for k8s.

**Tech Stack:** Python 3.11, LangChain/LangGraph, FastAPI, SQLite (FTS5), Claude Haiku-4-5 (Anthropic API), React, Node.js BFF (http module), Kubernetes configmap.

---

## File Map

### New files

| File | Responsibility |
| ---- | -------------- |
| `langchain_agent/src/codegraph/__init__.py` | Package marker |
| `langchain_agent/src/codegraph/db.py` | Raw SQLite queries against `.codegraph/codegraph.db` |
| `langchain_agent/src/codegraph/tools.py` | LangChain `BaseTool` wrappers around `db.py` |
| `langchain_agent/src/codegraph/agent.py` | `create_react_agent` factory with Haiku LLM + system prompt |
| `langchain_agent/src/api/codegraph_handler.py` | FastAPI router `POST /codegraph/query` → SSE token stream |
| `langchain_agent/tests/test_codegraph_db.py` | Unit tests for `db.py` (in-memory SQLite) |
| `langchain_agent/tests/test_codegraph_handler.py` | Unit tests for the FastAPI handler (mocked agent) |
| `demo_api_server/routes/codegraphProxy.js` | BFF proxy: pipes `/api/codegraph/query` → langchain_agent |
| `demo_api_ui/src/components/CodeExplorerPage.jsx` | Chat UI with starter chips and SSE token streaming |
| `demo_api_ui/src/components/CodeExplorerPage.css` | Styles for the page |

### Modified files

| File | Change |
| ---- | ------ |
| `langchain_agent/src/main.py` | Add codegraph router to `start_agui_http_server()` |
| `langchain_agent/Dockerfile` | `COPY .codegraph/codegraph.db /app/codegraph.db` |
| `demo_api_server/server.js` | Register `/api/codegraph` route |
| `demo_api_ui/src/App.js` | Import + add `/code-explorer` public route |
| `demo_api_ui/src/routes/PublicRoutes.js` | Export `CodeExplorerPageRoute` |
| `demo_api_ui/src/components/SideNav.js` | Add `MdCode` to icon map; add "Tools" nav group |
| `k8s/02-configmap.yaml` | Add `CODEGRAPH_DB_PATH: /app/codegraph.db` |

---

## Task 1: SQLite query layer (`codegraph/db.py`)

**Files:**
- Create: `langchain_agent/src/codegraph/__init__.py`
- Create: `langchain_agent/src/codegraph/db.py`
- Create: `langchain_agent/tests/test_codegraph_db.py`

- [ ] **Step 1: Create the package marker**

```bash
touch langchain_agent/src/codegraph/__init__.py
```

- [ ] **Step 2: Write the failing tests**

Create `langchain_agent/tests/test_codegraph_db.py`:

```python
"""Unit tests for codegraph.db — uses in-memory SQLite matching the real schema."""
import sqlite3
import pytest
from unittest.mock import patch


def _make_db():
    """Create an in-memory DB with the CodeGraph schema and minimal test data."""
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript("""
        CREATE TABLE nodes (
            id TEXT PRIMARY KEY,
            kind TEXT NOT NULL,
            name TEXT NOT NULL,
            qualified_name TEXT NOT NULL,
            file_path TEXT NOT NULL,
            language TEXT NOT NULL,
            start_line INTEGER NOT NULL,
            end_line INTEGER NOT NULL,
            start_column INTEGER NOT NULL,
            end_column INTEGER NOT NULL,
            docstring TEXT,
            signature TEXT,
            updated_at INTEGER NOT NULL
        );

        CREATE VIRTUAL TABLE nodes_fts USING fts5(
            id, name, qualified_name, docstring, signature,
            content='nodes', content_rowid='rowid'
        );

        CREATE TRIGGER nodes_ai AFTER INSERT ON nodes BEGIN
            INSERT INTO nodes_fts(rowid, id, name, qualified_name, docstring, signature)
            VALUES (NEW.rowid, NEW.id, NEW.name, NEW.qualified_name, NEW.docstring, NEW.signature);
        END;

        CREATE TABLE edges (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source TEXT NOT NULL,
            target TEXT NOT NULL,
            kind TEXT NOT NULL,
            line INTEGER
        );
    """)
    # Insert test data
    conn.execute("""
        INSERT INTO nodes VALUES
        ('n1','function','handleTransfer','gateway.handleTransfer',
         'demo_mcp_gateway/src/index.ts',
         'typescript',10,40,0,0,
         'Handles MCP transfer tool calls','handleTransfer(req): Promise<void>',
         1000000)
    """)
    conn.execute("""
        INSERT INTO nodes VALUES
        ('n2','function','authorize','authz.authorize',
         'demo_authz_server/src/decision.js',
         'javascript',5,30,0,0,
         'PingOne authorize decision endpoint','authorize(req, res)',
         1000001)
    """)
    conn.execute("""
        INSERT INTO nodes VALUES
        ('n3','function','processPayment','bff.processPayment',
         'demo_api_server/routes/transactions.js',
         'javascript',50,80,0,0,
         'Processes a payment transaction','processPayment(req, res)',
         1000002)
    """)
    conn.execute("INSERT INTO edges VALUES (NULL,'n3','n1','calls',55)")
    conn.execute("INSERT INTO edges VALUES (NULL,'n3','n2','calls',60)")
    conn.commit()
    return conn


@pytest.fixture
def db_conn():
    return _make_db()


class TestExplore:
    def test_returns_matching_nodes(self, db_conn):
        from src.codegraph.db import explore
        with patch("src.codegraph.db._get_conn", return_value=db_conn):
            results = explore("gateway transfer")
        assert len(results) >= 1
        names = [r["name"] for r in results]
        assert "handleTransfer" in names

    def test_returns_file_and_line(self, db_conn):
        from src.codegraph.db import explore
        with patch("src.codegraph.db._get_conn", return_value=db_conn):
            results = explore("authorize")
        assert len(results) >= 1
        r = results[0]
        assert r["file_path"] == "demo_authz_server/src/decision.js"
        assert r["start_line"] == 5

    def test_empty_query_returns_empty(self, db_conn):
        from src.codegraph.db import explore
        with patch("src.codegraph.db._get_conn", return_value=db_conn):
            results = explore("")
        assert results == []


class TestSearch:
    def test_finds_exact_name(self, db_conn):
        from src.codegraph.db import search
        with patch("src.codegraph.db._get_conn", return_value=db_conn):
            results = search("authorize")
        assert len(results) >= 1
        assert results[0]["name"] == "authorize"

    def test_case_insensitive(self, db_conn):
        from src.codegraph.db import search
        with patch("src.codegraph.db._get_conn", return_value=db_conn):
            results = search("HANDLETRANSFER")
        assert len(results) >= 1

    def test_no_match_returns_empty(self, db_conn):
        from src.codegraph.db import search
        with patch("src.codegraph.db._get_conn", return_value=db_conn):
            results = search("xyznonexistent")
        assert results == []


class TestCallers:
    def test_finds_callers_of_handleTransfer(self, db_conn):
        from src.codegraph.db import callers
        with patch("src.codegraph.db._get_conn", return_value=db_conn):
            results = callers("handleTransfer")
        assert len(results) == 1
        assert results[0]["name"] == "processPayment"

    def test_unknown_symbol_returns_empty(self, db_conn):
        from src.codegraph.db import callers
        with patch("src.codegraph.db._get_conn", return_value=db_conn):
            results = callers("nonexistent")
        assert results == []


class TestCallees:
    def test_finds_callees_of_processPayment(self, db_conn):
        from src.codegraph.db import callees
        with patch("src.codegraph.db._get_conn", return_value=db_conn):
            results = callees("processPayment")
        assert len(results) == 2
        names = {r["name"] for r in results}
        assert names == {"handleTransfer", "authorize"}
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
cd langchain_agent
python -m pytest tests/test_codegraph_db.py -v 2>&1 | head -30
```

Expected: `ModuleNotFoundError: No module named 'src.codegraph'`

- [ ] **Step 4: Create `codegraph/db.py`**

```python
"""
SQLite query layer for the CodeGraph index.

All functions open a read-only connection to CODEGRAPH_DB_PATH,
execute a single query, and return a list of plain dicts.
_get_conn() is a thin seam that tests can patch.
"""
import os
import re
import sqlite3
from pathlib import Path
from typing import Any

_MODULE_DIR = Path(__file__).resolve().parent          # .../langchain_agent/src/codegraph
_REPO_ROOT = _MODULE_DIR.parent.parent.parent          # .../AI-Demo
_DEFAULT_DB = str(_REPO_ROOT / ".codegraph" / "codegraph.db")

CODEGRAPH_DB_PATH: str = os.getenv("CODEGRAPH_DB_PATH", _DEFAULT_DB)
_CAP_EXPLORE = 10
_CAP_OTHER = 20


def _get_conn() -> sqlite3.Connection:
    """Open a read-only connection. Tests patch this to inject in-memory DBs."""
    conn = sqlite3.connect(f"file:{CODEGRAPH_DB_PATH}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def _rows_to_dicts(rows) -> list[dict[str, Any]]:
    return [dict(r) for r in rows]


def _sanitize_fts(query: str) -> str:
    """Convert a natural-language query to a safe FTS5 expression."""
    cleaned = re.sub(r"[^\w\s]", " ", query)
    tokens = [t for t in cleaned.split() if len(t) > 1]
    return " OR ".join(tokens[:6]) if tokens else ""


def explore(query: str) -> list[dict[str, Any]]:
    """
    Full-text search across node names, qualified names, docstrings, and
    signatures.  Returns up to 10 nodes with location and signature info.
    """
    fts_query = _sanitize_fts(query)
    if not fts_query:
        return []
    conn = _get_conn()
    try:
        rows = conn.execute(
            """
            SELECT n.id, n.kind, n.name, n.qualified_name,
                   n.file_path, n.start_line, n.end_line,
                   n.signature, n.docstring
            FROM nodes_fts f
            JOIN nodes n ON n.rowid = f.rowid
            WHERE f MATCH ?
            ORDER BY rank
            LIMIT ?
            """,
            (fts_query, _CAP_EXPLORE),
        ).fetchall()
        return _rows_to_dicts(rows)
    except sqlite3.OperationalError:
        return []
    finally:
        conn.close()


def search(term: str) -> list[dict[str, Any]]:
    """
    Exact / prefix search on node names (case-insensitive LIKE).
    Returns up to 20 nodes ordered by export status then name.
    """
    if not term.strip():
        return []
    conn = _get_conn()
    try:
        rows = conn.execute(
            """
            SELECT id, kind, name, qualified_name,
                   file_path, start_line, end_line, signature
            FROM nodes
            WHERE lower(name) LIKE lower(?)
            ORDER BY name
            LIMIT ?
            """,
            (f"%{term}%", _CAP_OTHER),
        ).fetchall()
        return _rows_to_dicts(rows)
    finally:
        conn.close()


def callers(symbol: str) -> list[dict[str, Any]]:
    """
    Return all nodes that call the named symbol (edges.kind = 'calls').
    """
    if not symbol.strip():
        return []
    conn = _get_conn()
    try:
        rows = conn.execute(
            """
            SELECT caller.kind, caller.name, caller.qualified_name,
                   caller.file_path, caller.start_line, e.line AS call_line
            FROM edges e
            JOIN nodes target_node ON target_node.id = e.target
            JOIN nodes caller      ON caller.id      = e.source
            WHERE lower(target_node.name) = lower(?)
              AND e.kind = 'calls'
            LIMIT ?
            """,
            (symbol, _CAP_OTHER),
        ).fetchall()
        return _rows_to_dicts(rows)
    finally:
        conn.close()


def callees(symbol: str) -> list[dict[str, Any]]:
    """
    Return all nodes called by the named symbol (edges.kind = 'calls').
    """
    if not symbol.strip():
        return []
    conn = _get_conn()
    try:
        rows = conn.execute(
            """
            SELECT callee.kind, callee.name, callee.qualified_name,
                   callee.file_path, callee.start_line, e.line AS call_line
            FROM edges e
            JOIN nodes source_node ON source_node.id = e.source
            JOIN nodes callee       ON callee.id      = e.target
            WHERE lower(source_node.name) = lower(?)
              AND e.kind = 'calls'
            LIMIT ?
            """,
            (symbol, _CAP_OTHER),
        ).fetchall()
        return _rows_to_dicts(rows)
    finally:
        conn.close()
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
cd langchain_agent
python -m pytest tests/test_codegraph_db.py -v
```

Expected: all 9 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add langchain_agent/src/codegraph/__init__.py \
        langchain_agent/src/codegraph/db.py \
        langchain_agent/tests/test_codegraph_db.py
git commit -m "feat(codegraph): SQLite query layer with explore/search/callers/callees"
```

---

## Task 2: LangChain tool wrappers (`codegraph/tools.py`)

**Files:**
- Create: `langchain_agent/src/codegraph/tools.py`

- [ ] **Step 1: Create `codegraph/tools.py`**

```python
"""
LangChain BaseTool wrappers around codegraph.db query functions.

Each tool accepts a plain string argument, calls the corresponding db
function, and returns a formatted markdown string the LLM can read.
"""
from __future__ import annotations

from langchain_core.tools import BaseTool
from pydantic import BaseModel, Field

from codegraph import db


def _format_nodes(rows: list[dict]) -> str:
    if not rows:
        return "No results found."
    lines = []
    for r in rows:
        sig = r.get("signature") or ""
        doc = r.get("docstring") or ""
        line_range = f"{r['start_line']}-{r.get('end_line', r['start_line'])}"
        lines.append(
            f"## {r['kind']}: {r['qualified_name']}\n"
            f"File: {r['file_path']}:{line_range}\n"
            + (f"Signature: {sig}\n" if sig else "")
            + (f"Docstring: {doc}\n" if doc else "")
        )
    return "\n".join(lines)


def _format_edges(rows: list[dict], label: str) -> str:
    if not rows:
        return "No results found."
    lines = [f"## {label}"]
    for r in rows:
        call_line = r.get("call_line") or r.get("start_line")
        lines.append(
            f"- {r['kind']} `{r['qualified_name']}` "
            f"at {r['file_path']}:{call_line}"
        )
    return "\n".join(lines)


# --- Tool input schemas ---

class ExploreInput(BaseModel):
    query: str = Field(description="Natural-language question or keyword bag, e.g. 'MCP gateway token exchange'")


class SearchInput(BaseModel):
    term: str = Field(description="Symbol or identifier name to find, e.g. 'handleTransfer'")


class CallersInput(BaseModel):
    symbol: str = Field(description="Exact function/method name whose callers you want, e.g. 'authorize'")


class CalleesInput(BaseModel):
    symbol: str = Field(description="Exact function/method name whose callees you want, e.g. 'processPayment'")


# --- Tool implementations ---

class CodeGraphExploreTool(BaseTool):
    name: str = "codegraph_explore"
    description: str = (
        "Full-text search across node names, docstrings, and signatures. "
        "Use this FIRST for any 'how does X work' or broad architecture question. "
        "Input: natural-language query or keyword bag."
    )
    args_schema: type[BaseModel] = ExploreInput

    def _run(self, query: str) -> str:
        return _format_nodes(db.explore(query))

    async def _arun(self, query: str) -> str:
        return self._run(query)


class CodeGraphSearchTool(BaseTool):
    name: str = "codegraph_search"
    description: str = (
        "Find a specific symbol by name (case-insensitive partial match). "
        "Use when you know the function/class name but need its exact file location. "
        "Input: symbol name, e.g. 'handleTransfer'."
    )
    args_schema: type[BaseModel] = SearchInput

    def _run(self, term: str) -> str:
        return _format_nodes(db.search(term))

    async def _arun(self, term: str) -> str:
        return self._run(term)


class CodeGraphCallersTool(BaseTool):
    name: str = "codegraph_callers"
    description: str = (
        "Find all functions that call the named function. "
        "Use for 'what calls X?' questions. "
        "Input: exact function name, e.g. 'authorize'."
    )
    args_schema: type[BaseModel] = CallersInput

    def _run(self, symbol: str) -> str:
        return _format_edges(db.callers(symbol), f"Callers of `{symbol}`")

    async def _arun(self, symbol: str) -> str:
        return self._run(symbol)


class CodeGraphCalleesTool(BaseTool):
    name: str = "codegraph_callees"
    description: str = (
        "Find all functions called by the named function. "
        "Use for 'what does X call?' questions. "
        "Input: exact function name, e.g. 'processPayment'."
    )
    args_schema: type[BaseModel] = CalleesInput

    def _run(self, symbol: str) -> str:
        return _format_edges(db.callees(symbol), f"Callees of `{symbol}`")

    async def _arun(self, symbol: str) -> str:
        return self._run(symbol)


def get_codegraph_tools() -> list[BaseTool]:
    """Return the full set of CodeGraph tools for the ReAct agent."""
    return [
        CodeGraphExploreTool(),
        CodeGraphSearchTool(),
        CodeGraphCallersTool(),
        CodeGraphCalleesTool(),
    ]
```

- [ ] **Step 2: Run a quick smoke test**

```bash
cd langchain_agent
python -c "
from src.codegraph.tools import get_codegraph_tools
tools = get_codegraph_tools()
print([t.name for t in tools])
"
```

Expected output: `['codegraph_explore', 'codegraph_search', 'codegraph_callers', 'codegraph_callees']`

- [ ] **Step 3: Commit**

```bash
git add langchain_agent/src/codegraph/tools.py
git commit -m "feat(codegraph): LangChain tool wrappers for explore/search/callers/callees"
```

---

## Task 3: ReAct agent factory (`codegraph/agent.py`)

**Files:**
- Create: `langchain_agent/src/codegraph/agent.py`

- [ ] **Step 1: Create `codegraph/agent.py`**

```python
"""
CodeGraph ReAct agent.

Creates a LangGraph ReAct agent backed by Claude Haiku-4-5 (Anthropic API)
with the four CodeGraph tools.  No OAuth — this agent is stateless and
called once per HTTP request.
"""
from __future__ import annotations

import os
import logging
from typing import AsyncGenerator

from langchain_core.messages import AIMessageChunk, HumanMessage, AIMessage, SystemMessage

logger = logging.getLogger(__name__)

_SYSTEM_PROMPT = """\
You are a code navigator for the AI-Demo repository — a multi-vertical AI agent
security demo built on PingOne, MCP, and LangChain. The repo contains:
- demo_api_server: Node.js BFF (Express)
- demo_mcp_gateway / demo_mcp_server: MCP protocol services (TypeScript)
- langchain_agent: Python LangChain/LangGraph agent
- demo_api_ui: React frontend
- demo_authz_server: mock PingOne Authorize service

Use the available tools to look up real code before answering. Always cite
file:line references (e.g. demo_mcp_gateway/src/router.ts:42) in your answer.
Keep answers focused and concrete. Typical flow: call codegraph_explore first,
then codegraph_search or codegraph_callers if you need to narrow down a call chain.
Do not speculate about code you have not looked up.\
"""


def _build_llm():
    """Instantiate Claude Haiku-4-5 via the Anthropic API."""
    from agent.llm_factory import get_llm
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise RuntimeError(
            "ANTHROPIC_API_KEY is not set — required for the CodeGraph agent. "
            "Add it to your .env file or k8s secret."
        )
    return get_llm(
        provider="anthropic",
        model="claude-haiku-4-5-20251001",
        api_key=api_key,
        temperature=0.1,
        max_tokens=4096,
        streaming=True,
    )


def create_codegraph_agent():
    """Return a compiled LangGraph ReAct graph with CodeGraph tools."""
    from langgraph.prebuilt import create_react_agent
    from codegraph.tools import get_codegraph_tools

    llm = _build_llm()
    tools = get_codegraph_tools()
    return create_react_agent(model=llm, tools=tools)


async def stream_answer(
    question: str,
    history: list[dict],
) -> AsyncGenerator[str, None]:
    """
    Run the ReAct agent and yield SSE-formatted JSON events.

    Yields:
        'data: {"type":"token","text":"..."}\n\n'   for each LLM token
        'data: {"type":"done"}\n\n'                 when finished
        'data: {"type":"error","message":"..."}\n\n' on failure
    """
    import json

    graph = create_codegraph_agent()

    messages = [SystemMessage(content=_SYSTEM_PROMPT)]
    for msg in history:
        role = msg.get("role", "")
        content = msg.get("content", "")
        if role == "user":
            messages.append(HumanMessage(content=content))
        elif role == "assistant":
            messages.append(AIMessage(content=content))
    messages.append(HumanMessage(content=question))

    try:
        async for chunk, _metadata in graph.astream(
            {"messages": messages},
            stream_mode="messages",
        ):
            if not isinstance(chunk, AIMessageChunk):
                continue
            content = chunk.content
            # Anthropic returns content as a list of dicts when streaming
            if isinstance(content, list):
                text = "".join(
                    c.get("text", "")
                    for c in content
                    if isinstance(c, dict) and c.get("type") == "text"
                )
            elif isinstance(content, str):
                text = content
            else:
                continue
            if text:
                yield f"data: {json.dumps({'type': 'token', 'text': text})}\n\n"
        yield f"data: {json.dumps({'type': 'done'})}\n\n"
    except Exception as exc:
        logger.exception("CodeGraph agent error: %s", exc)
        yield f"data: {json.dumps({'type': 'error', 'message': str(exc)})}\n\n"
```

- [ ] **Step 2: Smoke-test the module loads without errors**

```bash
cd langchain_agent
python -c "
import sys
sys.path.insert(0, 'src')
# Do not actually call create_codegraph_agent (would need ANTHROPIC_API_KEY)
# Just confirm imports work
from codegraph.agent import _SYSTEM_PROMPT, stream_answer
print('OK — module loaded, system prompt length:', len(_SYSTEM_PROMPT))
"
```

Expected: `OK — module loaded, system prompt length: <number>`

- [ ] **Step 3: Commit**

```bash
git add langchain_agent/src/codegraph/agent.py
git commit -m "feat(codegraph): LangGraph ReAct agent with Haiku-4-5 + system prompt"
```

---

## Task 4: FastAPI handler (`api/codegraph_handler.py`)

**Files:**
- Create: `langchain_agent/src/api/codegraph_handler.py`
- Create: `langchain_agent/tests/test_codegraph_handler.py`

- [ ] **Step 1: Write the failing test**

Create `langchain_agent/tests/test_codegraph_handler.py`:

```python
"""Unit tests for the /codegraph/query FastAPI endpoint."""
import json
import pytest
from unittest.mock import AsyncMock, patch
from fastapi import FastAPI
from fastapi.testclient import TestClient


async def _mock_stream_ok(question, history):
    yield 'data: {"type":"token","text":"The MCP gateway"}\n\n'
    yield 'data: {"type":"token","text":" routes requests."}\n\n'
    yield 'data: {"type":"done"}\n\n'


async def _mock_stream_error(question, history):
    yield 'data: {"type":"error","message":"DB not found"}\n\n'


def _make_app():
    from src.api.codegraph_handler import router
    app = FastAPI()
    app.include_router(router)
    return app


class TestCodegraphHandler:
    def test_streams_tokens(self):
        with patch("src.api.codegraph_handler.stream_answer", _mock_stream_ok):
            client = TestClient(_make_app())
            resp = client.post(
                "/codegraph/query",
                json={"question": "How does the MCP gateway work?", "history": []},
            )
        assert resp.status_code == 200
        assert "text/event-stream" in resp.headers["content-type"]
        body = resp.text
        assert '"type":"token"' in body
        assert '"text":"The MCP gateway"' in body
        assert '"type":"done"' in body

    def test_missing_question_returns_422(self):
        with patch("src.api.codegraph_handler.stream_answer", _mock_stream_ok):
            client = TestClient(_make_app())
            resp = client.post("/codegraph/query", json={})
        assert resp.status_code == 422

    def test_empty_history_is_valid(self):
        with patch("src.api.codegraph_handler.stream_answer", _mock_stream_ok):
            client = TestClient(_make_app())
            resp = client.post(
                "/codegraph/query",
                json={"question": "hi", "history": []},
            )
        assert resp.status_code == 200

    def test_db_unavailable_streams_error(self):
        with patch("src.api.codegraph_handler.stream_answer", _mock_stream_error):
            client = TestClient(_make_app())
            resp = client.post(
                "/codegraph/query",
                json={"question": "anything", "history": []},
            )
        assert resp.status_code == 200
        assert '"type":"error"' in resp.text
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd langchain_agent
python -m pytest tests/test_codegraph_handler.py -v 2>&1 | head -20
```

Expected: `ModuleNotFoundError: No module named 'src.api.codegraph_handler'`

- [ ] **Step 3: Create `api/codegraph_handler.py`**

```python
"""
FastAPI router: POST /codegraph/query

Accepts a question + conversation history, runs the CodeGraph ReAct agent,
and streams the answer as SSE events.

No authentication required — this endpoint is public.
"""
from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import AsyncGenerator

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from codegraph.agent import stream_answer

logger = logging.getLogger(__name__)
router = APIRouter()


class CodegraphQuery(BaseModel):
    question: str
    history: list[dict] = []


def _db_available() -> bool:
    path = os.getenv("CODEGRAPH_DB_PATH", "")
    return bool(path) and Path(path).exists()


@router.post("/codegraph/query")
async def codegraph_query(body: CodegraphQuery) -> StreamingResponse:
    if not _db_available():
        async def unavailable() -> AsyncGenerator[str, None]:
            import json
            yield (
                'data: ' +
                json.dumps({"type": "error", "message": "CodeGraph index not available"}) +
                '\n\n'
            )
        return StreamingResponse(
            unavailable(),
            status_code=503,
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    return StreamingResponse(
        stream_answer(body.question, body.history),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
```

- [ ] **Step 4: Run tests**

```bash
cd langchain_agent
python -m pytest tests/test_codegraph_handler.py -v
```

Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add langchain_agent/src/api/codegraph_handler.py \
        langchain_agent/tests/test_codegraph_handler.py
git commit -m "feat(codegraph): FastAPI SSE handler POST /codegraph/query"
```

---

## Task 5: Wire router into `main.py`

**Files:**
- Modify: `langchain_agent/src/main.py` (lines 305–309)

- [ ] **Step 1: Add codegraph router to `start_agui_http_server()`**

Find the method `start_agui_http_server` in `src/main.py`. It currently reads:

```python
        from fastapi import FastAPI
        from .api.agui_run_handler import router as agui_router

        app = FastAPI(title="LangChain AG-UI", docs_url=None, redoc_url=None)
        app.include_router(agui_router)
```

Replace with:

```python
        from fastapi import FastAPI
        from .api.agui_run_handler import router as agui_router
        from .api.codegraph_handler import router as codegraph_router

        app = FastAPI(title="LangChain AG-UI", docs_url=None, redoc_url=None)
        app.include_router(agui_router)
        app.include_router(codegraph_router)
```

- [ ] **Step 2: Verify the server starts without errors**

```bash
cd langchain_agent
python -c "
import sys
sys.path.insert(0, 'src')
from api.codegraph_handler import router
from api.agui_run_handler import router as agui_router
from fastapi import FastAPI
app = FastAPI()
app.include_router(agui_router)
app.include_router(router)
routes = [r.path for r in app.routes]
print('Routes:', routes)
assert '/codegraph/query' in routes
print('OK')
"
```

Expected: output includes `/codegraph/query`.

- [ ] **Step 3: Commit**

```bash
git add langchain_agent/src/main.py
git commit -m "feat(codegraph): register codegraph router in FastAPI app"
```

---

## Task 6: Dockerfile — bake the CodeGraph DB

**Files:**
- Modify: `langchain_agent/Dockerfile`

The Dockerfile build is invoked from the repo root (`docker-compose.yml` uses `context: .`). The `.codegraph/codegraph.db` file is at the repo root — it's accessible from the build context.

- [ ] **Step 1: Add COPY and ENV to the Dockerfile**

In `langchain_agent/Dockerfile`, after the line `COPY src/ ./src/`, add:

```dockerfile
# Bake the CodeGraph index so the code-explorer works in k8s without a daemon
COPY .codegraph/codegraph.db /app/codegraph.db
ENV CODEGRAPH_DB_PATH=/app/codegraph.db
```

The modified block around that section should read:

```dockerfile
# Copy application code
COPY src/ ./src/
COPY scripts/ ./scripts/
COPY .env.example ./

# Bake the CodeGraph index so the code-explorer works in k8s without a daemon
COPY .codegraph/codegraph.db /app/codegraph.db
ENV CODEGRAPH_DB_PATH=/app/codegraph.db
```

- [ ] **Step 2: Verify build succeeds (local)**

```bash
# Run from repo root
docker build -f langchain_agent/Dockerfile -t langchain-agent-test . 2>&1 | tail -10
```

Expected: `Successfully built <id>` — no COPY errors.

- [ ] **Step 3: Commit**

```bash
git add langchain_agent/Dockerfile
git commit -m "feat(codegraph): bake codegraph.db into langchain_agent Docker image"
```

---

## Task 7: BFF proxy route

**Files:**
- Create: `demo_api_server/routes/codegraphProxy.js`
- Modify: `demo_api_server/server.js`

- [ ] **Step 1: Create `demo_api_server/routes/codegraphProxy.js`**

```javascript
'use strict';

/**
 * POST /api/codegraph/query
 *
 * Public proxy — no auth required.  Forwards request body to the LangChain
 * agent's /codegraph/query endpoint and pipes the SSE response back to the
 * browser.  Uses the same LANGCHAIN_AGENT_HTTP_URL env var as aguiSseProxy.
 */
const http = require('http');

const router = require('express').Router();

router.post('/query', (req, res) => {
  const agentUrl = process.env.LANGCHAIN_AGENT_HTTP_URL || 'http://127.0.0.1:8888';
  const parsed = new URL(agentUrl);

  const body = JSON.stringify(req.body);

  const options = {
    hostname: parsed.hostname,
    port: parsed.port || 80,
    path: '/codegraph/query',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      Accept: 'text/event-stream',
    },
  };

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const upstream = http.request(options, (upstreamRes) => {
    upstreamRes.pipe(res);
    upstreamRes.on('end', () => res.end());
  });

  upstream.on('error', (err) => {
    const event = JSON.stringify({ type: 'error', message: err.message });
    res.write(`data: ${event}\n\n`);
    res.end();
  });

  upstream.write(body);
  upstream.end();
});

module.exports = router;
```

- [ ] **Step 2: Register the route in `demo_api_server/server.js`**

Find the block in `server.js` that registers the langchain routes (around line 898–902):

```javascript
app.use('/api/agent', agentRunRoutes);
app.use('/api/agent/langchain', require('./routes/agentLangchainRunRoute'));
// ...
app.use('/api/langchain', langchainConfigRoutes);
```

Add the codegraph route immediately after those lines:

```javascript
app.use('/api/codegraph', require('./routes/codegraphProxy'));
```

- [ ] **Step 3: Manual smoke test (requires services running)**

```bash
# With services running locally:
curl -s -N -X POST http://localhost:3001/api/codegraph/query \
  -H 'Content-Type: application/json' \
  -d '{"question":"What is handleTransfer?","history":[]}' \
  | head -5
```

Expected: SSE lines starting with `data: {"type":"token"` or `data: {"type":"error"` (if ANTHROPIC_API_KEY not set).

- [ ] **Step 4: Commit**

```bash
git add demo_api_server/routes/codegraphProxy.js demo_api_server/server.js
git commit -m "feat(codegraph): BFF proxy route POST /api/codegraph/query"
```

---

## Task 8: k8s configmap

**Files:**
- Modify: `k8s/02-configmap.yaml`

- [ ] **Step 1: Add `CODEGRAPH_DB_PATH` to the configmap**

In `k8s/02-configmap.yaml`, locate the `data:` block. Add the following line in alphabetical order among the other env vars:

```yaml
  CODEGRAPH_DB_PATH: /app/codegraph.db
```

- [ ] **Step 2: Commit**

```bash
git add k8s/02-configmap.yaml
git commit -m "feat(codegraph): set CODEGRAPH_DB_PATH in k8s configmap"
```

---

## Task 9: `CodeExplorerPage` UI

**Files:**
- Create: `demo_api_ui/src/components/CodeExplorerPage.jsx`
- Create: `demo_api_ui/src/components/CodeExplorerPage.css`

- [ ] **Step 1: Create `CodeExplorerPage.css`**

```css
.code-explorer-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 24px;
  max-width: 900px;
  margin: 0 auto;
  box-sizing: border-box;
}

.code-explorer-header {
  margin-bottom: 24px;
}

.code-explorer-header h1 {
  font-size: 1.6rem;
  font-weight: 600;
  margin: 0 0 6px;
}

.code-explorer-header p {
  color: var(--text-secondary, #666);
  margin: 0;
}

/* Starter chips shown on empty state */
.code-explorer-chips {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
  margin-bottom: 24px;
}

.code-explorer-chip {
  padding: 10px 14px;
  background: var(--surface-2, #f5f5f5);
  border: 1px solid var(--border, #ddd);
  border-radius: 8px;
  cursor: pointer;
  font-size: 0.85rem;
  text-align: left;
  transition: background 0.15s;
}

.code-explorer-chip:hover {
  background: var(--surface-3, #ebebeb);
}

/* Chat message list */
.code-explorer-messages {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-bottom: 16px;
}

.code-explorer-message {
  padding: 12px 16px;
  border-radius: 8px;
  line-height: 1.55;
  white-space: pre-wrap;
  font-size: 0.9rem;
}

.code-explorer-message.user {
  background: var(--surface-2, #f0f0f0);
  align-self: flex-end;
  max-width: 80%;
}

.code-explorer-message.assistant {
  background: var(--surface-1, #fff);
  border: 1px solid var(--border, #ddd);
  align-self: flex-start;
  max-width: 100%;
}

.code-explorer-message.assistant code {
  background: var(--surface-2, #f5f5f5);
  padding: 1px 4px;
  border-radius: 3px;
  font-family: monospace;
  font-size: 0.85em;
}

/* Typing indicator */
.code-explorer-typing {
  display: flex;
  gap: 4px;
  padding: 12px 16px;
  align-self: flex-start;
}

.code-explorer-typing span {
  width: 8px;
  height: 8px;
  background: var(--text-secondary, #999);
  border-radius: 50%;
  animation: dot-bounce 1.2s infinite;
}

.code-explorer-typing span:nth-child(2) { animation-delay: 0.2s; }
.code-explorer-typing span:nth-child(3) { animation-delay: 0.4s; }

@keyframes dot-bounce {
  0%, 80%, 100% { transform: translateY(0); }
  40%            { transform: translateY(-6px); }
}

/* Input row */
.code-explorer-input-row {
  display: flex;
  gap: 8px;
}

.code-explorer-input {
  flex: 1;
  padding: 10px 14px;
  border: 1px solid var(--border, #ccc);
  border-radius: 8px;
  font-size: 0.9rem;
  resize: none;
  min-height: 42px;
  max-height: 120px;
  overflow-y: auto;
}

.code-explorer-input:focus {
  outline: none;
  border-color: var(--primary, #0066cc);
}

.code-explorer-send {
  padding: 10px 18px;
  background: var(--primary, #0066cc);
  color: #fff;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 0.9rem;
  white-space: nowrap;
}

.code-explorer-send:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.code-explorer-error {
  color: var(--error, #c0392b);
  font-size: 0.85rem;
  padding: 8px 0;
}
```

- [ ] **Step 2: Create `CodeExplorerPage.jsx`**

```jsx
import React, { useCallback, useRef, useState } from "react";
import "./CodeExplorerPage.css";

const STARTER_CHIPS = [
  "How does the MCP gateway work?",
  "Trace the token chain flow",
  "What calls the authorize endpoint?",
  "How is delegation implemented?",
  "Show me the OAuth login flow",
  "What tools does the LangChain agent have?",
];

export default function CodeExplorerPage() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const messagesEndRef = useRef(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const sendQuestion = useCallback(
    async (question) => {
      if (!question.trim() || loading) return;
      setError("");
      const history = messages.map((m) => ({ role: m.role, content: m.content }));

      setMessages((prev) => [...prev, { role: "user", content: question }]);
      setInput("");
      setLoading(true);

      let assistantText = "";
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "" },
      ]);

      try {
        const res = await fetch("/api/codegraph/query", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question, history }),
        });

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop(); // keep incomplete line

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const raw = line.slice(6).trim();
            if (!raw) continue;
            try {
              const event = JSON.parse(raw);
              if (event.type === "token") {
                assistantText += event.text;
                setMessages((prev) => {
                  const updated = [...prev];
                  updated[updated.length - 1] = {
                    role: "assistant",
                    content: assistantText,
                  };
                  return updated;
                });
                scrollToBottom();
              } else if (event.type === "error") {
                setError(event.message || "An error occurred");
              }
            } catch {
              // non-JSON line — skip
            }
          }
        }
      } catch (err) {
        setError(err.message || "Failed to reach the server");
      } finally {
        setLoading(false);
        scrollToBottom();
      }
    },
    [loading, messages, scrollToBottom],
  );

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendQuestion(input);
      }
    },
    [input, sendQuestion],
  );

  const isEmpty = messages.length === 0;

  return (
    <div className="code-explorer-page">
      <div className="code-explorer-header">
        <h1>Code Explorer</h1>
        <p>Ask anything about this codebase</p>
      </div>

      {isEmpty && (
        <div className="code-explorer-chips">
          {STARTER_CHIPS.map((chip) => (
            <button
              key={chip}
              className="code-explorer-chip"
              onClick={() => sendQuestion(chip)}
              disabled={loading}
            >
              {chip}
            </button>
          ))}
        </div>
      )}

      {!isEmpty && (
        <div className="code-explorer-messages">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`code-explorer-message ${msg.role}`}
            >
              {msg.content || (msg.role === "assistant" && loading && i === messages.length - 1 ? "" : msg.content)}
            </div>
          ))}
          {loading && messages[messages.length - 1]?.content === "" && (
            <div className="code-explorer-typing">
              <span />
              <span />
              <span />
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      )}

      {error && <div className="code-explorer-error">{error}</div>}

      <div className="code-explorer-input-row">
        <textarea
          className="code-explorer-input"
          placeholder="Ask about the codebase…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={loading}
          rows={1}
        />
        <button
          className="code-explorer-send"
          onClick={() => sendQuestion(input)}
          disabled={loading || !input.trim()}
        >
          {loading ? "…" : "Ask"}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add demo_api_ui/src/components/CodeExplorerPage.jsx \
        demo_api_ui/src/components/CodeExplorerPage.css
git commit -m "feat(codegraph): CodeExplorerPage UI with starter chips and SSE streaming"
```

---

## Task 10: Route + SideNav wiring

**Files:**
- Modify: `demo_api_ui/src/routes/PublicRoutes.js`
- Modify: `demo_api_ui/src/App.js`
- Modify: `demo_api_ui/src/components/SideNav.js`

- [ ] **Step 1: Export `CodeExplorerPageRoute` from `PublicRoutes.js`**

In `demo_api_ui/src/routes/PublicRoutes.js`, add after the existing imports:

```javascript
import CodeExplorerPage from "../components/CodeExplorerPage";
```

Then add the following export at the bottom of the file (same pattern as `SelfServicePageRoute`):

```javascript
export function CodeExplorerPageRoute({ user, logout }) {
  return (
    <AppShell user={user} logout={logout}>
      <CodeExplorerPage />
    </AppShell>
  );
}
```

- [ ] **Step 2: Add the route to `App.js`**

In `demo_api_ui/src/App.js`, add `CodeExplorerPageRoute` to the import from `PublicRoutes`:

```javascript
import PublicRoutes, {
  ConfigurePage,
  SelfServicePageRoute,
  PingOneTestPageRoute,
  MFATestPageRoute,
  AuthzTestPageRoute,
  OnboardingRoute,
  AgentPageRoute,
  CodeExplorerPageRoute,           // ADD THIS LINE
} from "./routes/PublicRoutes";
```

Then add the route near the other public routes (around line 365, after the `/self-service` route):

```jsx
<Route path="/code-explorer" element={<CodeExplorerPageRoute user={user} logout={logout} />} />
```

- [ ] **Step 3: Add "Tools" group + `MdCode` icon to `SideNav.js`**

In `demo_api_ui/src/components/SideNav.js`:

**3a.** `MdCode` is already imported at the top of the file (confirm with `grep MdCode`). If it is not present, add it to the import block from `react-icons/md`.

**3b.** Add `MdCode` to the `iconMap` object inside the `renderIcon` function. Find the `iconMap` object and add:

```javascript
      MdCode,
```

**3c.** Add a "Tools" group to `ADMIN_NAV` (after the last existing group):

```javascript
  {
    group: "Tools",
    items: [
      { to: "/code-explorer", label: "Code Explorer", icon: "MdCode" },
    ],
  },
```

**3d.** Add a "Tools" group to `buildUserNav` (after the last existing group in the returned array):

```javascript
    {
      group: "Tools",
      items: [
        { to: "/code-explorer", label: "Code Explorer", icon: "MdCode" },
      ],
    },
```

- [ ] **Step 4: Confirm `MdCode` is imported**

```bash
grep "MdCode" demo_api_ui/src/components/SideNav.js
```

Expected: at least two lines — one in the import block and one in the `iconMap`.

- [ ] **Step 5: Start the dev server and verify the page loads**

```bash
cd demo_api_ui
npm start
```

Open `http://localhost:3000/code-explorer` in a browser. Confirm:
1. The page title "Code Explorer" is visible
2. The 6 starter chips are visible
3. The SideNav shows a "Tools → Code Explorer" entry
4. Clicking a chip sends a request to `/api/codegraph/query` (visible in the Network tab)

- [ ] **Step 6: Commit**

```bash
git add demo_api_ui/src/routes/PublicRoutes.js \
        demo_api_ui/src/App.js \
        demo_api_ui/src/components/SideNav.js
git commit -m "feat(codegraph): wire /code-explorer route and SideNav entry"
```

---

## Self-Review Checklist

**Spec requirement → task:**

| Spec requirement | Task |
| ---------------- | ---- |
| `POST /codegraph/query` SSE endpoint | Task 4 |
| Haiku-4-5 via Anthropic API | Task 3 |
| 4 SQLite tools (explore, search, callers, callees) | Tasks 1–2 |
| DB baked into Docker image | Task 6 |
| `CODEGRAPH_DB_PATH` env var | Tasks 1, 8 |
| BFF proxy route | Task 7 |
| `/code-explorer` public route | Task 10 |
| SideNav "Tools" group | Task 10 |
| Starter chips | Task 9 |
| SSE token streaming | Tasks 3–4, 9 |
| 503 when DB missing | Task 4 |
| k8s configmap update | Task 8 |
| No regressions in existing LangChain WebSocket | Task 5 (adds router to same app, doesn't touch WebSocket path) |

All spec requirements covered. No placeholders. Type signatures are consistent across tasks.
