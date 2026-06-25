# Agent Framework Implementations Plan
## LangChain · OpenAI Agents SDK · Mastra · Pydantic AI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register all four agent frameworks as selectable runtime options in the demo — LangChain (already built, port 8889/`langchain_agent/`), OpenAI Agents SDK (new, port 8891), Mastra (new, port 8892), and Pydantic AI (new, port 8893) — each producing the same AG-UI SSE stream from the same BFF tool pipeline.

**Architecture:** Each framework gets its own service speaking the same inbound protocol (POST `/run` → SSE stream of AG-UI events). The BFF `agentRun.js` selects which backend to proxy to via a new `llm_framework` config key (`langchain` | `openai_agents` | `mastra` | `pydantic_ai`). LangChain already implements this protocol at port 8889 (`langchain_agent/`). All tool execution flows through the existing BFF `/internal/agent-tool` endpoint — no framework bypasses the RFC 8693 token exchange. All four share the existing `demo_mcp_server` and `demo_api_server` unmodified.

**Tech Stack:** Python 3.11+, `openai-agents` (PyPI), `pydantic-ai`, `fastapi`, `uvicorn`, `httpx`, TypeScript 5, `@mastra/core`, AG-UI event protocol, existing `langchain_agent/src/agui/` event shape.

---

## Scope

This plan covers four parts. Parts A–C are new services; Part D wires them all together. Each can be implemented independently:

- **Part A — OpenAI Agents SDK** (Python, port 8891): new service, MCP-native
- **Part B — Mastra** (TypeScript, port 8892): new service, TypeScript-native
- **Part C — Pydantic AI** (Python, port 8893): new service, type-safety story
- **Part D — BFF routing** (Node.js): wires `llm_framework` selector into `agentRun.js`, covering all four frameworks including the existing LangChain service at port 8889

LangChain already exists at `langchain_agent/` and already speaks the AG-UI SSE protocol on port 8889. No new service is needed for it — Part D simply registers it as the default `langchain` option.

---

## File Map

### Part A — OpenAI Agents SDK (`openai_agent/`)

| File | Role |
|---|---|
| `openai_agent/src/main.py` | FastAPI app entry point, port 8891 |
| `openai_agent/src/run_handler.py` | POST `/run` → SSE stream, mirrors `agui_run_handler.py` shape |
| `openai_agent/src/agent_factory.py` | Builds `openai_agents.Agent` with BFF tools wired |
| `openai_agent/src/bff_tool_adapter.py` | One `function_tool` per MCP tool; calls BFF `/internal/agent-tool` via httpx |
| `openai_agent/src/agui_emitter.py` | Translates OpenAI Agents SDK stream events → AG-UI dicts |
| `openai_agent/src/config.py` | Reads env vars (BFF_INTERNAL_TOOL_URL, OPENAI_API_KEY, etc.) |
| `openai_agent/requirements.txt` | `openai-agents`, `fastapi`, `uvicorn`, `httpx`, `python-dotenv` |
| `openai_agent/.env.example` | Env var template |
| `openai_agent/tests/test_bff_tool_adapter.py` | Unit tests: tool schema generation, httpx call, error handling |
| `openai_agent/tests/test_agui_emitter.py` | Unit tests: each SDK event type → correct AG-UI dict |
| `openai_agent/tests/test_run_handler.py` | Integration test: POST /run → SSE stream contains RUN_STARTED + RUN_FINISHED |

### Part B — Mastra (`mastra_agent/`)

| File | Role |
|---|---|
| `mastra_agent/src/index.ts` | Express entry point, port 8892 |
| `mastra_agent/src/runHandler.ts` | POST `/run` → SSE stream |
| `mastra_agent/src/agentFactory.ts` | Builds Mastra `Agent` with BFF tools |
| `mastra_agent/src/bffToolAdapter.ts` | Creates Mastra `createTool()` for each MCP tool; calls BFF via fetch |
| `mastra_agent/src/aguiEmitter.ts` | Translates Mastra streaming events → AG-UI dicts |
| `mastra_agent/src/config.ts` | Env var helpers |
| `mastra_agent/package.json` | `@mastra/core`, `express`, `zod` |
| `mastra_agent/tsconfig.json` | Strict TypeScript config |
| `mastra_agent/.env.example` | Env var template |
| `mastra_agent/tests/bffToolAdapter.test.ts` | Unit tests: tool shape, fetch call, error handling |
| `mastra_agent/tests/aguiEmitter.test.ts` | Unit tests: Mastra events → AG-UI dicts |
| `mastra_agent/tests/runHandler.test.ts` | Integration: POST /run → SSE with correct event sequence |

### Part C — Pydantic AI (`pydantic_agent/`)

| File | Role |
|---|---|
| `pydantic_agent/src/main.py` | FastAPI app entry point, port 8893 |
| `pydantic_agent/src/run_handler.py` | POST `/run` → SSE stream |
| `pydantic_agent/src/agent_factory.py` | Builds `pydantic_ai.Agent` with injected BFF deps |
| `pydantic_agent/src/bff_tool_adapter.py` | Tool functions with `RunContext[BffDeps]`; calls BFF via httpx |
| `pydantic_agent/src/agui_emitter.py` | Translates Pydantic AI stream events → AG-UI dicts |
| `pydantic_agent/src/models.py` | `BffDeps` dataclass, `RunInput`, `RunOutput` Pydantic models |
| `pydantic_agent/src/config.py` | Env var helpers |
| `pydantic_agent/requirements.txt` | `pydantic-ai`, `fastapi`, `uvicorn`, `httpx`, `python-dotenv` |
| `pydantic_agent/.env.example` | Env var template |
| `pydantic_agent/tests/test_bff_tool_adapter.py` | Unit tests: tool contract types, httpx call, error handling |
| `pydantic_agent/tests/test_agui_emitter.py` | Unit tests: each event type → correct AG-UI dict |
| `pydantic_agent/tests/test_run_handler.py` | Integration: POST /run → SSE with correct event sequence |

### Part D — BFF Routing (`demo_api_server/`)

| File | Role |
|---|---|
| `demo_api_server/routes/agentRun.js` | Add `llm_framework` config key → proxy target selection |
| `demo_api_server/config/verticals/*.json` | No change needed |
| `demo_api_server/tests/agentRun.framework-routing.test.js` | Unit test: each framework value routes to correct port |

---

## Shared Contract: BFF Tool Call

All three frameworks call the BFF the same way. This is the only interface that matters for tool execution:

```
POST http://127.0.0.1:3001/internal/agent-tool
Headers:
  x-internal-gateway-secret: <BFF_INTERNAL_SECRET>
  Content-Type: application/json
  x-session-id: <sessionId>

Body:
{
  "tool": "get_accounts",
  "args": { "userId": "u1" },
  "sessionId": "<sessionId>"
}

Response 200:
{
  "result": { ... }   // tool output, passed back to the agent as the tool result
}

Response 4xx/5xx:
{
  "error": "...",
  "code": "..."
}
```

The session cookie is NOT used here — the BFF validates via `x-internal-gateway-secret` and looks up the session by `sessionId` to perform the RFC 8693 exchange. This keeps the token boundary at the BFF regardless of which agent framework is calling.

---

## Shared AG-UI Event Wire Format

All three adapters must emit these event shapes (same as `langchain_agent/src/agui/event_types.py`):

```json
{ "type": "RUN_STARTED",  "runId": "...", "threadId": "..." }
{ "type": "TEXT_MESSAGE_START", "messageId": "..." }
{ "type": "TEXT_MESSAGE_CONTENT", "messageId": "...", "delta": "token" }
{ "type": "TEXT_MESSAGE_END", "messageId": "..." }
{ "type": "TOOL_CALL_START", "toolCallId": "...", "toolCallName": "get_accounts" }
{ "type": "TOOL_CALL_ARGS", "toolCallId": "...", "delta": "{\"userId\":\"u1\"}" }
{ "type": "TOOL_CALL_END", "toolCallId": "..." }
{ "type": "STATE_DELTA", "delta": { ... } }
{ "type": "RUN_FINISHED", "runId": "...", "threadId": "..." }
{ "type": "ERROR", "message": "...", "code": "AGENT_ERROR" }
```

SSE wire format: `data: <json>\n\n` — same as the LangChain agent.

---

## Inbound Run Payload

The BFF sends this to whichever agent is selected (same shape as current `agentRun.js` Step D):

```json
{
  "threadId": "sess_abc",
  "runId": "run_xyz",
  "messages": [
    { "role": "user", "content": "What are my accounts?" }
  ],
  "tools": [
    { "name": "get_accounts", "description": "...", "inputSchema": { "type": "object", ... } }
  ],
  "context": {
    "bffToolUrl": "http://127.0.0.1:3001/internal/agent-tool",
    "sessionId": "sess_abc",
    "initialTokenEvents": [...],
    "provider": "openai",
    "model": "gpt-4o"
  }
}
```

---

## Part A — OpenAI Agents SDK

### Task A1: Scaffold directory and install dependencies

**Files:**
- Create: `openai_agent/requirements.txt`
- Create: `openai_agent/.env.example`
- Create: `openai_agent/src/__init__.py`
- Create: `openai_agent/tests/__init__.py`

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p openai_agent/src openai_agent/tests
touch openai_agent/src/__init__.py openai_agent/tests/__init__.py
```

- [ ] **Step 2: Write requirements.txt**

```
# openai_agent/requirements.txt
openai-agents>=0.0.9
fastapi>=0.111.0
uvicorn[standard]>=0.29.0
httpx>=0.27.0
python-dotenv>=1.0.0
pytest>=8.0.0
pytest-asyncio>=0.23.0
pytest-mock>=3.14.0
```

- [ ] **Step 3: Write .env.example**

```bash
# openai_agent/.env.example
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o
BFF_INTERNAL_SECRET=dev-shared-secret-change-me
# BFF tool endpoint — the BFF /internal/agent-tool path
BFF_INTERNAL_TOOL_URL=http://127.0.0.1:3001/internal/agent-tool
AGENT_HTTP_HOST=127.0.0.1
AGENT_HTTP_PORT=8891
```

- [ ] **Step 4: Create venv and install**

```bash
cd openai_agent
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Expected: all packages install without errors. `python -c "import agents"` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add openai_agent/requirements.txt openai_agent/.env.example openai_agent/src/__init__.py openai_agent/tests/__init__.py
git commit -m "feat(openai-agent): scaffold directory and dependencies"
```

---

### Task A2: Config module

**Files:**
- Create: `openai_agent/src/config.py`

- [ ] **Step 1: Write the failing test**

```python
# openai_agent/tests/test_config.py
import os
import pytest
from unittest.mock import patch


def test_config_reads_env_vars():
    with patch.dict(os.environ, {
        "OPENAI_API_KEY": "sk-test",
        "OPENAI_MODEL": "gpt-4o-mini",
        "BFF_INTERNAL_SECRET": "secret123",
        "BFF_INTERNAL_TOOL_URL": "http://127.0.0.1:3001/internal/agent-tool",
        "AGENT_HTTP_PORT": "8891",
    }):
        from importlib import reload
        import openai_agent.src.config as cfg
        reload(cfg)
        c = cfg.get_config()
        assert c.openai_api_key == "sk-test"
        assert c.model == "gpt-4o-mini"
        assert c.bff_internal_secret == "secret123"
        assert c.bff_tool_url == "http://127.0.0.1:3001/internal/agent-tool"
        assert c.port == 8891
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd openai_agent && source .venv/bin/activate
python -m pytest tests/test_config.py -v
```

Expected: `ModuleNotFoundError: No module named 'openai_agent'`

- [ ] **Step 3: Write config.py**

```python
# openai_agent/src/config.py
from __future__ import annotations
import os
from dataclasses import dataclass
from dotenv import load_dotenv

load_dotenv()


@dataclass
class Config:
    openai_api_key: str
    model: str
    bff_internal_secret: str
    bff_tool_url: str
    host: str
    port: int


def get_config() -> Config:
    return Config(
        openai_api_key=os.environ.get("OPENAI_API_KEY", ""),
        model=os.environ.get("OPENAI_MODEL", "gpt-4o"),
        bff_internal_secret=os.environ.get("BFF_INTERNAL_SECRET", "dev-shared-secret-change-me"),
        bff_tool_url=os.environ.get("BFF_INTERNAL_TOOL_URL", "http://127.0.0.1:3001/internal/agent-tool"),
        host=os.environ.get("AGENT_HTTP_HOST", "127.0.0.1"),
        port=int(os.environ.get("AGENT_HTTP_PORT", "8891")),
    )
```

- [ ] **Step 4: Add `openai_agent` to Python path for tests**

```python
# openai_agent/conftest.py
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
```

- [ ] **Step 5: Run tests**

```bash
python -m pytest tests/test_config.py -v
```

Expected: 1 passed.

- [ ] **Step 6: Commit**

```bash
git add openai_agent/src/config.py openai_agent/conftest.py openai_agent/tests/test_config.py
git commit -m "feat(openai-agent): config module"
```

---

### Task A3: BFF tool adapter

This module turns the flat `tools` array from the run payload into OpenAI Agents SDK `function_tool` callables that POST to the BFF.

**Files:**
- Create: `openai_agent/src/bff_tool_adapter.py`
- Create: `openai_agent/tests/test_bff_tool_adapter.py`

- [ ] **Step 1: Write the failing tests**

```python
# openai_agent/tests/test_bff_tool_adapter.py
import pytest
import httpx
from unittest.mock import AsyncMock, patch, MagicMock


TOOL_SCHEMA = {
    "name": "get_accounts",
    "description": "List the user's bank accounts.",
    "inputSchema": {
        "type": "object",
        "properties": {"userId": {"type": "string"}},
        "required": ["userId"],
    },
}

RUN_CONTEXT = {
    "bff_tool_url": "http://127.0.0.1:3001/internal/agent-tool",
    "bff_internal_secret": "secret",
    "session_id": "sess_abc",
}


@pytest.mark.asyncio
async def test_build_tools_returns_one_callable_per_schema():
    from src.bff_tool_adapter import build_bff_tools
    tools = build_bff_tools([TOOL_SCHEMA], RUN_CONTEXT)
    assert len(tools) == 1


@pytest.mark.asyncio
async def test_tool_posts_to_bff_and_returns_result(respx_mock):
    """Tool function calls BFF and returns result JSON."""
    import respx
    from src.bff_tool_adapter import build_bff_tools

    respx_mock.post("http://127.0.0.1:3001/internal/agent-tool").mock(
        return_value=httpx.Response(200, json={"result": {"accounts": []}})
    )

    tools = build_bff_tools([TOOL_SCHEMA], RUN_CONTEXT)
    # The tool is a plain async callable; call it with the tool's expected arg
    result = await tools[0].on_invoke_tool(None, '{"userId": "u1"}')
    assert "accounts" in result or result is not None


@pytest.mark.asyncio
async def test_tool_raises_on_bff_error(respx_mock):
    from src.bff_tool_adapter import build_bff_tools, BffToolError

    respx_mock.post("http://127.0.0.1:3001/internal/agent-tool").mock(
        return_value=httpx.Response(500, json={"error": "internal"})
    )

    tools = build_bff_tools([TOOL_SCHEMA], RUN_CONTEXT)
    with pytest.raises(BffToolError):
        await tools[0].on_invoke_tool(None, '{"userId": "u1"}')
```

- [ ] **Step 2: Install respx (async httpx mock)**

```bash
pip install respx pytest-asyncio
```

- [ ] **Step 3: Run to confirm failure**

```bash
python -m pytest tests/test_bff_tool_adapter.py -v
```

Expected: `ModuleNotFoundError: No module named 'src.bff_tool_adapter'`

- [ ] **Step 4: Write bff_tool_adapter.py**

```python
# openai_agent/src/bff_tool_adapter.py
"""Wraps BFF /internal/agent-tool calls as OpenAI Agents SDK function_tools."""
from __future__ import annotations
import json
import logging
from typing import Any

import httpx
from agents import function_tool, RunContextWrapper

logger = logging.getLogger(__name__)


class BffToolError(Exception):
    pass


def build_bff_tools(tool_schemas: list[dict], run_ctx: dict) -> list:
    """
    For each tool schema from the BFF run payload, create an openai-agents
    function_tool that POSTs to the BFF /internal/agent-tool endpoint.

    run_ctx keys: bff_tool_url, bff_internal_secret, session_id
    """
    tools = []
    for schema in tool_schemas:
        tools.append(_make_tool(schema, run_ctx))
    return tools


def _make_tool(schema: dict, run_ctx: dict):
    tool_name = schema["name"]
    tool_description = schema.get("description", "")

    # openai-agents SDK: function_tool decorator expects a real async function.
    # We build one dynamically and attach the schema metadata the SDK reads from
    # __name__ and __doc__; the actual JSON Schema is passed via the params_json_schema
    # parameter of function_tool.
    async def _invoke(ctx: RunContextWrapper[None], args_json: str) -> str:
        args = json.loads(args_json) if args_json else {}
        logger.info("[BffTool] %s args=%s session=%s", tool_name, args, run_ctx["session_id"])
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                run_ctx["bff_tool_url"],
                json={"tool": tool_name, "args": args, "sessionId": run_ctx["session_id"]},
                headers={
                    "x-internal-gateway-secret": run_ctx["bff_internal_secret"],
                    "x-session-id": run_ctx["session_id"],
                    "Content-Type": "application/json",
                },
            )
        if resp.status_code != 200:
            body = resp.text[:200]
            logger.error("[BffTool] %s HTTP %s: %s", tool_name, resp.status_code, body)
            raise BffToolError(f"BFF returned HTTP {resp.status_code}: {body}")
        data = resp.json()
        return json.dumps(data.get("result", data))

    _invoke.__name__ = tool_name
    _invoke.__doc__ = tool_description

    input_schema = schema.get("inputSchema", {"type": "object", "properties": {}})

    return function_tool(
        _invoke,
        name_override=tool_name,
        description_override=tool_description,
        params_json_schema=input_schema,
    )
```

- [ ] **Step 5: Run tests**

```bash
python -m pytest tests/test_bff_tool_adapter.py -v
```

Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add openai_agent/src/bff_tool_adapter.py openai_agent/tests/test_bff_tool_adapter.py
git commit -m "feat(openai-agent): BFF tool adapter wrapping openai-agents function_tool"
```

---

### Task A4: AG-UI event emitter

Translates OpenAI Agents SDK streaming events into the AG-UI dict format the BFF pipes to the browser.

**Files:**
- Create: `openai_agent/src/agui_emitter.py`
- Create: `openai_agent/tests/test_agui_emitter.py`

- [ ] **Step 1: Write failing tests**

```python
# openai_agent/tests/test_agui_emitter.py
import pytest
from src.agui_emitter import AGUIEmitter


@pytest.fixture
def sink_and_emitter():
    collected = []
    async def sink(event): collected.append(event)
    emitter = AGUIEmitter(run_id="r1", thread_id="t1", sink=sink)
    return collected, emitter


@pytest.mark.asyncio
async def test_run_start_end(sink_and_emitter):
    collected, emitter = sink_and_emitter
    await emitter.on_run_start()
    await emitter.on_run_end()
    types = [e["type"] for e in collected]
    assert "RUN_STARTED" in types
    assert "RUN_FINISHED" in types


@pytest.mark.asyncio
async def test_text_token_sequence(sink_and_emitter):
    collected, emitter = sink_and_emitter
    await emitter.on_llm_start()
    await emitter.on_llm_token("hello")
    await emitter.on_llm_token(" world")
    await emitter.on_llm_end()
    types = [e["type"] for e in collected]
    assert types == ["TEXT_MESSAGE_START", "TEXT_MESSAGE_CONTENT", "TEXT_MESSAGE_CONTENT", "TEXT_MESSAGE_END"]
    assert collected[1]["delta"] == "hello"


@pytest.mark.asyncio
async def test_tool_call_sequence(sink_and_emitter):
    collected, emitter = sink_and_emitter
    await emitter.on_tool_start("get_accounts", "tc_1", '{"userId":"u1"}')
    await emitter.on_tool_end("tc_1", {"accounts": []})
    types = [e["type"] for e in collected]
    assert "TOOL_CALL_START" in types
    assert "TOOL_CALL_ARGS" in types
    assert "STATE_DELTA" in types
    assert "TOOL_CALL_END" in types
    start = next(e for e in collected if e["type"] == "TOOL_CALL_START")
    assert start["toolCallName"] == "get_accounts"


@pytest.mark.asyncio
async def test_error_emits_error_and_finished(sink_and_emitter):
    collected, emitter = sink_and_emitter
    await emitter.on_error(RuntimeError("boom"))
    types = [e["type"] for e in collected]
    assert "ERROR" in types
    assert "RUN_FINISHED" in types
```

- [ ] **Step 2: Run to confirm failure**

```bash
python -m pytest tests/test_agui_emitter.py -v
```

Expected: `ModuleNotFoundError: No module named 'src.agui_emitter'`

- [ ] **Step 3: Write agui_emitter.py**

```python
# openai_agent/src/agui_emitter.py
"""Translates openai-agents SDK stream events into AG-UI event dicts."""
from __future__ import annotations
import json
import uuid
import logging
from typing import Any, Callable, Coroutine

logger = logging.getLogger(__name__)


class AGUIEmitter:
    def __init__(self, run_id: str, thread_id: str, sink: Callable) -> None:
        self._run_id = run_id
        self._thread_id = thread_id
        self._sink = sink
        self._current_message_id: str | None = None

    async def _emit(self, event: dict) -> None:
        try:
            await self._sink(event)
        except Exception:
            logger.exception("AGUIEmitter sink error")

    async def on_run_start(self) -> None:
        await self._emit({"type": "RUN_STARTED", "runId": self._run_id, "threadId": self._thread_id})

    async def on_run_end(self) -> None:
        await self._emit({"type": "RUN_FINISHED", "runId": self._run_id, "threadId": self._thread_id})

    async def on_llm_start(self) -> None:
        self._current_message_id = f"msg_{uuid.uuid4().hex[:12]}"
        await self._emit({"type": "TEXT_MESSAGE_START", "messageId": self._current_message_id})

    async def on_llm_token(self, token: str) -> None:
        if not self._current_message_id:
            return
        await self._emit({"type": "TEXT_MESSAGE_CONTENT", "messageId": self._current_message_id, "delta": token})

    async def on_llm_end(self) -> None:
        if self._current_message_id:
            await self._emit({"type": "TEXT_MESSAGE_END", "messageId": self._current_message_id})
            self._current_message_id = None

    async def on_tool_start(self, tool_name: str, tool_call_id: str, args_json: str) -> None:
        await self._emit({"type": "TOOL_CALL_START", "toolCallId": tool_call_id, "toolCallName": tool_name})
        if args_json:
            await self._emit({"type": "TOOL_CALL_ARGS", "toolCallId": tool_call_id, "delta": args_json})

    async def on_tool_end(self, tool_call_id: str, result: Any) -> None:
        delta = result if isinstance(result, dict) else {"result": str(result)}
        await self._emit({"type": "STATE_DELTA", "delta": delta})
        await self._emit({"type": "TOOL_CALL_END", "toolCallId": tool_call_id})

    async def on_error(self, error: Exception) -> None:
        await self._emit({"type": "ERROR", "message": str(error), "code": "AGENT_ERROR"})
        await self._emit({"type": "RUN_FINISHED", "runId": self._run_id, "threadId": self._thread_id})
```

- [ ] **Step 4: Run tests**

```bash
python -m pytest tests/test_agui_emitter.py -v
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add openai_agent/src/agui_emitter.py openai_agent/tests/test_agui_emitter.py
git commit -m "feat(openai-agent): AG-UI emitter for openai-agents stream events"
```

---

### Task A5: Agent factory

Builds the `openai_agents.Agent` for one run — tools wired from BFF schemas, provider configured from `context.provider` / `context.model`.

**Files:**
- Create: `openai_agent/src/agent_factory.py`

- [ ] **Step 1: Write failing test**

```python
# openai_agent/tests/test_agent_factory.py
import pytest
from unittest.mock import patch, MagicMock


TOOL_SCHEMAS = [
    {"name": "get_accounts", "description": "List accounts.", "inputSchema": {"type": "object", "properties": {}}}
]
RUN_CTX = {
    "bff_tool_url": "http://127.0.0.1:3001/internal/agent-tool",
    "bff_internal_secret": "secret",
    "session_id": "sess_abc",
}


def test_build_agent_returns_agent_with_tools():
    from src.agent_factory import build_agent
    with patch("src.agent_factory.OpenAI") as mock_openai:
        agent = build_agent(
            tool_schemas=TOOL_SCHEMAS,
            run_ctx=RUN_CTX,
            provider="openai",
            model="gpt-4o",
            api_key="sk-test",
        )
    # openai-agents Agent has a .tools attribute
    assert hasattr(agent, "tools")
    assert len(agent.tools) == 1


def test_build_agent_sets_system_prompt():
    from src.agent_factory import build_agent
    agent = build_agent(
        tool_schemas=TOOL_SCHEMAS,
        run_ctx=RUN_CTX,
        provider="openai",
        model="gpt-4o",
        api_key="sk-test",
        system_prompt="You are a banking assistant.",
    )
    assert "banking" in (agent.instructions or "").lower()
```

- [ ] **Step 2: Run to confirm failure**

```bash
python -m pytest tests/test_agent_factory.py -v
```

Expected: `ModuleNotFoundError: No module named 'src.agent_factory'`

- [ ] **Step 3: Write agent_factory.py**

```python
# openai_agent/src/agent_factory.py
"""Constructs the openai-agents Agent for a single run."""
from __future__ import annotations
from agents import Agent, OpenAIChatCompletionsModel
from openai import AsyncOpenAI
from .bff_tool_adapter import build_bff_tools

DEFAULT_SYSTEM_PROMPT = (
    "You are a helpful banking assistant. Use the available tools to help the user "
    "with their accounts, transactions, and banking needs. Always confirm before "
    "initiating any transfers or payments."
)


def build_agent(
    tool_schemas: list[dict],
    run_ctx: dict,
    provider: str,
    model: str,
    api_key: str,
    system_prompt: str | None = None,
) -> Agent:
    """
    Build an openai-agents Agent for one run.

    provider: currently always "openai" — other providers require an
    OpenAI-compatible endpoint. Pass base_url via run_ctx["base_url"] if needed.
    """
    client = AsyncOpenAI(
        api_key=api_key,
        base_url=run_ctx.get("base_url"),
    )
    tools = build_bff_tools(tool_schemas, run_ctx)
    return Agent(
        name="BankingAssistant",
        instructions=system_prompt or DEFAULT_SYSTEM_PROMPT,
        model=OpenAIChatCompletionsModel(model=model, openai_client=client),
        tools=tools,
    )
```

- [ ] **Step 4: Run tests**

```bash
python -m pytest tests/test_agent_factory.py -v
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add openai_agent/src/agent_factory.py openai_agent/tests/test_agent_factory.py
git commit -m "feat(openai-agent): agent factory wiring openai-agents Agent + BFF tools"
```

---

### Task A6: Run handler (POST /run → SSE)

The FastAPI endpoint. Accepts the BFF run payload, drives the SDK streaming loop, emits AG-UI events as SSE.

**Files:**
- Create: `openai_agent/src/run_handler.py`

- [ ] **Step 1: Write failing test**

```python
# openai_agent/tests/test_run_handler.py
import pytest
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, patch, MagicMock
import json


RUN_PAYLOAD = {
    "threadId": "t1",
    "runId": "r1",
    "messages": [{"role": "user", "content": "What are my accounts?"}],
    "tools": [{"name": "get_accounts", "description": "...", "inputSchema": {"type": "object", "properties": {}}}],
    "context": {
        "bffToolUrl": "http://127.0.0.1:3001/internal/agent-tool",
        "sessionId": "sess_abc",
        "initialTokenEvents": [],
        "provider": "openai",
        "model": "gpt-4o",
    },
}


def _parse_sse(text: str) -> list[dict]:
    events = []
    for line in text.splitlines():
        if line.startswith("data: "):
            events.append(json.loads(line[6:]))
    return events


def test_run_returns_sse_stream_with_run_started_and_finished():
    """POST /run produces at minimum RUN_STARTED and RUN_FINISHED."""
    with patch("src.run_handler.build_agent") as mock_build, \
         patch("src.run_handler.Runner") as mock_runner_cls:
        # Mock the SDK streaming: produce a single text delta then finish
        mock_agent = MagicMock()
        mock_build.return_value = mock_agent

        async def fake_stream(*args, **kwargs):
            from agents.stream_events import RawResponsesStreamEvent
            # Yield nothing — emitter produces RUN_STARTED + RUN_FINISHED at min
            return
            yield  # make it an async generator

        mock_runner_cls.run_streamed.return_value.__aenter__ = AsyncMock(return_value=MagicMock(stream_events=fake_stream))
        mock_runner_cls.run_streamed.return_value.__aexit__ = AsyncMock(return_value=False)

        from src.main import app
        client = TestClient(app)
        resp = client.post("/run", json=RUN_PAYLOAD)

    assert resp.status_code == 200
    assert "text/event-stream" in resp.headers["content-type"]
    events = _parse_sse(resp.text)
    types = [e["type"] for e in events]
    assert "RUN_STARTED" in types
    assert "RUN_FINISHED" in types
```

- [ ] **Step 2: Run to confirm failure**

```bash
python -m pytest tests/test_run_handler.py -v
```

Expected: `ModuleNotFoundError: No module named 'src.main'`

- [ ] **Step 3: Write run_handler.py**

```python
# openai_agent/src/run_handler.py
"""POST /run — accepts BFF run payload, returns AG-UI SSE stream."""
from __future__ import annotations
import asyncio
import json
import logging
import uuid
from typing import AsyncGenerator

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from agents import Runner
from agents.stream_events import (
    RawResponsesStreamEvent,
    RunItemStreamEvent,
    AgentUpdatedStreamEvent,
)

from .agent_factory import build_agent
from .agui_emitter import AGUIEmitter
from .config import get_config

logger = logging.getLogger(__name__)
router = APIRouter()


def _format_sse(event: dict) -> str:
    return f"data: {json.dumps(event)}\n\n"


@router.post("/run")
async def agent_run(request: Request) -> StreamingResponse:
    body = await request.json()
    thread_id: str = body.get("threadId", f"t_{uuid.uuid4().hex[:8]}")
    run_id: str = body.get("runId", f"r_{uuid.uuid4().hex[:8]}")
    messages: list = body.get("messages", [])
    tool_schemas: list = body.get("tools", [])
    ctx: dict = body.get("context", {})

    bff_tool_url = ctx.get("bffToolUrl", "")
    session_id = ctx.get("sessionId", "")
    provider = ctx.get("provider", "openai")
    model = ctx.get("model", "gpt-4o")

    cfg = get_config()
    run_ctx = {
        "bff_tool_url": bff_tool_url or cfg.bff_tool_url,
        "bff_internal_secret": cfg.bff_internal_secret,
        "session_id": session_id,
    }

    return StreamingResponse(
        _stream(run_id, thread_id, messages, tool_schemas, run_ctx, provider, model, cfg.openai_api_key),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


async def _stream(
    run_id: str,
    thread_id: str,
    messages: list,
    tool_schemas: list,
    run_ctx: dict,
    provider: str,
    model: str,
    api_key: str,
) -> AsyncGenerator[str, None]:
    queue: asyncio.Queue = asyncio.Queue()

    async def sink(event: dict) -> None:
        await queue.put(event)

    emitter = AGUIEmitter(run_id=run_id, thread_id=thread_id, sink=sink)

    async def run_agent() -> None:
        try:
            await emitter.on_run_start()
            agent = build_agent(
                tool_schemas=tool_schemas,
                run_ctx=run_ctx,
                provider=provider,
                model=model,
                api_key=api_key,
            )
            # Build input: last user message content
            user_input = next(
                (m["content"] for m in reversed(messages) if m.get("role") == "user"),
                "",
            )
            async with Runner.run_streamed(agent, user_input) as result:
                async for event in result.stream_events():
                    await _handle_sdk_event(event, emitter)
            await emitter.on_run_end()
        except Exception as exc:
            logger.exception("[openai-agent] run error run=%s", run_id)
            await emitter.on_error(exc)
        finally:
            await queue.put(None)  # sentinel

    agent_task = asyncio.create_task(run_agent())

    try:
        while True:
            item = await queue.get()
            if item is None:
                break
            yield _format_sse(item)
    finally:
        agent_task.cancel()


async def _handle_sdk_event(event, emitter: AGUIEmitter) -> None:
    """Map openai-agents stream events to AG-UI emitter calls."""
    from agents.stream_events import RawResponsesStreamEvent, RunItemStreamEvent
    from openai.types.responses import ResponseTextDeltaEvent, ResponseFunctionCallArgumentsDeltaEvent

    if isinstance(event, RawResponsesStreamEvent):
        data = event.data
        if isinstance(data, ResponseTextDeltaEvent):
            if not emitter._current_message_id:
                await emitter.on_llm_start()
            await emitter.on_llm_token(data.delta)
    elif isinstance(event, RunItemStreamEvent):
        item = event.item
        item_type = getattr(item, "type", None)
        if item_type == "tool_call_item":
            tc_id = getattr(item, "raw_item", {}).get("call_id", uuid.uuid4().hex[:12])
            name = getattr(item, "raw_item", {}).get("name", "unknown")
            args = getattr(item, "raw_item", {}).get("arguments", "{}")
            await emitter.on_tool_start(name, tc_id, args)
        elif item_type == "tool_call_output_item":
            tc_id = getattr(item, "raw_item", {}).get("call_id", "")
            output = getattr(item, "output", "")
            await emitter.on_tool_end(tc_id, output)
        elif item_type == "message_output_item":
            # Full message end — close open text message
            await emitter.on_llm_end()
```

- [ ] **Step 4: Write main.py**

```python
# openai_agent/src/main.py
import logging
import uvicorn
from fastapi import FastAPI
from .run_handler import router
from .config import get_config

logging.basicConfig(level=logging.INFO)
app = FastAPI(title="OpenAI Agent", docs_url=None, redoc_url=None)
app.include_router(router)


if __name__ == "__main__":
    cfg = get_config()
    uvicorn.run("src.main:app", host=cfg.host, port=cfg.port, log_level="info")
```

- [ ] **Step 5: Run tests**

```bash
python -m pytest tests/test_run_handler.py -v
```

Expected: 1 passed.

- [ ] **Step 6: Commit**

```bash
git add openai_agent/src/run_handler.py openai_agent/src/main.py openai_agent/tests/test_run_handler.py
git commit -m "feat(openai-agent): POST /run SSE handler with openai-agents streaming"
```

---

### Task A7: Wire into run.sh and verify end-to-end

**Files:**
- Modify: `run.sh` (add openai_agent service alongside langchain_agent)

- [ ] **Step 1: Check openai_agent .env exists (copy from .env.example and fill OPENAI_API_KEY)**

```bash
cp openai_agent/.env.example openai_agent/.env
# Edit openai_agent/.env and set OPENAI_API_KEY
```

- [ ] **Step 2: Add service block to run.sh**

In `run.sh`, after the LangChain Agent block (around line 968), add:

```bash
# ── OpenAI Agents SDK (port 8891) ────────────────────────────────────────────
if [[ -f "$BASEDIR/openai_agent/src/main.py" ]]; then
  echo "[OASDK] Starting OpenAI Agents SDK service (:8891)..."
  (
    cd "$BASEDIR/openai_agent"
    PY=".venv/bin/python"
    [[ ! -x "$PY" ]] && PY="python3"
    "$PY" -m src.main >> /tmp/demo-openai-agent.log 2>&1
  ) &
  echo $! > /tmp/demo-openai-agent.pid
fi
```

- [ ] **Step 3: Start services and smoke test**

```bash
./run.sh stop && ./run.sh
# In another terminal:
curl -s http://127.0.0.1:8891/health 2>/dev/null || echo "No /health route yet — that is OK"
curl -s -X POST http://127.0.0.1:8891/run \
  -H "Content-Type: application/json" \
  -d '{"threadId":"t1","runId":"r1","messages":[{"role":"user","content":"hello"}],"tools":[],"context":{"provider":"openai","model":"gpt-4o","sessionId":"test","bffToolUrl":"","initialTokenEvents":[]}}' \
  --no-buffer | head -5
```

Expected: SSE lines beginning with `data: {"type":"RUN_STARTED"...}` appear.

- [ ] **Step 4: Commit**

```bash
git add run.sh
git commit -m "feat(openai-agent): wire service into run.sh on port 8891"
```

---

## Part B — Mastra

### Task B1: Scaffold directory and install dependencies

**Files:**
- Create: `mastra_agent/package.json`
- Create: `mastra_agent/tsconfig.json`
- Create: `mastra_agent/.env.example`
- Create: `mastra_agent/src/index.ts`

- [ ] **Step 1: Write package.json**

```json
{
  "name": "mastra-agent",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "ts-node src/index.ts",
    "test": "jest"
  },
  "dependencies": {
    "@mastra/core": "^0.10.0",
    "@ai-sdk/openai": "^1.0.0",
    "express": "^4.19.0",
    "zod": "^3.23.0",
    "dotenv": "^16.4.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^20.0.0",
    "typescript": "^5.4.0",
    "ts-node": "^10.9.0",
    "jest": "^29.0.0",
    "ts-jest": "^29.0.0",
    "@types/jest": "^29.5.0"
  }
}
```

- [ ] **Step 2: Write tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: Write .env.example**

```bash
# mastra_agent/.env.example
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o
BFF_INTERNAL_SECRET=dev-shared-secret-change-me
BFF_INTERNAL_TOOL_URL=http://127.0.0.1:3001/internal/agent-tool
AGENT_HTTP_HOST=127.0.0.1
AGENT_HTTP_PORT=8892
```

- [ ] **Step 4: Install**

```bash
cd mastra_agent && npm install
```

Expected: no peer dependency errors.

- [ ] **Step 5: Commit**

```bash
git add mastra_agent/package.json mastra_agent/tsconfig.json mastra_agent/.env.example
git commit -m "feat(mastra): scaffold directory and dependencies"
```

---

### Task B2: Config and BFF tool adapter

**Files:**
- Create: `mastra_agent/src/config.ts`
- Create: `mastra_agent/src/bffToolAdapter.ts`
- Create: `mastra_agent/tests/bffToolAdapter.test.ts`

- [ ] **Step 1: Write config.ts**

```typescript
// mastra_agent/src/config.ts
import * as dotenv from 'dotenv';
dotenv.config();

export interface Config {
  openaiApiKey: string;
  model: string;
  bffInternalSecret: string;
  bffToolUrl: string;
  host: string;
  port: number;
}

export function getConfig(): Config {
  return {
    openaiApiKey: process.env.OPENAI_API_KEY ?? '',
    model: process.env.OPENAI_MODEL ?? 'gpt-4o',
    bffInternalSecret: process.env.BFF_INTERNAL_SECRET ?? 'dev-shared-secret-change-me',
    bffToolUrl: process.env.BFF_INTERNAL_TOOL_URL ?? 'http://127.0.0.1:3001/internal/agent-tool',
    host: process.env.AGENT_HTTP_HOST ?? '127.0.0.1',
    port: parseInt(process.env.AGENT_HTTP_PORT ?? '8892', 10),
  };
}
```

- [ ] **Step 2: Write failing test for bffToolAdapter**

```typescript
// mastra_agent/tests/bffToolAdapter.test.ts
import { buildBffTools } from '../src/bffToolAdapter';

const SCHEMA = {
  name: 'get_accounts',
  description: 'List accounts',
  inputSchema: { type: 'object' as const, properties: {} },
};

const RUN_CTX = {
  bffToolUrl: 'http://127.0.0.1:3001/internal/agent-tool',
  bffInternalSecret: 'secret',
  sessionId: 'sess_abc',
};

describe('buildBffTools', () => {
  it('returns one tool per schema', () => {
    const tools = buildBffTools([SCHEMA], RUN_CTX);
    expect(tools).toHaveLength(1);
  });

  it('tool has correct id and description', () => {
    const tools = buildBffTools([SCHEMA], RUN_CTX);
    expect(tools[0].id).toBe('get_accounts');
    expect(tools[0].description).toBe('List accounts');
  });

  it('tool execute calls BFF and returns result', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: { accounts: [] } }),
    } as any);

    const tools = buildBffTools([SCHEMA], RUN_CTX);
    const result = await tools[0].execute({ context: { userId: 'u1' } });
    expect(result).toEqual({ accounts: [] });
    expect(global.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:3001/internal/agent-tool',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('tool execute throws on non-ok BFF response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'internal error',
    } as any);

    const tools = buildBffTools([SCHEMA], RUN_CTX);
    await expect(tools[0].execute({ context: { userId: 'u1' } })).rejects.toThrow('BFF');
  });
});
```

- [ ] **Step 3: Run to confirm failure**

```bash
cd mastra_agent && npm test -- tests/bffToolAdapter.test.ts
```

Expected: `Cannot find module '../src/bffToolAdapter'`

- [ ] **Step 4: Write bffToolAdapter.ts**

```typescript
// mastra_agent/src/bffToolAdapter.ts
import { createTool } from '@mastra/core';
import { z } from 'zod';

export interface ToolSchema {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface RunCtx {
  bffToolUrl: string;
  bffInternalSecret: string;
  sessionId: string;
}

export class BffToolError extends Error {}

export function buildBffTools(schemas: ToolSchema[], runCtx: RunCtx) {
  return schemas.map((schema) => _makeTool(schema, runCtx));
}

function _makeTool(schema: ToolSchema, runCtx: RunCtx) {
  // Build a Zod schema from the JSON Schema properties (shallow — covers simple tool inputs)
  const props = (schema.inputSchema as any).properties ?? {};
  const zodShape: Record<string, z.ZodTypeAny> = {};
  for (const [key, val] of Object.entries(props)) {
    const propDef = val as any;
    zodShape[key] = propDef.type === 'number' ? z.number().optional() : z.string().optional();
  }

  return createTool({
    id: schema.name,
    description: schema.description,
    inputSchema: z.object(zodShape),
    execute: async ({ context }) => {
      const resp = await fetch(runCtx.bffToolUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-gateway-secret': runCtx.bffInternalSecret,
          'x-session-id': runCtx.sessionId,
        },
        body: JSON.stringify({ tool: schema.name, args: context, sessionId: runCtx.sessionId }),
      });

      if (!resp.ok) {
        const text = await resp.text();
        throw new BffToolError(`BFF returned HTTP ${resp.status}: ${text.slice(0, 200)}`);
      }

      const data = await resp.json() as any;
      return data.result ?? data;
    },
  });
}
```

- [ ] **Step 5: Add jest config to package.json**

Add to `mastra_agent/package.json`:

```json
"jest": {
  "preset": "ts-jest",
  "testEnvironment": "node",
  "testMatch": ["**/tests/**/*.test.ts"]
}
```

- [ ] **Step 6: Run tests**

```bash
npm test -- tests/bffToolAdapter.test.ts
```

Expected: 4 passed.

- [ ] **Step 7: Commit**

```bash
git add mastra_agent/src/config.ts mastra_agent/src/bffToolAdapter.ts mastra_agent/tests/bffToolAdapter.test.ts mastra_agent/package.json
git commit -m "feat(mastra): config + BFF tool adapter"
```

---

### Task B3: AG-UI emitter and agent factory

**Files:**
- Create: `mastra_agent/src/aguiEmitter.ts`
- Create: `mastra_agent/src/agentFactory.ts`
- Create: `mastra_agent/tests/aguiEmitter.test.ts`

- [ ] **Step 1: Write failing emitter tests**

```typescript
// mastra_agent/tests/aguiEmitter.test.ts
import { AGUIEmitter } from '../src/aguiEmitter';

function makeSink() {
  const events: any[] = [];
  const sink = async (e: any) => events.push(e);
  return { events, sink };
}

describe('AGUIEmitter', () => {
  it('emits RUN_STARTED and RUN_FINISHED', async () => {
    const { events, sink } = makeSink();
    const emitter = new AGUIEmitter('r1', 't1', sink);
    await emitter.onRunStart();
    await emitter.onRunEnd();
    expect(events.map(e => e.type)).toEqual(['RUN_STARTED', 'RUN_FINISHED']);
  });

  it('emits correct text message sequence', async () => {
    const { events, sink } = makeSink();
    const emitter = new AGUIEmitter('r1', 't1', sink);
    await emitter.onLlmStart();
    await emitter.onLlmToken('hello');
    await emitter.onLlmEnd();
    expect(events.map(e => e.type)).toEqual(['TEXT_MESSAGE_START', 'TEXT_MESSAGE_CONTENT', 'TEXT_MESSAGE_END']);
    expect(events[1].delta).toBe('hello');
  });

  it('emits TOOL_CALL_START + TOOL_CALL_ARGS + STATE_DELTA + TOOL_CALL_END', async () => {
    const { events, sink } = makeSink();
    const emitter = new AGUIEmitter('r1', 't1', sink);
    await emitter.onToolStart('get_accounts', 'tc_1', '{"userId":"u1"}');
    await emitter.onToolEnd('tc_1', { accounts: [] });
    expect(events.map(e => e.type)).toEqual(['TOOL_CALL_START', 'TOOL_CALL_ARGS', 'STATE_DELTA', 'TOOL_CALL_END']);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
npm test -- tests/aguiEmitter.test.ts
```

Expected: `Cannot find module '../src/aguiEmitter'`

- [ ] **Step 3: Write aguiEmitter.ts**

```typescript
// mastra_agent/src/aguiEmitter.ts
import { randomUUID } from 'crypto';

type Sink = (event: Record<string, unknown>) => Promise<void>;

export class AGUIEmitter {
  private currentMessageId: string | null = null;

  constructor(
    private readonly runId: string,
    private readonly threadId: string,
    private readonly sink: Sink,
  ) {}

  private async emit(event: Record<string, unknown>) {
    await this.sink(event);
  }

  async onRunStart() { await this.emit({ type: 'RUN_STARTED', runId: this.runId, threadId: this.threadId }); }
  async onRunEnd() { await this.emit({ type: 'RUN_FINISHED', runId: this.runId, threadId: this.threadId }); }

  async onLlmStart() {
    this.currentMessageId = `msg_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    await this.emit({ type: 'TEXT_MESSAGE_START', messageId: this.currentMessageId });
  }

  async onLlmToken(token: string) {
    if (!this.currentMessageId) return;
    await this.emit({ type: 'TEXT_MESSAGE_CONTENT', messageId: this.currentMessageId, delta: token });
  }

  async onLlmEnd() {
    if (this.currentMessageId) {
      await this.emit({ type: 'TEXT_MESSAGE_END', messageId: this.currentMessageId });
      this.currentMessageId = null;
    }
  }

  async onToolStart(toolName: string, toolCallId: string, argsJson: string) {
    await this.emit({ type: 'TOOL_CALL_START', toolCallId, toolCallName: toolName });
    if (argsJson) await this.emit({ type: 'TOOL_CALL_ARGS', toolCallId, delta: argsJson });
  }

  async onToolEnd(toolCallId: string, result: unknown) {
    const delta = typeof result === 'object' && result !== null ? result : { result: String(result) };
    await this.emit({ type: 'STATE_DELTA', delta });
    await this.emit({ type: 'TOOL_CALL_END', toolCallId });
  }

  async onError(error: Error) {
    await this.emit({ type: 'ERROR', message: error.message, code: 'AGENT_ERROR' });
    await this.emit({ type: 'RUN_FINISHED', runId: this.runId, threadId: this.threadId });
  }
}
```

- [ ] **Step 4: Write agentFactory.ts**

```typescript
// mastra_agent/src/agentFactory.ts
import { Agent } from '@mastra/core';
import { openai } from '@ai-sdk/openai';
import { buildBffTools, RunCtx, ToolSchema } from './bffToolAdapter';

const DEFAULT_INSTRUCTIONS =
  'You are a helpful banking assistant. Use the available tools to help the user with their accounts, transactions, and banking needs.';

export function buildAgent(
  toolSchemas: ToolSchema[],
  runCtx: RunCtx,
  model: string,
  instructions?: string,
): Agent {
  const tools = buildBffTools(toolSchemas, runCtx);
  const toolMap = Object.fromEntries(tools.map((t) => [t.id, t]));

  return new Agent({
    name: 'BankingAssistant',
    instructions: instructions ?? DEFAULT_INSTRUCTIONS,
    model: openai(model),
    tools: toolMap,
  });
}
```

- [ ] **Step 5: Run tests**

```bash
npm test -- tests/aguiEmitter.test.ts
```

Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add mastra_agent/src/aguiEmitter.ts mastra_agent/src/agentFactory.ts mastra_agent/tests/aguiEmitter.test.ts
git commit -m "feat(mastra): AG-UI emitter + agent factory"
```

---

### Task B4: Run handler and entry point

**Files:**
- Create: `mastra_agent/src/runHandler.ts`
- Create: `mastra_agent/src/index.ts`

- [ ] **Step 1: Write runHandler.ts**

```typescript
// mastra_agent/src/runHandler.ts
import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { buildAgent } from './agentFactory';
import { AGUIEmitter } from './aguiEmitter';
import { getConfig } from './config';
import { ToolSchema, RunCtx } from './bffToolAdapter';

function formatSse(event: Record<string, unknown>): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export async function handleRun(req: Request, res: Response): Promise<void> {
  const body = req.body ?? {};
  const threadId: string = body.threadId ?? `t_${randomUUID().slice(0, 8)}`;
  const runId: string = body.runId ?? `r_${randomUUID().slice(0, 8)}`;
  const messages: Array<{ role: string; content: string }> = body.messages ?? [];
  const toolSchemas: ToolSchema[] = (body.tools ?? []).map((t: any) => ({
    name: t.name,
    description: t.description ?? '',
    inputSchema: t.inputSchema ?? { type: 'object', properties: {} },
  }));
  const ctx = body.context ?? {};
  const sessionId: string = ctx.sessionId ?? '';
  const model: string = ctx.model ?? getConfig().model;

  const cfg = getConfig();
  const runCtx: RunCtx = {
    bffToolUrl: ctx.bffToolUrl || cfg.bffToolUrl,
    bffInternalSecret: cfg.bffInternalSecret,
    sessionId,
  };

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const emitter = new AGUIEmitter(runId, threadId, async (event) => {
    res.write(formatSse(event));
  });

  try {
    await emitter.onRunStart();
    const agent = buildAgent(toolSchemas, runCtx, model);
    const userMessage = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';

    const stream = await agent.stream(userMessage);

    for await (const chunk of stream.textStream) {
      if (!emitter['currentMessageId']) await emitter.onLlmStart();
      await emitter.onLlmToken(chunk);
    }
    await emitter.onLlmEnd();
    await emitter.onRunEnd();
  } catch (err) {
    await emitter.onError(err instanceof Error ? err : new Error(String(err)));
  } finally {
    res.end();
  }
}
```

- [ ] **Step 2: Write index.ts**

```typescript
// mastra_agent/src/index.ts
import express from 'express';
import { getConfig } from './config';
import { handleRun } from './runHandler';

const app = express();
app.use(express.json());
app.post('/run', handleRun);

const cfg = getConfig();
app.listen(cfg.port, cfg.host, () => {
  console.log(`[mastra] listening on ${cfg.host}:${cfg.port}`);
});
```

- [ ] **Step 3: Build**

```bash
cd mastra_agent && npm run build
```

Expected: `dist/index.js` created, exit 0.

- [ ] **Step 4: Smoke test**

```bash
node dist/index.js &
sleep 2
curl -s -X POST http://127.0.0.1:8892/run \
  -H "Content-Type: application/json" \
  -d '{"threadId":"t1","runId":"r1","messages":[{"role":"user","content":"hello"}],"tools":[],"context":{"provider":"openai","model":"gpt-4o","sessionId":"test","bffToolUrl":""}}' \
  --no-buffer | head -3
kill %1
```

Expected: SSE lines with `RUN_STARTED` and `RUN_FINISHED`.

- [ ] **Step 5: Commit**

```bash
git add mastra_agent/src/runHandler.ts mastra_agent/src/index.ts
git commit -m "feat(mastra): POST /run SSE handler and Express entry point"
```

---

## Part C — Pydantic AI

### Task C1: Scaffold directory and install dependencies

**Files:**
- Create: `pydantic_agent/requirements.txt`
- Create: `pydantic_agent/.env.example`
- Create: `pydantic_agent/src/__init__.py`
- Create: `pydantic_agent/tests/__init__.py`
- Create: `pydantic_agent/conftest.py`

- [ ] **Step 1: Write requirements.txt**

```
# pydantic_agent/requirements.txt
pydantic-ai>=0.0.54
pydantic>=2.7.0
fastapi>=0.111.0
uvicorn[standard]>=0.29.0
httpx>=0.27.0
python-dotenv>=1.0.0
pytest>=8.0.0
pytest-asyncio>=0.23.0
respx>=0.21.0
```

- [ ] **Step 2: Write .env.example**

```bash
# pydantic_agent/.env.example
OPENAI_API_KEY=sk-...
OPENAI_MODEL=openai:gpt-4o
BFF_INTERNAL_SECRET=dev-shared-secret-change-me
BFF_INTERNAL_TOOL_URL=http://127.0.0.1:3001/internal/agent-tool
AGENT_HTTP_HOST=127.0.0.1
AGENT_HTTP_PORT=8893
```

- [ ] **Step 3: Write conftest.py**

```python
# pydantic_agent/conftest.py
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
```

- [ ] **Step 4: Create venv and install**

```bash
cd pydantic_agent
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

Expected: `python -c "import pydantic_ai"` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add pydantic_agent/requirements.txt pydantic_agent/.env.example pydantic_agent/src/__init__.py pydantic_agent/tests/__init__.py pydantic_agent/conftest.py
git commit -m "feat(pydantic-ai): scaffold directory and dependencies"
```

---

### Task C2: Models, config, and BFF tool adapter

**Files:**
- Create: `pydantic_agent/src/models.py`
- Create: `pydantic_agent/src/config.py`
- Create: `pydantic_agent/src/bff_tool_adapter.py`
- Create: `pydantic_agent/tests/test_bff_tool_adapter.py`

- [ ] **Step 1: Write models.py**

```python
# pydantic_agent/src/models.py
from __future__ import annotations
from dataclasses import dataclass
import httpx


@dataclass
class BffDeps:
    """Injected into every tool call via RunContext[BffDeps]."""
    http_client: httpx.AsyncClient
    bff_tool_url: str
    bff_internal_secret: str
    session_id: str
```

- [ ] **Step 2: Write config.py**

```python
# pydantic_agent/src/config.py
from __future__ import annotations
import os
from dataclasses import dataclass
from dotenv import load_dotenv

load_dotenv()


@dataclass
class Config:
    openai_api_key: str
    model: str
    bff_internal_secret: str
    bff_tool_url: str
    host: str
    port: int


def get_config() -> Config:
    return Config(
        openai_api_key=os.environ.get("OPENAI_API_KEY", ""),
        model=os.environ.get("OPENAI_MODEL", "openai:gpt-4o"),
        bff_internal_secret=os.environ.get("BFF_INTERNAL_SECRET", "dev-shared-secret-change-me"),
        bff_tool_url=os.environ.get("BFF_INTERNAL_TOOL_URL", "http://127.0.0.1:3001/internal/agent-tool"),
        host=os.environ.get("AGENT_HTTP_HOST", "127.0.0.1"),
        port=int(os.environ.get("AGENT_HTTP_PORT", "8893")),
    )
```

- [ ] **Step 3: Write failing tests for bff_tool_adapter**

```python
# pydantic_agent/tests/test_bff_tool_adapter.py
import json
import pytest
import httpx
import respx
from src.models import BffDeps
from src.bff_tool_adapter import build_tool_functions, BffToolError


TOOL_SCHEMAS = [
    {
        "name": "get_accounts",
        "description": "List accounts.",
        "inputSchema": {
            "type": "object",
            "properties": {"userId": {"type": "string"}},
            "required": ["userId"],
        },
    }
]


def test_build_returns_one_function_per_schema():
    fns = build_tool_functions(TOOL_SCHEMAS)
    assert len(fns) == 1
    assert callable(fns[0])


@pytest.mark.asyncio
@respx.mock
async def test_tool_fn_calls_bff_and_returns_json():
    respx.post("http://127.0.0.1:3001/internal/agent-tool").mock(
        return_value=httpx.Response(200, json={"result": {"accounts": []}})
    )
    fns = build_tool_functions(TOOL_SCHEMAS)
    tool_fn = fns[0]

    # Simulate RunContext[BffDeps] — we call the underlying plain function
    deps = BffDeps(
        http_client=httpx.AsyncClient(),
        bff_tool_url="http://127.0.0.1:3001/internal/agent-tool",
        bff_internal_secret="secret",
        session_id="sess_abc",
    )
    # pydantic-ai tools are plain async functions; call directly with deps
    result = await tool_fn.__wrapped__(deps, userId="u1")
    assert result == {"accounts": []}


@pytest.mark.asyncio
@respx.mock
async def test_tool_fn_raises_on_http_error():
    respx.post("http://127.0.0.1:3001/internal/agent-tool").mock(
        return_value=httpx.Response(500, text="error")
    )
    fns = build_tool_functions(TOOL_SCHEMAS)
    deps = BffDeps(
        http_client=httpx.AsyncClient(),
        bff_tool_url="http://127.0.0.1:3001/internal/agent-tool",
        bff_internal_secret="secret",
        session_id="sess_abc",
    )
    with pytest.raises(BffToolError):
        await fns[0].__wrapped__(deps, userId="u1")
```

- [ ] **Step 4: Run to confirm failure**

```bash
cd pydantic_agent && source .venv/bin/activate
python -m pytest tests/test_bff_tool_adapter.py -v
```

Expected: `ModuleNotFoundError: No module named 'src.bff_tool_adapter'`

- [ ] **Step 5: Write bff_tool_adapter.py**

```python
# pydantic_agent/src/bff_tool_adapter.py
"""Creates pydantic-ai tools that call the BFF /internal/agent-tool endpoint."""
from __future__ import annotations
import json
import logging
from typing import Any, Callable

from pydantic_ai import RunContext
from .models import BffDeps

logger = logging.getLogger(__name__)


class BffToolError(Exception):
    pass


def build_tool_functions(tool_schemas: list[dict]) -> list[Callable]:
    """Return one plain async function per schema. Each carries a __wrapped__ attribute
    that accepts (BffDeps, **kwargs) — used directly in tests and by the agent factory."""
    return [_make_fn(s) for s in tool_schemas]


def _make_fn(schema: dict) -> Callable:
    name = schema["name"]
    description = schema.get("description", "")
    input_props = schema.get("inputSchema", {}).get("properties", {})

    async def _tool(ctx: RunContext[BffDeps], **kwargs: Any) -> Any:
        deps = ctx.deps
        logger.info("[PydanticAI] %s kwargs=%s session=%s", name, kwargs, deps.session_id)
        resp = await deps.http_client.post(
            deps.bff_tool_url,
            json={"tool": name, "args": kwargs, "sessionId": deps.session_id},
            headers={
                "x-internal-gateway-secret": deps.bff_internal_secret,
                "x-session-id": deps.session_id,
            },
        )
        if resp.status_code != 200:
            raise BffToolError(f"BFF HTTP {resp.status_code}: {resp.text[:200]}")
        data = resp.json()
        return data.get("result", data)

    async def _wrapped(deps: BffDeps, **kwargs: Any) -> Any:
        """Test-callable version: accepts BffDeps directly instead of RunContext."""

        class _FakeCtx:
            def __init__(self, d): self.deps = d

        return await _tool(_FakeCtx(deps), **kwargs)

    _tool.__name__ = name
    _tool.__doc__ = description
    _tool.__wrapped__ = _wrapped
    return _tool
```

- [ ] **Step 6: Run tests**

```bash
python -m pytest tests/test_bff_tool_adapter.py -v
```

Expected: 3 passed.

- [ ] **Step 7: Commit**

```bash
git add pydantic_agent/src/models.py pydantic_agent/src/config.py pydantic_agent/src/bff_tool_adapter.py pydantic_agent/tests/test_bff_tool_adapter.py
git commit -m "feat(pydantic-ai): models, config, BFF tool adapter"
```

---

### Task C3: Agent factory and AG-UI emitter

**Files:**
- Create: `pydantic_agent/src/agent_factory.py`
- Create: `pydantic_agent/src/agui_emitter.py`
- Create: `pydantic_agent/tests/test_agui_emitter.py`

- [ ] **Step 1: Write failing emitter tests**

```python
# pydantic_agent/tests/test_agui_emitter.py
import pytest
from src.agui_emitter import AGUIEmitter


@pytest.fixture
def sink_emitter():
    events = []
    async def sink(e): events.append(e)
    return events, AGUIEmitter("r1", "t1", sink)


@pytest.mark.asyncio
async def test_run_lifecycle(sink_emitter):
    events, emitter = sink_emitter
    await emitter.on_run_start()
    await emitter.on_run_end()
    assert [e["type"] for e in events] == ["RUN_STARTED", "RUN_FINISHED"]


@pytest.mark.asyncio
async def test_text_token_sequence(sink_emitter):
    events, emitter = sink_emitter
    await emitter.on_llm_start()
    await emitter.on_llm_token("hi")
    await emitter.on_llm_end()
    assert [e["type"] for e in events] == ["TEXT_MESSAGE_START", "TEXT_MESSAGE_CONTENT", "TEXT_MESSAGE_END"]
    assert events[1]["delta"] == "hi"


@pytest.mark.asyncio
async def test_tool_sequence(sink_emitter):
    events, emitter = sink_emitter
    await emitter.on_tool_start("get_accounts", "tc1", '{}')
    await emitter.on_tool_end("tc1", {"ok": True})
    types = [e["type"] for e in events]
    assert "TOOL_CALL_START" in types
    assert "STATE_DELTA" in types
    assert "TOOL_CALL_END" in types
```

- [ ] **Step 2: Write agui_emitter.py** (same shape as openai_agent version)

```python
# pydantic_agent/src/agui_emitter.py
from __future__ import annotations
import uuid
import logging
from typing import Any, Callable

logger = logging.getLogger(__name__)


class AGUIEmitter:
    def __init__(self, run_id: str, thread_id: str, sink: Callable) -> None:
        self._run_id = run_id
        self._thread_id = thread_id
        self._sink = sink
        self._current_message_id: str | None = None

    async def _emit(self, event: dict) -> None:
        try:
            await self._sink(event)
        except Exception:
            logger.exception("AGUIEmitter sink error")

    async def on_run_start(self) -> None:
        await self._emit({"type": "RUN_STARTED", "runId": self._run_id, "threadId": self._thread_id})

    async def on_run_end(self) -> None:
        await self._emit({"type": "RUN_FINISHED", "runId": self._run_id, "threadId": self._thread_id})

    async def on_llm_start(self) -> None:
        self._current_message_id = f"msg_{uuid.uuid4().hex[:12]}"
        await self._emit({"type": "TEXT_MESSAGE_START", "messageId": self._current_message_id})

    async def on_llm_token(self, token: str) -> None:
        if not self._current_message_id:
            return
        await self._emit({"type": "TEXT_MESSAGE_CONTENT", "messageId": self._current_message_id, "delta": token})

    async def on_llm_end(self) -> None:
        if self._current_message_id:
            await self._emit({"type": "TEXT_MESSAGE_END", "messageId": self._current_message_id})
            self._current_message_id = None

    async def on_tool_start(self, tool_name: str, tool_call_id: str, args_json: str) -> None:
        await self._emit({"type": "TOOL_CALL_START", "toolCallId": tool_call_id, "toolCallName": tool_name})
        if args_json:
            await self._emit({"type": "TOOL_CALL_ARGS", "toolCallId": tool_call_id, "delta": args_json})

    async def on_tool_end(self, tool_call_id: str, result: Any) -> None:
        delta = result if isinstance(result, dict) else {"result": str(result)}
        await self._emit({"type": "STATE_DELTA", "delta": delta})
        await self._emit({"type": "TOOL_CALL_END", "toolCallId": tool_call_id})

    async def on_error(self, error: Exception) -> None:
        await self._emit({"type": "ERROR", "message": str(error), "code": "AGENT_ERROR"})
        await self._emit({"type": "RUN_FINISHED", "runId": self._run_id, "threadId": self._thread_id})
```

- [ ] **Step 3: Write agent_factory.py**

```python
# pydantic_agent/src/agent_factory.py
"""Builds a pydantic-ai Agent with BFF tools injected via dependency."""
from __future__ import annotations
from pydantic_ai import Agent
from .bff_tool_adapter import build_tool_functions
from .models import BffDeps

DEFAULT_SYSTEM_PROMPT = (
    "You are a helpful banking assistant. Use the available tools to help the user "
    "with their accounts, transactions, and banking needs."
)


def build_agent(
    tool_schemas: list[dict],
    model: str,
    system_prompt: str | None = None,
) -> Agent[BffDeps]:
    """
    Build a pydantic-ai Agent.

    Tools receive BffDeps via RunContext[BffDeps] — the deps are injected per-run
    in run_handler.py via agent.run(..., deps=BffDeps(...)).
    """
    tool_fns = build_tool_functions(tool_schemas)

    agent: Agent[BffDeps] = Agent(
        model=model,
        deps_type=BffDeps,
        system_prompt=system_prompt or DEFAULT_SYSTEM_PROMPT,
        tools=tool_fns,
    )
    return agent
```

- [ ] **Step 4: Run tests**

```bash
python -m pytest tests/test_agui_emitter.py -v
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add pydantic_agent/src/agui_emitter.py pydantic_agent/src/agent_factory.py pydantic_agent/tests/test_agui_emitter.py
git commit -m "feat(pydantic-ai): AG-UI emitter + agent factory"
```

---

### Task C4: Run handler and entry point

**Files:**
- Create: `pydantic_agent/src/run_handler.py`
- Create: `pydantic_agent/src/main.py`

- [ ] **Step 1: Write run_handler.py**

```python
# pydantic_agent/src/run_handler.py
from __future__ import annotations
import asyncio
import json
import logging
import uuid
from typing import AsyncGenerator

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from pydantic_ai.messages import (
    TextPart, ToolCallPart, ToolReturnPart, ModelRequest, ModelResponse,
)

from .agent_factory import build_agent
from .agui_emitter import AGUIEmitter
from .config import get_config
from .models import BffDeps

logger = logging.getLogger(__name__)
router = APIRouter()


def _sse(event: dict) -> str:
    return f"data: {json.dumps(event)}\n\n"


@router.post("/run")
async def agent_run(request: Request) -> StreamingResponse:
    body = await request.json()
    thread_id: str = body.get("threadId", f"t_{uuid.uuid4().hex[:8]}")
    run_id: str = body.get("runId", f"r_{uuid.uuid4().hex[:8]}")
    messages: list = body.get("messages", [])
    tool_schemas: list = body.get("tools", [])
    ctx: dict = body.get("context", {})

    cfg = get_config()
    session_id = ctx.get("sessionId", "")
    model = ctx.get("model") or cfg.model
    bff_tool_url = ctx.get("bffToolUrl") or cfg.bff_tool_url

    return StreamingResponse(
        _stream(run_id, thread_id, messages, tool_schemas, model, bff_tool_url, session_id, cfg.bff_internal_secret),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


async def _stream(
    run_id: str, thread_id: str, messages: list, tool_schemas: list,
    model: str, bff_tool_url: str, session_id: str, bff_secret: str,
) -> AsyncGenerator[str, None]:
    queue: asyncio.Queue = asyncio.Queue()

    async def sink(event: dict) -> None:
        await queue.put(event)

    emitter = AGUIEmitter(run_id=run_id, thread_id=thread_id, sink=sink)

    async def run_agent() -> None:
        async with httpx.AsyncClient(timeout=30.0) as client:
            deps = BffDeps(
                http_client=client,
                bff_tool_url=bff_tool_url,
                bff_internal_secret=bff_secret,
                session_id=session_id,
            )
            try:
                await emitter.on_run_start()
                agent = build_agent(tool_schemas, model)
                user_input = next(
                    (m["content"] for m in reversed(messages) if m.get("role") == "user"),
                    "",
                )
                async with agent.run_stream(user_input, deps=deps) as result:
                    async for message in result.stream():
                        if isinstance(message, str):
                            if not emitter._current_message_id:
                                await emitter.on_llm_start()
                            await emitter.on_llm_token(message)
                    await emitter.on_llm_end()
                await emitter.on_run_end()
            except Exception as exc:
                logger.exception("[pydantic-ai] run error run=%s", run_id)
                await emitter.on_error(exc)
            finally:
                await queue.put(None)

    task = asyncio.create_task(run_agent())
    try:
        while True:
            item = await queue.get()
            if item is None:
                break
            yield _sse(item)
    finally:
        task.cancel()
```

- [ ] **Step 2: Write main.py**

```python
# pydantic_agent/src/main.py
import logging
import uvicorn
from fastapi import FastAPI
from .run_handler import router
from .config import get_config

logging.basicConfig(level=logging.INFO)
app = FastAPI(title="Pydantic AI Agent", docs_url=None, redoc_url=None)
app.include_router(router)

if __name__ == "__main__":
    cfg = get_config()
    uvicorn.run("src.main:app", host=cfg.host, port=cfg.port, log_level="info")
```

- [ ] **Step 3: Smoke test**

```bash
cd pydantic_agent && source .venv/bin/activate
python -m src.main &
sleep 2
curl -s -X POST http://127.0.0.1:8893/run \
  -H "Content-Type: application/json" \
  -d '{"threadId":"t1","runId":"r1","messages":[{"role":"user","content":"hello"}],"tools":[],"context":{"model":"openai:gpt-4o","sessionId":"test"}}' \
  --no-buffer | head -3
kill %1
```

Expected: SSE with `RUN_STARTED` and `RUN_FINISHED`.

- [ ] **Step 4: Commit**

```bash
git add pydantic_agent/src/run_handler.py pydantic_agent/src/main.py
git commit -m "feat(pydantic-ai): POST /run SSE handler and FastAPI entry point"
```

---

## Part D — BFF Framework Routing

### Task D1: Add llm_framework config key and port routing to agentRun.js

This is a **small, targeted change** to `demo_api_server/routes/agentRun.js`. Add a second target resolver alongside `getAgentServiceTarget()` that reads `llm_framework` from configStore and returns the correct port.

**Files:**
- Modify: `demo_api_server/routes/agentRun.js`
- Create: `demo_api_server/tests/agentRun.framework-routing.test.js`

- [ ] **Step 1: Write failing test first**

```javascript
// demo_api_server/tests/agentRun.framework-routing.test.js
'use strict';

jest.mock('../services/configStore', () => ({
  getEffective: jest.fn(),
}));

const configStore = require('../services/configStore');
const { resolveAgentTarget } = require('../routes/agentRun');

describe('resolveAgentTarget', () => {
  it('returns port 8889 for langchain (default)', () => {
    configStore.getEffective.mockReturnValue('langchain');
    expect(resolveAgentTarget().port).toBe(8889);
  });

  it('returns port 8891 for openai_agents', () => {
    configStore.getEffective.mockReturnValue('openai_agents');
    expect(resolveAgentTarget().port).toBe(8891);
  });

  it('returns port 8892 for mastra', () => {
    configStore.getEffective.mockReturnValue('mastra');
    expect(resolveAgentTarget().port).toBe(8892);
  });

  it('returns port 8893 for pydantic_ai', () => {
    configStore.getEffective.mockReturnValue('pydantic_ai');
    expect(resolveAgentTarget().port).toBe(8893);
  });

  it('falls back to port 8889 for unknown values', () => {
    configStore.getEffective.mockReturnValue('unknown');
    expect(resolveAgentTarget().port).toBe(8889);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd demo_api_server
npx jest tests/agentRun.framework-routing.test.js --no-coverage
```

Expected: `TypeError: resolveAgentTarget is not a function` (it doesn't exist yet).

- [ ] **Step 3: Add resolveAgentTarget to agentRun.js**

In `demo_api_server/routes/agentRun.js`, add after the existing `getAgentServiceTarget()` function:

```javascript
/**
 * Resolve agent service target based on llm_framework configStore key.
 * New frameworks register their port here.
 */
function resolveAgentTarget() {
  const framework = configStore.getEffective('llm_framework') || 'langchain';
  const FRAMEWORK_PORTS = {
    langchain:     8889,  // existing langchain_agent/ service (chat WS :8889, AG-UI POST /run on same process)
    openai_agents: 8891,
    mastra:        8892,
    pydantic_ai:   8893,
  };
  const port = FRAMEWORK_PORTS[framework] ?? 8889;
  return {
    hostname: process.env.AGENT_SERVICE_HOST || '127.0.0.1',
    port,
  };
}

module.exports.resolveAgentTarget = resolveAgentTarget;
```

Then replace the `getAgentServiceTarget()` call in the route handler body (around Step E, where `hostname` and `port` are destructured) with `resolveAgentTarget()`.

- [ ] **Step 4: Run tests**

```bash
npx jest tests/agentRun.framework-routing.test.js --no-coverage
```

Expected: 5 passed.

- [ ] **Step 5: Add llm_framework to configStore FIELD_DEFS**

In `demo_api_server/services/configStore.js`, in the `FIELD_DEFS` object, add:

```javascript
llm_framework: { public: true, default: 'langchain' }, // agent framework: langchain | openai_agents | mastra | pydantic_ai
```

- [ ] **Step 6: Run full API server test suite**

```bash
npm run test:api-server
```

Expected: all previously-passing tests still pass.

- [ ] **Step 7: Commit**

```bash
git add demo_api_server/routes/agentRun.js demo_api_server/services/configStore.js demo_api_server/tests/agentRun.framework-routing.test.js
git commit -m "feat(bff): llm_framework config key routes agent runs to openai_agents/mastra/pydantic_ai ports"
```

---

## Completion Checklist

Before marking this plan done, verify:

- [ ] `openai_agent/` — `python -m pytest` all green
- [ ] `mastra_agent/` — `npm test` all green
- [ ] `pydantic_agent/` — `python -m pytest` all green
- [ ] `demo_api_server/` — `npm run test:api-server` all green
- [ ] `demo_api_ui/` — `npm run build` exits 0 (unchanged, just verify)
- [ ] `./run.sh status` shows all services healthy
- [ ] Switching `llm_framework` to `openai_agents` in `/config` UI and sending a chat message produces a response with token chain events
- [ ] `REGRESSION_PLAN.md §4` updated with a bug fix entry if any regressions were found during implementation
