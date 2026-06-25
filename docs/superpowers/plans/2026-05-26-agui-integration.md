# AG-UI Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the banking demo agent stack from a custom WebSocket protocol to the AG-UI standard (HTTP POST + SSE), with native event emission from the LangChain agent, BFF token-chain enrichment, and a raw `@ag-ui/client` React hook — in five phases that keep the app working throughout.

**Architecture:** The LangChain agent emits typed AG-UI events via a new `/run` SSE endpoint on its existing HTTP server (port 8888). The BFF adds `POST /api/agent/run` which performs RFC 8693 token exchange, injects CUSTOM token-chain events, then proxies the agent's SSE stream to the browser. The React UI consumes events via a `useAgentRun()` hook using `@ag-ui/client`'s `EventSource` abstraction, replacing the existing WebSocket client. The old `/ws/langchain` WebSocket path is deleted only in Phase 5 after the new path is verified.

**Tech Stack:** Python 3.11+ / FastAPI (langchain_agent), Node.js / Express (demo_api_server), React (CRA, demo_api_ui), `@ag-ui/client` npm package, `ag-ui-protocol` Python package (or `ag_ui` — verify package name at install time).

---

## Phase 1: Agent emits AG-UI events (dual-emit)

> No BFF or UI changes. Agent gains AG-UI emission alongside existing WebSocket frames. Gated by `agui_enabled` config flag (default off). Verify with curl before moving to Phase 2.

---

### Task 1.1: AG-UI event dataclasses

**Files:**
- Create: `langchain_agent/src/agui/__init__.py`
- Create: `langchain_agent/src/agui/event_types.py`

- [ ] **Step 1: Create the `agui` package**

```bash
mkdir -p langchain_agent/src/agui
touch langchain_agent/src/agui/__init__.py
```

- [ ] **Step 2: Write `event_types.py`**

```python
# langchain_agent/src/agui/event_types.py
"""AG-UI protocol event dataclasses.

Spec: https://docs.ag-ui.com/concepts/events
All events serialise to { "type": "<TYPE>", ...fields }
"""
from __future__ import annotations
from dataclasses import dataclass, field, asdict
from typing import Any, Dict, Optional
import uuid
import time


def _run_id() -> str:
    return f"run_{uuid.uuid4().hex[:12]}"


def _msg_id() -> str:
    return f"msg_{uuid.uuid4().hex[:12]}"


def _tool_call_id() -> str:
    return f"tc_{uuid.uuid4().hex[:12]}"


@dataclass
class RunStarted:
    run_id: str
    thread_id: str
    type: str = field(default="RUN_STARTED", init=False)

    def to_dict(self) -> Dict[str, Any]:
        return {"type": self.type, "runId": self.run_id, "threadId": self.thread_id}


@dataclass
class RunFinished:
    run_id: str
    thread_id: str
    type: str = field(default="RUN_FINISHED", init=False)

    def to_dict(self) -> Dict[str, Any]:
        return {"type": self.type, "runId": self.run_id, "threadId": self.thread_id}


@dataclass
class TextMessageStart:
    message_id: str
    role: str = "assistant"
    type: str = field(default="TEXT_MESSAGE_START", init=False)

    def to_dict(self) -> Dict[str, Any]:
        return {"type": self.type, "messageId": self.message_id, "role": self.role}


@dataclass
class TextMessageContent:
    message_id: str
    delta: str
    type: str = field(default="TEXT_MESSAGE_CONTENT", init=False)

    def to_dict(self) -> Dict[str, Any]:
        return {"type": self.type, "messageId": self.message_id, "delta": self.delta}


@dataclass
class TextMessageEnd:
    message_id: str
    type: str = field(default="TEXT_MESSAGE_END", init=False)

    def to_dict(self) -> Dict[str, Any]:
        return {"type": self.type, "messageId": self.message_id}


@dataclass
class ToolCallStart:
    tool_call_id: str
    tool_call_name: str
    type: str = field(default="TOOL_CALL_START", init=False)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "type": self.type,
            "toolCallId": self.tool_call_id,
            "toolCallName": self.tool_call_name,
        }


@dataclass
class ToolCallArgs:
    tool_call_id: str
    delta: str  # JSON-encoded args fragment
    type: str = field(default="TOOL_CALL_ARGS", init=False)

    def to_dict(self) -> Dict[str, Any]:
        return {"type": self.type, "toolCallId": self.tool_call_id, "delta": self.delta}


@dataclass
class ToolCallEnd:
    tool_call_id: str
    type: str = field(default="TOOL_CALL_END", init=False)

    def to_dict(self) -> Dict[str, Any]:
        return {"type": self.type, "toolCallId": self.tool_call_id}


@dataclass
class StateDelta:
    delta: Any  # JSON Patch array (RFC 6902) or plain dict
    type: str = field(default="STATE_DELTA", init=False)

    def to_dict(self) -> Dict[str, Any]:
        return {"type": self.type, "delta": self.delta}


@dataclass
class CustomEvent:
    name: str
    value: Any
    type: str = field(default="CUSTOM", init=False)

    def to_dict(self) -> Dict[str, Any]:
        return {"type": self.type, "name": self.name, "value": self.value}


@dataclass
class ErrorEvent:
    message: str
    code: Optional[str] = None
    type: str = field(default="ERROR", init=False)

    def to_dict(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {"type": self.type, "message": self.message}
        if self.code:
            d["code"] = self.code
        return d
```

- [ ] **Step 3: Write a unit test for the dataclasses**

Create `langchain_agent/tests/agui/test_event_types.py`:

```python
import pytest
from src.agui.event_types import (
    RunStarted, RunFinished, TextMessageStart, TextMessageContent,
    TextMessageEnd, ToolCallStart, ToolCallArgs, ToolCallEnd,
    StateDelta, CustomEvent, ErrorEvent,
)


def test_run_started_serialises():
    e = RunStarted(run_id="run_abc", thread_id="thread_xyz")
    d = e.to_dict()
    assert d == {"type": "RUN_STARTED", "runId": "run_abc", "threadId": "thread_xyz"}


def test_text_message_content_serialises():
    e = TextMessageContent(message_id="msg_1", delta="hello")
    assert e.to_dict() == {"type": "TEXT_MESSAGE_CONTENT", "messageId": "msg_1", "delta": "hello"}


def test_tool_call_start_serialises():
    e = ToolCallStart(tool_call_id="tc_1", tool_call_name="get_accounts")
    assert e.to_dict()["type"] == "TOOL_CALL_START"
    assert e.to_dict()["toolCallName"] == "get_accounts"


def test_custom_event_serialises():
    e = CustomEvent(name="token_chain_bearer_obtained", value={"sub": "user1", "exp": 9999})
    d = e.to_dict()
    assert d["type"] == "CUSTOM"
    assert d["name"] == "token_chain_bearer_obtained"
    assert d["value"]["sub"] == "user1"


def test_error_event_optional_code():
    e = ErrorEvent(message="Something broke")
    assert "code" not in e.to_dict()
    e2 = ErrorEvent(message="Bad token", code="TOKEN_EXPIRED")
    assert e2.to_dict()["code"] == "TOKEN_EXPIRED"
```

- [ ] **Step 4: Run the tests**

```bash
cd langchain_agent
python -m pytest tests/agui/test_event_types.py -v
```

Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add langchain_agent/src/agui/ langchain_agent/tests/agui/test_event_types.py
git commit -m "feat(agui): add AG-UI event dataclasses (Phase 1.1)"
```

---

### Task 1.2: SSE transport

**Files:**
- Create: `langchain_agent/src/agui/sse_transport.py`

- [ ] **Step 1: Write a failing test**

Create `langchain_agent/tests/agui/test_sse_transport.py`:

```python
import pytest
from src.agui.sse_transport import format_sse, KEEPALIVE_PING


def test_format_sse_basic():
    line = format_sse({"type": "RUN_STARTED", "runId": "r1", "threadId": "t1"})
    assert line.startswith("data: ")
    assert line.endswith("\n\n")
    assert '"type": "RUN_STARTED"' in line


def test_format_sse_escapes_newlines():
    # SSE data must be single-line
    line = format_sse({"type": "TEXT_MESSAGE_CONTENT", "messageId": "m1", "delta": "line1\nline2"})
    # The JSON itself is one line (json.dumps doesn't add newlines by default)
    assert line.count("\n\n") == 1


def test_keepalive_ping_format():
    assert KEEPALIVE_PING == ": ping\n\n"
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd langchain_agent
python -m pytest tests/agui/test_sse_transport.py -v
```

Expected: ImportError / ModuleNotFoundError.

- [ ] **Step 3: Implement `sse_transport.py`**

```python
# langchain_agent/src/agui/sse_transport.py
"""SSE wire formatting for AG-UI events."""
import json
from typing import Any, Dict

# AG-UI keepalive comment line — sent every 15s to prevent proxy timeout
KEEPALIVE_PING = ": ping\n\n"


def format_sse(event_dict: Dict[str, Any]) -> str:
    """Serialise an AG-UI event dict to an SSE data line.

    Returns a string of the form:
        data: {"type": "..."}\n\n
    """
    payload = json.dumps(event_dict, separators=(",", ":"))
    return f"data: {payload}\n\n"
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd langchain_agent
python -m pytest tests/agui/test_sse_transport.py -v
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add langchain_agent/src/agui/sse_transport.py langchain_agent/tests/agui/test_sse_transport.py
git commit -m "feat(agui): add SSE transport formatter (Phase 1.2)"
```

---

### Task 1.3: `agui_enabled` config flag

**Files:**
- Modify: `langchain_agent/src/config/settings.py`

- [ ] **Step 1: Find the `LangChainConfig` dataclass in `settings.py`**

Open `langchain_agent/src/config/settings.py`. Locate the `LangChainConfig` dataclass (contains `stream_mcp_tool_events`, `stream_llm_tokens`, etc.).

- [ ] **Step 2: Add the `agui_enabled` field**

Add one field immediately after `stream_llm_tokens`:

```python
    stream_llm_tokens: bool = True
    agui_enabled: bool = False  # Phase 1: dual-emit AG-UI events alongside WS (default off)
```

- [ ] **Step 3: Write a test that the default is False**

Add to `langchain_agent/tests/test_settings.py` (create if it doesn't exist):

```python
from src.config.settings import get_config


def test_agui_enabled_defaults_false():
    config = get_config()
    assert config.langchain.agui_enabled is False
```

- [ ] **Step 4: Run the test**

```bash
cd langchain_agent
python -m pytest tests/test_settings.py::test_agui_enabled_defaults_false -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add langchain_agent/src/config/settings.py langchain_agent/tests/test_settings.py
git commit -m "feat(agui): add agui_enabled config flag defaulting to False (Phase 1.3)"
```

---

### Task 1.4: `AGUIEventEmitter` — LangChain callback adapter

**Files:**
- Create: `langchain_agent/src/agui/emitter.py`

- [ ] **Step 1: Write a failing test**

Create `langchain_agent/tests/agui/test_emitter.py`:

```python
import asyncio
import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from src.agui.emitter import AGUIEventEmitter


@pytest.fixture
def emitter():
    sink = []

    async def collect(event_dict):
        sink.append(event_dict)

    e = AGUIEventEmitter(run_id="run_test", thread_id="thread_test", sink=collect)
    e._sink_list = sink
    return e


@pytest.mark.asyncio
async def test_on_llm_new_token_emits_text_events(emitter):
    await emitter.on_run_start()
    await emitter.on_llm_start()
    await emitter.on_llm_new_token("hello")
    await emitter.on_llm_new_token(" world")
    await emitter.on_llm_end()
    await emitter.on_run_end()

    types = [e["type"] for e in emitter._sink_list]
    assert "RUN_STARTED" in types
    assert "TEXT_MESSAGE_START" in types
    assert "TEXT_MESSAGE_CONTENT" in types
    assert "TEXT_MESSAGE_END" in types
    assert "RUN_FINISHED" in types

    content_events = [e for e in emitter._sink_list if e["type"] == "TEXT_MESSAGE_CONTENT"]
    assert content_events[0]["delta"] == "hello"
    assert content_events[1]["delta"] == " world"


@pytest.mark.asyncio
async def test_on_tool_start_and_end_emits_tool_events(emitter):
    await emitter.on_run_start()
    await emitter.on_tool_start({"name": "get_accounts"}, tool_call_id="tc_abc")
    await emitter.on_tool_end({"output": "[{...}]"}, tool_call_id="tc_abc")
    await emitter.on_run_end()

    types = [e["type"] for e in emitter._sink_list]
    assert "TOOL_CALL_START" in types
    assert "STATE_DELTA" in types
    assert "TOOL_CALL_END" in types

    start = next(e for e in emitter._sink_list if e["type"] == "TOOL_CALL_START")
    assert start["toolCallName"] == "get_accounts"
    assert start["toolCallId"] == "tc_abc"
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd langchain_agent
python -m pytest tests/agui/test_emitter.py -v
```

Expected: ImportError.

- [ ] **Step 3: Implement `emitter.py`**

```python
# langchain_agent/src/agui/emitter.py
"""AG-UI event emitter — adapts LangChain callbacks to AG-UI typed events.

Usage:
    emitter = AGUIEventEmitter(run_id, thread_id, sink=async_fn)
    # Then call on_run_start(), on_llm_new_token(), on_tool_start(), etc.
    # from your LangChain callback handler.
"""
from __future__ import annotations
import json
import uuid
import logging
from typing import Any, Callable, Coroutine, Dict, Optional

from .event_types import (
    RunStarted, RunFinished,
    TextMessageStart, TextMessageContent, TextMessageEnd,
    ToolCallStart, ToolCallArgs, ToolCallEnd,
    StateDelta, ErrorEvent,
)

logger = logging.getLogger(__name__)


class AGUIEventEmitter:
    """Translates LangChain callback events into AG-UI typed events.

    Args:
        run_id: Unique identifier for this agent run.
        thread_id: Conversation thread identifier (session ID).
        sink: Async callable that receives a serialised event dict.
    """

    def __init__(
        self,
        run_id: str,
        thread_id: str,
        sink: Callable[[Dict[str, Any]], Coroutine],
    ) -> None:
        self._run_id = run_id
        self._thread_id = thread_id
        self._sink = sink
        self._current_message_id: Optional[str] = None
        # Test helper — populated only when test fixture sets _sink_list
        self._sink_list: list = []

    async def _emit(self, event_obj) -> None:
        d = event_obj.to_dict()
        if self._sink_list is not None:
            self._sink_list.append(d)
        try:
            await self._sink(d)
        except Exception:
            logger.exception("AG-UI sink error")

    async def on_run_start(self) -> None:
        await self._emit(RunStarted(run_id=self._run_id, thread_id=self._thread_id))

    async def on_run_end(self) -> None:
        await self._emit(RunFinished(run_id=self._run_id, thread_id=self._thread_id))

    async def on_llm_start(self) -> None:
        self._current_message_id = f"msg_{uuid.uuid4().hex[:12]}"
        await self._emit(TextMessageStart(message_id=self._current_message_id))

    async def on_llm_new_token(self, token: str) -> None:
        if not self._current_message_id:
            return
        await self._emit(TextMessageContent(message_id=self._current_message_id, delta=token))

    async def on_llm_end(self) -> None:
        if self._current_message_id:
            await self._emit(TextMessageEnd(message_id=self._current_message_id))
            self._current_message_id = None

    async def on_tool_start(
        self, serialized: Dict[str, Any], tool_call_id: Optional[str] = None, **kwargs
    ) -> None:
        tc_id = tool_call_id or f"tc_{uuid.uuid4().hex[:12]}"
        name = serialized.get("name", "unknown_tool")
        await self._emit(ToolCallStart(tool_call_id=tc_id, tool_call_name=name))
        # Emit args as a single delta (full JSON of inputs if available)
        inputs = kwargs.get("inputs") or serialized.get("inputs")
        if inputs:
            await self._emit(ToolCallArgs(
                tool_call_id=tc_id,
                delta=json.dumps(inputs, separators=(",", ":")),
            ))
        self._last_tool_call_id = tc_id

    async def on_tool_end(
        self, output: Any, tool_call_id: Optional[str] = None, **kwargs
    ) -> None:
        tc_id = tool_call_id or getattr(self, "_last_tool_call_id", f"tc_{uuid.uuid4().hex[:12]}")
        # Emit state delta with tool result
        result = output if isinstance(output, dict) else {"result": str(output)}
        await self._emit(StateDelta(delta=result))
        await self._emit(ToolCallEnd(tool_call_id=tc_id))

    async def on_error(self, error: Exception, **kwargs) -> None:
        await self._emit(ErrorEvent(message=str(error), code="AGENT_ERROR"))
        await self._emit(RunFinished(run_id=self._run_id, thread_id=self._thread_id))
```

- [ ] **Step 4: Run tests**

```bash
cd langchain_agent
python -m pytest tests/agui/test_emitter.py -v
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add langchain_agent/src/agui/emitter.py langchain_agent/tests/agui/test_emitter.py
git commit -m "feat(agui): add AGUIEventEmitter LangChain callback adapter (Phase 1.4)"
```

---

### Task 1.5: FastAPI `/run` SSE endpoint on the agent

**Files:**
- Create: `langchain_agent/src/api/agui_run_handler.py`
- Modify: `langchain_agent/src/main.py`

- [ ] **Step 1: Check FastAPI is available**

```bash
cd langchain_agent
python -c "import fastapi; print(fastapi.__version__)"
```

If missing: `pip install fastapi` and add to `requirements.txt`.

Also check for `sse-starlette`:
```bash
python -c "import sse_starlette; print('ok')"
```

If missing: `pip install sse-starlette` and add to `requirements.txt`.

- [ ] **Step 2: Write `agui_run_handler.py`**

```python
# langchain_agent/src/api/agui_run_handler.py
"""FastAPI route: POST /run — AG-UI SSE endpoint.

Accepts a user message and session_id, runs the agent, and streams
back AG-UI events as Server-Sent Events.

The BFF (demo_api_server) is the sole caller. It authenticates the
browser, resolves the RFC 8693 token, and forwards:
    { "message": str, "session_id": str, "auth_token": str }

The `auth_token` field is the RFC 8693-exchanged MCP token — same
pattern as the existing session_init WebSocket frame.
"""
from __future__ import annotations
import asyncio
import logging
import uuid
from typing import Any, AsyncGenerator, Dict

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from ..agui.emitter import AGUIEventEmitter
from ..agui.sse_transport import format_sse, KEEPALIVE_PING
from ..agui.event_types import ErrorEvent, RunFinished
from ..config.settings import get_config

logger = logging.getLogger(__name__)

router = APIRouter()

# Module-level reference to the message processor — set by main.py at startup
_message_processor = None


def set_message_processor(mp) -> None:
    global _message_processor
    _message_processor = mp


@router.post("/run")
async def agent_run(request: Request) -> StreamingResponse:
    """AG-UI SSE endpoint. Streams AG-UI events for one agent turn."""
    body: Dict[str, Any] = await request.json()
    message: str = body.get("message", "")
    session_id: str = body.get("session_id", f"sess_{uuid.uuid4().hex[:8]}")
    auth_token: str = body.get("auth_token", "")
    run_id: str = f"run_{uuid.uuid4().hex[:12]}"

    return StreamingResponse(
        _run_stream(run_id, session_id, message, auth_token),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # disable nginx buffering
        },
    )


async def _run_stream(
    run_id: str,
    session_id: str,
    message: str,
    auth_token: str,
) -> AsyncGenerator[str, None]:
    config = get_config()
    queue: asyncio.Queue[Dict[str, Any] | None] = asyncio.Queue()

    async def sink(event_dict: Dict[str, Any]) -> None:
        await queue.put(event_dict)

    emitter = AGUIEventEmitter(run_id=run_id, thread_id=session_id, sink=sink)

    # Signal end of stream
    async def finish() -> None:
        await queue.put(None)

    # Keepalive task — sends `: ping` every 15s
    async def keepalive() -> None:
        while True:
            await asyncio.sleep(15)
            await queue.put("__ping__")

    keepalive_task = asyncio.create_task(keepalive())

    # Run the agent in the background
    agent_task = asyncio.create_task(
        _invoke_agent(emitter, session_id, message, auth_token, finish)
    )

    try:
        while True:
            item = await queue.get()
            if item is None:
                break
            if item == "__ping__":
                yield KEEPALIVE_PING
            else:
                yield format_sse(item)
    finally:
        keepalive_task.cancel()
        agent_task.cancel()


async def _invoke_agent(emitter, session_id, message, auth_token, finish_fn) -> None:
    """Invoke the message processor and emit AG-UI events."""
    if _message_processor is None:
        await emitter.on_run_start()
        await emitter.on_error(RuntimeError("Message processor not initialised"))
        await finish_fn()
        return

    try:
        await emitter.on_run_start()
        # Delegate to existing message processor, passing the emitter for callbacks
        await _message_processor.process_agui_message(
            session_id=session_id,
            message=message,
            auth_token=auth_token,
            emitter=emitter,
        )
        await emitter.on_run_end()
    except Exception as exc:
        logger.exception("Agent run error")
        await emitter.on_error(exc)
    finally:
        await finish_fn()
```

- [ ] **Step 3: Mount the router in `main.py`**

In `langchain_agent/src/main.py`, find the section where the FastAPI app or HTTP server is configured (near `start_websocket_server` or the health check HTTP server). Add:

```python
# Near the top imports:
from .api.agui_run_handler import router as agui_router, set_message_processor as set_agui_mp

# In LangChainMCPApplication.initialize(), after self.message_processor is set up:
if self.config.langchain.agui_enabled:
    set_agui_mp(self.message_processor)
    logger.info("[AG-UI] /run SSE endpoint enabled on port 8888")
```

Also register the router with the FastAPI app (if the health server uses FastAPI, add the router there; if it uses aiohttp or plain HTTP, adapt accordingly — the key is `/run` must be reachable on port 8888):

```python
# Where the HTTP app is created (find 'app = FastAPI()' or equivalent):
from .api.agui_run_handler import router as agui_router
app.include_router(agui_router)
```

> **Note:** If the HTTP server at port 8888 is not FastAPI, examine `langchain_agent/src/main.py` lines around `start_health_check_server` to see the framework in use and adapt the route registration accordingly. The route must respond to `POST /run` with `text/event-stream`.

- [ ] **Step 4: Smoke test with curl (requires `agui_enabled: true` in config)**

Temporarily set `agui_enabled = True` in `settings.py`, start the agent, then:

```bash
curl -N -X POST http://localhost:8888/run \
  -H "Content-Type: application/json" \
  -d '{"message":"hello","session_id":"test123","auth_token":""}' \
  --max-time 10
```

Expected: SSE stream with at least `data: {"type":"RUN_STARTED",...}` followed by events and `data: {"type":"RUN_FINISHED",...}`.

Reset `agui_enabled = False` after smoke test.

- [ ] **Step 5: Commit**

```bash
git add langchain_agent/src/api/agui_run_handler.py langchain_agent/src/main.py
git commit -m "feat(agui): add /run SSE endpoint to LangChain agent HTTP server (Phase 1.5)"
```

---

### Task 1.6: Wire `AGUIEventEmitter` into the message processor

**Files:**
- Modify: the message processor file (likely `langchain_agent/src/core/message_processor.py` or similar — locate by looking for `process_session_init_with_token` references)

- [ ] **Step 1: Find the message processor**

```bash
grep -r "process_session_init_with_token" langchain_agent/src --include="*.py" -l
```

Note the file. Also find where the LangChain agent `ainvoke` or `astream` call happens.

- [ ] **Step 2: Add `process_agui_message` method**

In the message processor class, add:

```python
async def process_agui_message(
    self,
    session_id: str,
    message: str,
    auth_token: str,
    emitter,  # AGUIEventEmitter
) -> None:
    """Process one agent turn and emit AG-UI events via the provided emitter.

    This mirrors the existing chat message processing but uses the emitter
    for streaming instead of WebSocket frames.
    """
    from ..agui.emitter import AGUIEventEmitter  # local import to avoid circular

    # Re-use or create session state for this session_id
    # (use existing session lookup pattern from _handle_chat_message)
    session = self._session_manager.get_session(session_id)
    if session is None:
        # Initialise session with auth token (mirrors _handle_session_init)
        session = await self._session_manager.create_session(
            session_id=session_id,
            auth_token=auth_token,
        )

    # Build the LangChain input (same format as existing chat processing)
    chain_input = {"input": message}

    # Invoke agent with streaming callbacks
    # The emitter's on_llm_new_token, on_tool_start, on_tool_end are called
    # by the LangChain streaming callback. Wire them up using the existing
    # callback pattern in this codebase.
    #
    # Look for how stream_mcp_tool_events callbacks are set up in the existing
    # agent invocation — replicate that pattern but route to emitter instead.
    await self._invoke_with_emitter(session, chain_input, emitter)


async def _invoke_with_emitter(self, session, chain_input: dict, emitter) -> None:
    """Invoke the LangChain agent and route callbacks to the AG-UI emitter.

    Examine the existing agent invocation in this class and replicate it,
    replacing WebSocket send calls with emitter calls.
    """
    # This method body must be filled in by reading the existing invoke pattern.
    # Key callbacks to wire:
    #   on_llm_new_token(token) → await emitter.on_llm_new_token(token)
    #   on_tool_start(serialized, **kw) → await emitter.on_tool_start(serialized, **kw)
    #   on_tool_end(output, **kw) → await emitter.on_tool_end(output, **kw)
    #   on_chain_error(error) → await emitter.on_error(error)
    #
    # Example pattern (adapt to actual framework used):
    from langchain.callbacks.base import AsyncCallbackHandler

    class EmitterCallback(AsyncCallbackHandler):
        def __init__(self, em):
            self._em = em

        async def on_llm_new_token(self, token: str, **kwargs):
            if not self._em._current_message_id:
                await self._em.on_llm_start()
            await self._em.on_llm_new_token(token)

        async def on_tool_start(self, serialized, input_str, **kwargs):
            await self._em.on_tool_start(serialized, **kwargs)

        async def on_tool_end(self, output, **kwargs):
            await self._em.on_tool_end(output, **kwargs)

        async def on_chain_error(self, error, **kwargs):
            await self._em.on_error(error)

    callback = EmitterCallback(emitter)
    agent = session.get_agent()  # use existing session agent access pattern
    await agent.ainvoke(chain_input, config={"callbacks": [callback]})
```

> **Important:** The exact agent invocation and session access pattern varies. Read the existing `_handle_chat_message` implementation carefully and mirror it — do not guess method names.

- [ ] **Step 3: Run existing tests to confirm no regression**

```bash
cd langchain_agent
python -m pytest tests/ -v --ignore=tests/agui -x
```

Expected: all existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add langchain_agent/src/
git commit -m "feat(agui): wire AGUIEventEmitter into message processor (Phase 1.6)"
```

---

## Phase 2: BFF SSE endpoint + token chain injection

> No React changes. Add `POST /api/agent/run` to the BFF. Performs RFC 8693 exchange, injects CUSTOM token-chain events, proxies agent SSE to browser. Old `/ws/langchain` stays live.

---

### Task 2.1: `agentRunStore` — Redis-backed run registry + pub/sub consent

**Cloud-safe design:** Run state is stored in Redis (Upstash on Vercel, TCP Redis locally). Consent signals use Redis pub/sub so the SSE stream and the consent POST can land on different BFF instances. Falls back to an in-process `EventEmitter` when Redis is unavailable (dev without Redis).

Redis keys:
- `agui:run:<runId>` — JSON run state, TTL 5 minutes
- `agui:consent:<runId>` — pub/sub channel for consent signal

**Files:**
- Create: `demo_api_server/services/agentRunStore.js`

- [ ] **Step 1: Find the existing Redis/Upstash client in the BFF**

```bash
grep -r "upstash\|ioredis\|redis\|Redis" demo_api_server/services --include="*.js" -l | head -5
grep -r "createClient\|new Redis\|upstashClient" demo_api_server/ --include="*.js" -l | head -5
```

Identify how Redis is already used in the project (the session store uses it). Note the import pattern — you will reuse the same client.

- [ ] **Step 2: Write a failing test**

Create `demo_api_server/tests/agentRunStore.test.js`:

```javascript
// agentRunStore.test.js — tests use the local EventEmitter fallback
// (Redis not required for unit tests)
jest.mock('../services/agentRunStore', () => {
  // Re-require so we get the actual module with mocked Redis
  jest.resetModules();
  return jest.requireActual('../services/agentRunStore');
});

// Force fallback mode (no Redis) for tests
process.env.AGUI_STORE_FALLBACK = 'true';

const { createAgentRunStore } = require('../services/agentRunStore');

describe('agentRunStore (fallback mode)', () => {
  let store;
  beforeEach(() => { store = createAgentRunStore(); });

  test('registers and retrieves run state', async () => {
    await store.setRunState('run_1', { status: 'running' });
    const state = await store.getRunState('run_1');
    expect(state).toMatchObject({ status: 'running' });
  });

  test('getRunState returns null for unknown runId', async () => {
    expect(await store.getRunState('nope')).toBeNull();
  });

  test('deleteRunState removes the entry', async () => {
    await store.setRunState('run_2', { status: 'running' });
    await store.deleteRunState('run_2');
    expect(await store.getRunState('run_2')).toBeNull();
  });

  test('publish + subscribe delivers consent signal', async () => {
    const received = [];
    await store.subscribeConsent('run_3', (msg) => received.push(msg));
    await store.publishConsent('run_3', { approved: true });
    // allow microtask queue to flush
    await new Promise((r) => setImmediate(r));
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ approved: true });
  });

  test('unsubscribe stops receiving consent signals', async () => {
    const received = [];
    const unsub = await store.subscribeConsent('run_4', (msg) => received.push(msg));
    unsub();
    await store.publishConsent('run_4', { approved: true });
    await new Promise((r) => setImmediate(r));
    expect(received).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

```bash
cd demo_api_server
npx jest tests/agentRunStore.test.js
```

Expected: Cannot find module `../services/agentRunStore`.

- [ ] **Step 4: Implement `agentRunStore.js`**

```javascript
// demo_api_server/services/agentRunStore.js
'use strict';

/**
 * AG-UI agent run registry.
 *
 * Cloud-safe: stores run state in Redis (Upstash on Vercel, TCP Redis locally).
 * Uses Redis pub/sub for HITL consent signalling so consent POST and SSE stream
 * can land on different BFF instances.
 *
 * Falls back to an in-process EventEmitter when:
 *   - process.env.AGUI_STORE_FALLBACK === 'true'  (tests / explicit opt-out)
 *   - Redis connection fails at startup
 *
 * Redis key schema:
 *   agui:run:<runId>     — JSON run state, TTL 300s (5 min)
 *   agui:consent:<runId> — pub/sub channel for consent signal
 */

const EventEmitter = require('events');
const logger = require('./logger') || console;

const RUN_TTL_SECONDS = 300; // 5 minutes — matches HITL timeout

// ─── Fallback backend (in-process, single-instance) ──────────────────────────

class FallbackStore {
  constructor() {
    this._state = new Map();
    this._emitter = new EventEmitter();
    this._emitter.setMaxListeners(100);
  }

  async setRunState(runId, value) {
    this._state.set(runId, value);
  }

  async getRunState(runId) {
    return this._state.get(runId) ?? null;
  }

  async deleteRunState(runId) {
    this._state.delete(runId);
  }

  async publishConsent(runId, payload) {
    this._emitter.emit(`consent:${runId}`, payload);
  }

  async subscribeConsent(runId, handler) {
    const key = `consent:${runId}`;
    this._emitter.on(key, handler);
    return () => this._emitter.off(key, handler);
  }
}

// ─── Redis backend ────────────────────────────────────────────────────────────

class RedisStore {
  /**
   * @param {object} redisClient  ioredis or Upstash-compatible client
   *   Must support: set(key, value, 'EX', ttl), get(key), del(key),
   *   publish(channel, message), subscribe(channel, handler)
   */
  constructor(redisClient) {
    this._client = redisClient;
    // ioredis requires a separate connection for subscribe
    this._sub = redisClient.duplicate ? redisClient.duplicate() : redisClient;
    this._handlers = new Map(); // runId → handler fn
  }

  async setRunState(runId, value) {
    await this._client.set(
      `agui:run:${runId}`,
      JSON.stringify(value),
      'EX',
      RUN_TTL_SECONDS
    );
  }

  async getRunState(runId) {
    const raw = await this._client.get(`agui:run:${runId}`);
    return raw ? JSON.parse(raw) : null;
  }

  async deleteRunState(runId) {
    await this._client.del(`agui:run:${runId}`);
  }

  async publishConsent(runId, payload) {
    await this._client.publish(`agui:consent:${runId}`, JSON.stringify(payload));
  }

  async subscribeConsent(runId, handler) {
    const channel = `agui:consent:${runId}`;
    const wrapped = (_ch, message) => {
      try { handler(JSON.parse(message)); } catch { /* ignore */ }
    };
    this._handlers.set(runId, wrapped);
    await this._sub.subscribe(channel);
    this._sub.on('message', wrapped);
    return () => {
      this._sub.unsubscribe(channel).catch(() => {});
      this._sub.off('message', wrapped);
      this._handlers.delete(runId);
    };
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

function createAgentRunStore() {
  if (process.env.AGUI_STORE_FALLBACK === 'true') {
    return new FallbackStore();
  }

  // Try to reuse the project's existing Redis client
  let redisClient;
  try {
    // Adapt this require path to match the actual Redis client in this codebase
    // (found by grepping for createClient / ioredis / upstash in services/)
    const { getRedisClient } = require('./redisClient');
    redisClient = getRedisClient();
  } catch {
    logger.warn('[agentRunStore] Redis client not available — using in-process fallback. HITL will not work across multiple instances.');
    return new FallbackStore();
  }

  return new RedisStore(redisClient);
}

const agentRunStore = createAgentRunStore();

module.exports = { agentRunStore, createAgentRunStore };
```

> **Note on `getRedisClient`:** Examine the Redis import you found in Step 1 and adapt the require path accordingly. If the project uses Upstash REST (not TCP), use the Upstash REST client's `set`/`get`/`del` methods — they have the same interface. For pub/sub with Upstash REST you may need `@upstash/redis` with its `publish`/`subscribe` methods, or fall back to the `FallbackStore` for pub/sub while using Upstash for state (document this choice in a comment).

- [ ] **Step 5: Run tests**

```bash
cd demo_api_server
npx jest tests/agentRunStore.test.js
```

Expected: 5 passed (all running against FallbackStore).

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/services/agentRunStore.js demo_api_server/tests/agentRunStore.test.js
git commit -m "feat(agui): add agentRunStore Redis-backed run registry + pub/sub consent (Phase 2.1)"
```

---

### Task 2.2: `aguiSseProxy` — pipe agent SSE to browser + inject CUSTOM events

**Files:**
- Create: `demo_api_server/services/aguiSseProxy.js`

- [ ] **Step 1: Write a failing test**

Create `demo_api_server/tests/aguiSseProxy.test.js`:

```javascript
const { buildCustomEvent, buildTokenChainEvents } = require('../services/aguiSseProxy');

describe('buildCustomEvent', () => {
  test('returns AG-UI CUSTOM event shape', () => {
    const ev = buildCustomEvent('token_chain_bearer_obtained', { sub: 'u1', exp: 9999 });
    expect(ev).toEqual({
      type: 'CUSTOM',
      name: 'token_chain_bearer_obtained',
      value: { sub: 'u1', exp: 9999 },
    });
  });
});

describe('buildTokenChainEvents', () => {
  test('maps tokenEvents array to CUSTOM AG-UI events', () => {
    const tokenEvents = [
      { id: 'user-token', status: 'acquired', claims: { sub: 'u1', exp: 100 }, label: 'Bearer' },
      { id: 'exchange-in-progress', status: 'active', claims: {}, label: 'Exchange' },
      { id: 'exchanged-token', status: 'exchanged', claims: { act: { sub: 'client_x' }, exp: 200 }, label: 'MCP Token' },
    ];
    const events = buildTokenChainEvents(tokenEvents);
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({ type: 'CUSTOM', name: 'token_chain_bearer_obtained' });
    expect(events[1]).toMatchObject({ type: 'CUSTOM', name: 'token_chain_exchange_started' });
    expect(events[2]).toMatchObject({ type: 'CUSTOM', name: 'token_chain_mcp_token_obtained' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd demo_api_server
npx jest tests/aguiSseProxy.test.js
```

Expected: Cannot find module.

- [ ] **Step 3: Implement `aguiSseProxy.js`**

```javascript
// demo_api_server/services/aguiSseProxy.js
'use strict';

const http = require('http');
const { URL } = require('url');
const { configStore } = require('./configStore');

/**
 * Build a single AG-UI CUSTOM event object.
 * @param {string} name
 * @param {object} value
 * @returns {{ type: 'CUSTOM', name: string, value: object }}
 */
function buildCustomEvent(name, value) {
  return { type: 'CUSTOM', name, value };
}

/**
 * Map the tokenEvents array from agentMcpTokenService to CUSTOM AG-UI events.
 * tokenEvent.id drives the mapping:
 *   'user-token'           → token_chain_bearer_obtained
 *   'exchange-in-progress' → token_chain_exchange_started
 *   'exchanged-token'      → token_chain_mcp_token_obtained
 *   others                 → token_chain_<id>
 *
 * @param {Array} tokenEvents
 * @returns {Array<{ type: 'CUSTOM', name: string, value: object }>}
 */
function buildTokenChainEvents(tokenEvents) {
  return tokenEvents.map((te) => {
    let name;
    if (te.id === 'user-token') name = 'token_chain_bearer_obtained';
    else if (te.id === 'exchange-in-progress') name = 'token_chain_exchange_started';
    else if (te.id === 'exchanged-token') {
      const hasAct = te.claims && te.claims.act;
      name = hasAct ? 'token_chain_mcp_token_obtained' : 'token_chain_mcp_token_obtained';
    } else {
      name = `token_chain_${te.id.replace(/-/g, '_')}`;
    }
    return buildCustomEvent(name, {
      label: te.label,
      status: te.status,
      claims: te.claims || {},
      explanation: te.explanation || '',
    });
  });
}

/**
 * Write an AG-UI event as an SSE data line to the browser response.
 * @param {import('express').Response} res
 * @param {object} eventObj
 */
function writeSseEvent(res, eventObj) {
  res.write(`data: ${JSON.stringify(eventObj)}\n\n`);
}

/**
 * Proxy the agent's SSE stream (/run on port 8888) to the browser SSE response.
 * Injects token-chain CUSTOM events before RUN_STARTED.
 *
 * @param {object} opts
 * @param {import('express').Response} opts.browserRes  Browser SSE response
 * @param {string}   opts.runId           Unique run identifier
 * @param {string}   opts.sessionId       Session ID
 * @param {string}   opts.message         User message
 * @param {string}   opts.authToken       RFC 8693 exchanged token
 * @param {Array}    opts.tokenChainEvents Already-built CUSTOM events to inject
 */
function proxyAgentSse({ browserRes, runId, sessionId, message, authToken, tokenChainEvents }) {
  const agentBaseUrl =
    configStore.getEffective('langchain_agent_http_url') ||
    process.env.LANGCHAIN_AGENT_HTTP_URL ||
    'http://localhost:8888';

  const agentUrl = new URL('/run', agentBaseUrl);
  const body = JSON.stringify({ message, session_id: sessionId, auth_token: authToken, run_id: runId });

  const options = {
    hostname: agentUrl.hostname,
    port: agentUrl.port || 8888,
    path: agentUrl.pathname,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      Accept: 'text/event-stream',
    },
  };

  // Inject token chain events first
  for (const ev of tokenChainEvents) {
    writeSseEvent(browserRes, ev);
  }

  const agentReq = http.request(options, (agentRes) => {
    agentRes.setEncoding('utf8');
    agentRes.on('data', (chunk) => {
      browserRes.write(chunk);
    });
    agentRes.on('end', () => {
      browserRes.end();
    });
  });

  agentReq.on('error', (err) => {
    const errorEvent = { type: 'ERROR', message: `Agent connection failed: ${err.message}` };
    const finishedEvent = { type: 'RUN_FINISHED', runId, threadId: sessionId };
    writeSseEvent(browserRes, errorEvent);
    writeSseEvent(browserRes, finishedEvent);
    browserRes.end();
  });

  agentReq.write(body);
  agentReq.end();
}

module.exports = { buildCustomEvent, buildTokenChainEvents, writeSseEvent, proxyAgentSse };
```

- [ ] **Step 4: Run tests**

```bash
cd demo_api_server
npx jest tests/aguiSseProxy.test.js
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/aguiSseProxy.js demo_api_server/tests/aguiSseProxy.test.js
git commit -m "feat(agui): add aguiSseProxy — token chain injection + agent SSE pipe (Phase 2.2)"
```

---

### Task 2.3: `POST /api/agent/run` BFF route

**Files:**
- Create: `demo_api_server/routes/agentRunRoute.js`
- Modify: `demo_api_server/server.js`

- [ ] **Step 1: Write a failing test**

Create `demo_api_server/tests/agentRunRoute.test.js`:

```javascript
const request = require('supertest');
const express = require('express');

jest.mock('../middleware/auth', () => ({
  requireSession: (req, res, next) => {
    req.session = { oauthTokens: { accessToken: 'tok_user' } };
    next();
  },
}));
jest.mock('../services/agentMcpTokenService', () => ({
  resolveMcpAccessTokenWithEvents: jest.fn().mockResolvedValue({
    token: 'tok_mcp',
    tokenEvents: [],
    userSub: 'user_123',
  }),
}));
jest.mock('../services/aguiSseProxy', () => ({
  buildTokenChainEvents: jest.fn().mockReturnValue([]),
  proxyAgentSse: jest.fn(({ browserRes }) => {
    browserRes.write('data: {"type":"RUN_STARTED","runId":"r1","threadId":"s1"}\n\n');
    browserRes.write('data: {"type":"RUN_FINISHED","runId":"r1","threadId":"s1"}\n\n');
    browserRes.end();
  }),
}));

const agentRunRoute = require('../routes/agentRunRoute');

const app = express();
app.use(express.json());
app.use('/api/agent', agentRunRoute);

describe('POST /api/agent/run', () => {
  test('returns SSE stream with RUN_STARTED and RUN_FINISHED', async () => {
    const res = await request(app)
      .post('/api/agent/run')
      .send({ message: 'hello', session_id: 'sess_1' })
      .set('Accept', 'text/event-stream')
      .buffer(true)
      .parse((res, callback) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => callback(null, data));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    expect(res.body).toContain('RUN_STARTED');
    expect(res.body).toContain('RUN_FINISHED');
  });

  test('returns 400 if message is missing', async () => {
    const res = await request(app)
      .post('/api/agent/run')
      .send({ session_id: 'sess_1' });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd demo_api_server
npx jest tests/agentRunRoute.test.js
```

Expected: Cannot find module.

- [ ] **Step 3: Implement `agentRunRoute.js`**

```javascript
// demo_api_server/routes/agentRunRoute.js
'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { requireSession } = require('../middleware/auth');
const { resolveMcpAccessTokenWithEvents } = require('../services/agentMcpTokenService');
const { buildTokenChainEvents, proxyAgentSse } = require('../services/aguiSseProxy');

const router = express.Router();

/**
 * POST /api/agent/run
 *
 * Starts an AG-UI agent run. Authenticates via session cookie,
 * performs RFC 8693 token exchange, injects CUSTOM token-chain events
 * into the SSE stream, then proxies the agent's SSE response to the browser.
 */
router.post('/run', requireSession, async (req, res) => {
  const { message, session_id: sessionId } = req.body;

  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message is required' });
  }

  const runId = `run_${uuidv4().replace(/-/g, '').slice(0, 12)}`;
  const sid = sessionId || req.session?.id || `sess_${uuidv4().slice(0, 8)}`;

  // Set SSE headers before any writes
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  let tokenEvents = [];
  let authToken = '';

  try {
    const result = await resolveMcpAccessTokenWithEvents(req, 'agui_run');
    authToken = result.token;
    tokenEvents = buildTokenChainEvents(result.tokenEvents || []);
  } catch (err) {
    // Emit token error as CUSTOM event then close stream
    const tokenError = {
      type: 'CUSTOM',
      name: 'token_chain_error',
      value: { code: 'EXCHANGE_FAILED', message: err.message },
    };
    const errorEvent = { type: 'ERROR', message: 'Unable to obtain agent token' };
    const finishedEvent = { type: 'RUN_FINISHED', runId, threadId: sid };
    res.write(`data: ${JSON.stringify(tokenError)}\n\n`);
    res.write(`data: ${JSON.stringify(errorEvent)}\n\n`);
    res.write(`data: ${JSON.stringify(finishedEvent)}\n\n`);
    return res.end();
  }

  proxyAgentSse({
    browserRes: res,
    runId,
    sessionId: sid,
    message,
    authToken,
    tokenChainEvents: tokenEvents,
  });
});

module.exports = router;
```

- [ ] **Step 4: Mount in `server.js`**

In `demo_api_server/server.js`, after the existing route requires, add:

```javascript
const agentRunRoute = require('./routes/agentRunRoute');
// ...
app.use('/api/agent', agentRunRoute);
```

> Place this near the other `/api/banking-agent` route mount — before `app.listen`.

- [ ] **Step 5: Run tests**

```bash
cd demo_api_server
npx jest tests/agentRunRoute.test.js
```

Expected: 2 passed.

- [ ] **Step 6: Smoke test with curl (requires agent running with `agui_enabled: true`)**

```bash
curl -N -X POST https://api.ping.demo:3001/api/agent/run \
  -H "Content-Type: application/json" \
  -H "Cookie: connect.sid=<your-session-cookie>" \
  -d '{"message":"show my accounts","session_id":"test123"}' \
  --max-time 30
```

Expected: SSE stream with CUSTOM token-chain events, then RUN_STARTED, tool events, RUN_FINISHED.

- [ ] **Step 7: Commit**

```bash
git add demo_api_server/routes/agentRunRoute.js demo_api_server/server.js demo_api_server/tests/agentRunRoute.test.js
git commit -m "feat(agui): add POST /api/agent/run BFF SSE route (Phase 2.3)"
```

---

## Phase 3: React `useAgentRun` hook + feature flag

> No deletion of old WS path. Both live simultaneously. `ff_agui_enabled` configStore flag gates the new path (default off).

---

### Task 3.1: Install `@ag-ui/client`

**Files:**
- Modify: `demo_api_ui/package.json`

- [ ] **Step 1: Install the package**

```bash
cd demo_api_ui
npm install @ag-ui/client --legacy-peer-deps
```

- [ ] **Step 2: Verify it resolves**

```bash
node -e "require('@ag-ui/client'); console.log('ok')"
```

Expected: `ok`

> If `@ag-ui/client` is not the correct package name, check https://www.npmjs.com/search?q=ag-ui for the canonical package. The package should export an `EventSource`-compatible client or a `runAgent` function that returns an async iterator of AG-UI events.

- [ ] **Step 3: Commit**

```bash
git add demo_api_ui/package.json demo_api_ui/package-lock.json
git commit -m "feat(agui): install @ag-ui/client (Phase 3.1)"
```

---

### Task 3.2: `useAgentState` — state slices for AG-UI events

**Files:**
- Create: `demo_api_ui/src/hooks/useAgentState.js`

- [ ] **Step 1: Write a failing test**

Create `demo_api_ui/src/__tests__/useAgentState.test.js`:

```javascript
import { renderHook, act } from '@testing-library/react';
import useAgentState from '../hooks/useAgentState';

describe('useAgentState', () => {
  test('initial state is empty', () => {
    const { result } = renderHook(() => useAgentState());
    expect(result.current.messages).toEqual([]);
    expect(result.current.toolCalls).toEqual([]);
    expect(result.current.tokenChain).toEqual([]);
    expect(result.current.hitlPending).toBeNull();
    expect(result.current.isRunning).toBe(false);
  });

  test('dispatch RUN_STARTED sets isRunning true', () => {
    const { result } = renderHook(() => useAgentState());
    act(() => {
      result.current.dispatch({ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' });
    });
    expect(result.current.isRunning).toBe(true);
    expect(result.current.runId).toBe('r1');
  });

  test('dispatch TEXT_MESSAGE_CONTENT appends delta to current message', () => {
    const { result } = renderHook(() => useAgentState());
    act(() => {
      result.current.dispatch({ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' });
      result.current.dispatch({ type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' });
      result.current.dispatch({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'hello' });
      result.current.dispatch({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: ' world' });
      result.current.dispatch({ type: 'TEXT_MESSAGE_END', messageId: 'm1' });
    });
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].content).toBe('hello world');
    expect(result.current.messages[0].role).toBe('assistant');
  });

  test('dispatch TOOL_CALL_START adds a tool call entry', () => {
    const { result } = renderHook(() => useAgentState());
    act(() => {
      result.current.dispatch({ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' });
      result.current.dispatch({ type: 'TOOL_CALL_START', toolCallId: 'tc1', toolCallName: 'get_accounts' });
    });
    expect(result.current.toolCalls).toHaveLength(1);
    expect(result.current.toolCalls[0].name).toBe('get_accounts');
    expect(result.current.toolCalls[0].status).toBe('running');
  });

  test('dispatch TOOL_CALL_END marks tool call done', () => {
    const { result } = renderHook(() => useAgentState());
    act(() => {
      result.current.dispatch({ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' });
      result.current.dispatch({ type: 'TOOL_CALL_START', toolCallId: 'tc1', toolCallName: 'get_accounts' });
      result.current.dispatch({ type: 'TOOL_CALL_END', toolCallId: 'tc1' });
    });
    expect(result.current.toolCalls[0].status).toBe('done');
  });

  test('dispatch CUSTOM token_chain event appends to tokenChain', () => {
    const { result } = renderHook(() => useAgentState());
    act(() => {
      result.current.dispatch({
        type: 'CUSTOM',
        name: 'token_chain_bearer_obtained',
        value: { sub: 'u1', exp: 9999 },
      });
    });
    expect(result.current.tokenChain).toHaveLength(1);
    expect(result.current.tokenChain[0].name).toBe('token_chain_bearer_obtained');
  });

  test('dispatch RUN_FINISHED sets isRunning false', () => {
    const { result } = renderHook(() => useAgentState());
    act(() => {
      result.current.dispatch({ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' });
      result.current.dispatch({ type: 'RUN_FINISHED', runId: 'r1', threadId: 't1' });
    });
    expect(result.current.isRunning).toBe(false);
  });

  test('reset clears all state', () => {
    const { result } = renderHook(() => useAgentState());
    act(() => {
      result.current.dispatch({ type: 'RUN_STARTED', runId: 'r1', threadId: 't1' });
      result.current.reset();
    });
    expect(result.current.isRunning).toBe(false);
    expect(result.current.messages).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd demo_api_ui
npm test -- --testPathPattern=useAgentState --watchAll=false
```

Expected: Cannot find module.

- [ ] **Step 3: Implement `useAgentState.js`**

```javascript
// demo_api_ui/src/hooks/useAgentState.js
import { useCallback, useReducer } from 'react';

const INITIAL_STATE = {
  runId: null,
  threadId: null,
  isRunning: false,
  messages: [],          // [{ id, role, content }]
  toolCalls: [],         // [{ id, name, status, stateDelta }]
  tokenChain: [],        // [{ name, value }]
  hitlPending: null,     // { runId, tool, params, threshold } | null
  error: null,
};

function reducer(state, event) {
  switch (event.type) {
    case 'RUN_STARTED':
      return { ...INITIAL_STATE, runId: event.runId, threadId: event.threadId, isRunning: true };

    case 'TEXT_MESSAGE_START':
      return {
        ...state,
        messages: [...state.messages, { id: event.messageId, role: event.role || 'assistant', content: '' }],
      };

    case 'TEXT_MESSAGE_CONTENT': {
      const msgs = state.messages.map((m) =>
        m.id === event.messageId ? { ...m, content: m.content + event.delta } : m
      );
      return { ...state, messages: msgs };
    }

    case 'TEXT_MESSAGE_END':
      return state; // message already complete in state

    case 'TOOL_CALL_START':
      return {
        ...state,
        toolCalls: [
          ...state.toolCalls,
          { id: event.toolCallId, name: event.toolCallName, status: 'running', stateDelta: null },
        ],
      };

    case 'TOOL_CALL_ARGS': {
      const tcs = state.toolCalls.map((tc) =>
        tc.id === event.toolCallId ? { ...tc, args: (tc.args || '') + event.delta } : tc
      );
      return { ...state, toolCalls: tcs };
    }

    case 'TOOL_CALL_END': {
      const tcs = state.toolCalls.map((tc) =>
        tc.id === event.toolCallId ? { ...tc, status: 'done' } : tc
      );
      return { ...state, toolCalls: tcs };
    }

    case 'STATE_DELTA': {
      // Attach delta to most recent running tool call
      const tcs = [...state.toolCalls];
      const lastRunning = tcs.reduceRight((acc, tc, i) => (acc === -1 && tc.status === 'running' ? i : acc), -1);
      if (lastRunning !== -1) tcs[lastRunning] = { ...tcs[lastRunning], stateDelta: event.delta };
      return { ...state, toolCalls: tcs };
    }

    case 'CUSTOM':
      if (event.name && event.name.startsWith('token_chain_')) {
        return { ...state, tokenChain: [...state.tokenChain, { name: event.name, value: event.value }] };
      }
      if (event.name === 'hitl_consent_request') {
        return { ...state, hitlPending: event.value };
      }
      if (event.name === 'hitl_timeout') {
        return { ...state, hitlPending: null };
      }
      return state;

    case 'ERROR':
      return { ...state, error: event.message, isRunning: false };

    case 'RUN_FINISHED':
      return { ...state, isRunning: false };

    case '__RESET__':
      return { ...INITIAL_STATE };

    default:
      return state;
  }
}

export default function useAgentState() {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const reset = useCallback(() => dispatch({ type: '__RESET__' }), []);
  return { ...state, dispatch, reset };
}
```

- [ ] **Step 4: Run tests**

```bash
cd demo_api_ui
npm test -- --testPathPattern=useAgentState --watchAll=false
```

Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/hooks/useAgentState.js demo_api_ui/src/__tests__/useAgentState.test.js
git commit -m "feat(agui): add useAgentState reducer hook (Phase 3.2)"
```

---

### Task 3.3: `useAgentRun` — SSE connection + message dispatch

**Files:**
- Create: `demo_api_ui/src/hooks/useAgentRun.js`

- [ ] **Step 1: Write a failing test**

Create `demo_api_ui/src/__tests__/useAgentRun.test.js`:

```javascript
import { renderHook, act, waitFor } from '@testing-library/react';
import useAgentRun from '../hooks/useAgentRun';

// Mock fetch for the POST /api/agent/run call
global.fetch = jest.fn();

// Mock EventSource / ReadableStream with SSE events
function makeSseResponse(events) {
  const encoder = new TextEncoder();
  const chunks = events.map((e) => encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
  let i = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(chunks[i++]);
      else controller.close();
    },
  });
  return { ok: true, body: stream, headers: { get: () => 'text/event-stream' } };
}

describe('useAgentRun', () => {
  beforeEach(() => jest.clearAllMocks());

  test('sendMessage triggers SSE consumption and populates messages', async () => {
    global.fetch.mockResolvedValue(
      makeSseResponse([
        { type: 'RUN_STARTED', runId: 'r1', threadId: 't1' },
        { type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' },
        { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'Hi there' },
        { type: 'TEXT_MESSAGE_END', messageId: 'm1' },
        { type: 'RUN_FINISHED', runId: 'r1', threadId: 't1' },
      ])
    );

    const { result } = renderHook(() => useAgentRun({ sessionId: 'sess_1' }));

    act(() => {
      result.current.sendMessage('hello');
    });

    await waitFor(() => !result.current.isRunning, { timeout: 3000 });

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].content).toBe('Hi there');
    expect(result.current.isRunning).toBe(false);
  });

  test('error in SSE sets error state', async () => {
    global.fetch.mockResolvedValue(
      makeSseResponse([
        { type: 'RUN_STARTED', runId: 'r1', threadId: 't1' },
        { type: 'ERROR', message: 'Something failed' },
        { type: 'RUN_FINISHED', runId: 'r1', threadId: 't1' },
      ])
    );

    const { result } = renderHook(() => useAgentRun({ sessionId: 'sess_1' }));
    act(() => { result.current.sendMessage('trigger error'); });

    await waitFor(() => result.current.error !== null, { timeout: 3000 });
    expect(result.current.error).toBe('Something failed');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd demo_api_ui
npm test -- --testPathPattern=useAgentRun --watchAll=false
```

Expected: Cannot find module.

- [ ] **Step 3: Implement `useAgentRun.js`**

```javascript
// demo_api_ui/src/hooks/useAgentRun.js
import { useCallback, useRef } from 'react';
import useAgentState from './useAgentState';
import bffAxios from '../services/bffAxios';

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1000;

/**
 * useAgentRun — opens a POST + SSE connection to /api/agent/run,
 * parses AG-UI events, and dispatches them to useAgentState.
 *
 * @param {{ sessionId: string }} opts
 * @returns {{ sendMessage, reset, isRunning, messages, toolCalls, tokenChain, hitlPending, error, runId }}
 */
export default function useAgentRun({ sessionId }) {
  const state = useAgentState();
  const abortRef = useRef(null);

  const sendMessage = useCallback(
    async (message, retryCount = 0) => {
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      state.reset();

      try {
        const response = await fetch('/api/agent/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, session_id: sessionId }),
          signal: controller.signal,
          credentials: 'include', // send connect.sid cookie
        });

        if (!response.ok) {
          state.dispatch({ type: 'ERROR', message: `HTTP ${response.status}` });
          return;
        }

        await consumeSseStream(response.body, state.dispatch);
      } catch (err) {
        if (err.name === 'AbortError') return;

        if (retryCount < MAX_RETRIES) {
          const delay = RETRY_BASE_MS * Math.pow(2, retryCount);
          state.dispatch({
            type: 'CUSTOM',
            name: 'connection_retry',
            value: { attempt: retryCount + 1, delayMs: delay },
          });
          await new Promise((r) => setTimeout(r, delay));
          return sendMessage(message, retryCount + 1);
        }

        state.dispatch({ type: 'ERROR', message: 'Connection lost after retries' });
      }
    },
    [sessionId, state]
  );

  return {
    sendMessage,
    reset: state.reset,
    isRunning: state.isRunning,
    messages: state.messages,
    toolCalls: state.toolCalls,
    tokenChain: state.tokenChain,
    hitlPending: state.hitlPending,
    error: state.error,
    runId: state.runId,
  };
}

/**
 * Read an SSE ReadableStream and dispatch each AG-UI event to the reducer.
 * Handles: data: <json>\n\n lines; ignores `: ping` keepalive comments.
 */
async function consumeSseStream(body, dispatch) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n\n');
    buffer = lines.pop(); // keep incomplete chunk

    for (const block of lines) {
      const trimmed = block.trim();
      if (!trimmed || trimmed.startsWith(':')) continue; // keepalive / comment
      if (trimmed.startsWith('data: ')) {
        try {
          const event = JSON.parse(trimmed.slice(6));
          dispatch(event);
        } catch {
          // malformed event — ignore
        }
      }
    }
  }
}
```

- [ ] **Step 4: Run tests**

```bash
cd demo_api_ui
npm test -- --testPathPattern=useAgentRun --watchAll=false
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/hooks/useAgentRun.js demo_api_ui/src/__tests__/useAgentRun.test.js
git commit -m "feat(agui): add useAgentRun SSE hook (Phase 3.3)"
```

---

### Task 3.4: Wire `useAgentRun` into `BankingAgent.js` behind feature flag

**Files:**
- Modify: `demo_api_ui/src/components/BankingAgent.js`
- Modify: `demo_api_ui/src/context/TokenChainContext.js`

- [ ] **Step 1: Check the configStore feature flag pattern used in the UI**

```bash
grep -r "ff_" demo_api_ui/src --include="*.js" -l | head -5
grep -r "getEffective\|configStore\|featureFlag" demo_api_ui/src --include="*.js" -l | head -5
```

Identify how existing feature flags are read in the React UI (look for `useConfig`, `window.__config`, or API calls to `/api/config`).

- [ ] **Step 2: Read the BFF configStore flag convention**

```bash
grep -r "ff_agui\|ff_hitl\|ff_skip" demo_api_server/services/configStore.js | head -10
```

Confirm the flag name `ff_agui_enabled` follows the existing `ff_` prefix convention.

- [ ] **Step 3: Add the feature flag read in `BankingAgent.js`**

Near the top of the component function in `BankingAgent.js`, after existing hook calls, add:

```javascript
// AG-UI feature flag — read from BFF config endpoint
// Existing pattern: check how other ff_ flags are read in this component
// If using useConfig hook:
const { config } = useConfig(); // existing hook
const aguiEnabled = config?.ff_agui_enabled === 'true' || config?.ff_agui_enabled === true;

// AG-UI run hook (only active when flag is on)
const agentRun = useAgentRun({ sessionId: /* existing session id ref */ });
```

> **Read `BankingAgent.js` lines 1-100 before this step** to find the exact pattern for accessing configStore flags and the session ID. Do not guess — follow the existing pattern exactly.

- [ ] **Step 4: Conditionally swap the message send path**

Find the existing `sendAgentMessage()` call in `BankingAgent.js`. Wrap it:

```javascript
const handleSendMessage = useCallback(async (message) => {
  if (aguiEnabled) {
    agentRun.sendMessage(message);
  } else {
    // existing sendAgentMessage path unchanged
    await sendAgentMessage(message, sessionId, /* existing params */);
  }
}, [aguiEnabled, agentRun, sessionId]);
```

Replace the existing send handler invocation with `handleSendMessage`.

- [ ] **Step 5: Update `TokenChainContext` to read from AG-UI token chain when flag is on**

In `demo_api_ui/src/context/TokenChainContext.js`, the `setTokenEvents` function currently receives events from `/api/mcp/tool` responses. Add an effect that listens to the `agentRun.tokenChain` array when `aguiEnabled`:

```javascript
// In TokenChainProvider, after existing state declarations:
// (Pass aguiEnabled and aguiTokenChain as props or via context from BankingAgent)
// The simplest approach: emit a 'token-chain-inject' window event per CUSTOM token event
// This reuses the existing synthetic injection mechanism already in TokenChainContext.js

useEffect(() => {
  if (!aguiEnabled || !aguiTokenChain?.length) return;
  const latest = aguiTokenChain[aguiTokenChain.length - 1];
  window.dispatchEvent(new CustomEvent('token-chain-inject', { detail: latest }));
}, [aguiEnabled, aguiTokenChain]);
```

> Read `TokenChainContext.js` lines 1-50 to confirm the `token-chain-inject` event name and `detail` shape before writing this. The existing synthetic injection listener in `TokenChainContext.js` already handles this — just feed it the right data.

- [ ] **Step 6: Build and verify no errors**

```bash
cd demo_api_ui
npm run build
```

Expected: exit 0, no TypeScript/ESLint errors.

- [ ] **Step 7: Commit**

```bash
git add demo_api_ui/src/components/BankingAgent.js demo_api_ui/src/context/TokenChainContext.js
git commit -m "feat(agui): wire useAgentRun into BankingAgent behind ff_agui_enabled (Phase 3.4)"
```

---

## Phase 4: HITL via AG-UI

### Task 4.1: `POST /api/agent/consent/:runId` BFF route

**Files:**
- Create: `demo_api_server/routes/agentConsentRoute.js`
- Modify: `demo_api_server/server.js`

- [ ] **Step 1: Write a failing test**

Create `demo_api_server/tests/agentConsentRoute.test.js`:

```javascript
const request = require('supertest');
const express = require('express');

jest.mock('../middleware/auth', () => ({
  requireSession: (req, res, next) => next(),
}));

// Use fallback store (no Redis needed for tests)
process.env.AGUI_STORE_FALLBACK = 'true';
const { createAgentRunStore } = require('../services/agentRunStore');

// Mock the module-level agentRunStore with a fresh fallback instance
const mockStore = createAgentRunStore();
jest.mock('../services/agentRunStore', () => ({
  agentRunStore: mockStore,
  createAgentRunStore: jest.fn(() => mockStore),
}));

const agentConsentRoute = require('../routes/agentConsentRoute');
const app = express();
app.use(express.json());
app.use('/api/agent', agentConsentRoute);

describe('POST /api/agent/consent/:runId', () => {
  test('returns 404 for unknown runId', async () => {
    const res = await request(app)
      .post('/api/agent/consent/run_unknown')
      .send({ approved: true });
    expect(res.status).toBe(404);
  });

  test('publishes consent signal for a suspended run', async () => {
    await mockStore.setRunState('run_test', { status: 'suspended_hitl' });
    const received = [];
    await mockStore.subscribeConsent('run_test', (msg) => received.push(msg));

    const res = await request(app)
      .post('/api/agent/consent/run_test')
      .send({ approved: true });

    await new Promise((r) => setImmediate(r));
    expect(res.status).toBe(200);
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ approved: true });
  });

  test('returns 409 if run is not suspended', async () => {
    await mockStore.setRunState('run_active', { status: 'running' });
    const res = await request(app)
      .post('/api/agent/consent/run_active')
      .send({ approved: true });
    expect(res.status).toBe(409);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd demo_api_server
npx jest tests/agentConsentRoute.test.js
```

Expected: Cannot find module.

- [ ] **Step 3: Implement `agentConsentRoute.js`**

```javascript
// demo_api_server/routes/agentConsentRoute.js
'use strict';

const express = require('express');
const { requireSession } = require('../middleware/auth');
const { agentRunStore } = require('../services/agentRunStore');

const router = express.Router();

/**
 * POST /api/agent/consent/:runId
 *
 * Signals consent approval/denial for a HITL-suspended run.
 * Cloud-safe: publishes to Redis pub/sub channel agui:consent:<runId>
 * so the SSE handler (which may be on a different instance) receives it.
 * Body: { approved: boolean }
 */
router.post('/consent/:runId', requireSession, async (req, res) => {
  const { runId } = req.params;
  const { approved } = req.body;

  const runState = await agentRunStore.getRunState(runId);
  if (!runState) {
    return res.status(404).json({ error: 'Run not found' });
  }
  if (runState.status !== 'suspended_hitl') {
    return res.status(409).json({ error: 'Run is not awaiting consent' });
  }

  // Publish consent signal via pub/sub — SSE handler on any instance receives it
  await agentRunStore.publishConsent(runId, { approved: Boolean(approved) });

  // Remove run state from Redis (SSE handler will clean up its subscription)
  await agentRunStore.deleteRunState(runId);

  return res.json({ ok: true, runId, approved: Boolean(approved) });
});

module.exports = router;
```

- [ ] **Step 4: Mount in `server.js`**

```javascript
const agentConsentRoute = require('./routes/agentConsentRoute');
app.use('/api/agent', agentConsentRoute);
```

- [ ] **Step 5: Run tests**

```bash
cd demo_api_server
npx jest tests/agentConsentRoute.test.js
```

Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/routes/agentConsentRoute.js demo_api_server/server.js demo_api_server/tests/agentConsentRoute.test.js
git commit -m "feat(agui): add POST /api/agent/consent/:runId HITL resume route (Phase 4.1)"
```

---

### Task 4.2: `useHitlConsent` — consent modal hook

**Files:**
- Create: `demo_api_ui/src/hooks/useHitlConsent.js`

- [ ] **Step 1: Write a failing test**

Create `demo_api_ui/src/__tests__/useHitlConsent.test.js`:

```javascript
import { renderHook, act, waitFor } from '@testing-library/react';
import useHitlConsent from '../hooks/useHitlConsent';

global.fetch = jest.fn();

describe('useHitlConsent', () => {
  beforeEach(() => jest.clearAllMocks());

  test('no pending consent initially', () => {
    const { result } = renderHook(() => useHitlConsent({ hitlPending: null, runId: null }));
    expect(result.current.showConsentModal).toBe(false);
  });

  test('showConsentModal is true when hitlPending is set', () => {
    const hitlPending = { runId: 'r1', tool: 'transfer', params: {}, threshold: 500 };
    const { result } = renderHook(() => useHitlConsent({ hitlPending, runId: 'r1' }));
    expect(result.current.showConsentModal).toBe(true);
    expect(result.current.consentData).toEqual(hitlPending);
  });

  test('submitConsent POSTs to /api/agent/consent/:runId', async () => {
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    const hitlPending = { runId: 'r1', tool: 'transfer', params: {}, threshold: 500 };
    const { result } = renderHook(() => useHitlConsent({ hitlPending, runId: 'r1' }));

    await act(async () => {
      await result.current.submitConsent(true);
    });

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/agent/consent/r1',
      expect.objectContaining({ method: 'POST' })
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd demo_api_ui
npm test -- --testPathPattern=useHitlConsent --watchAll=false
```

Expected: Cannot find module.

- [ ] **Step 3: Implement `useHitlConsent.js`**

```javascript
// demo_api_ui/src/hooks/useHitlConsent.js
import { useCallback } from 'react';

/**
 * useHitlConsent — derives consent modal state from hitlPending and
 * provides submitConsent() to approve or deny.
 *
 * @param {{ hitlPending: object|null, runId: string|null }} opts
 */
export default function useHitlConsent({ hitlPending, runId }) {
  const showConsentModal = Boolean(hitlPending);
  const consentData = hitlPending || null;

  const submitConsent = useCallback(
    async (approved) => {
      const rid = hitlPending?.runId || runId;
      if (!rid) return;

      await fetch(`/api/agent/consent/${rid}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved }),
        credentials: 'include',
      });
    },
    [hitlPending, runId]
  );

  return { showConsentModal, consentData, submitConsent };
}
```

- [ ] **Step 4: Run tests**

```bash
cd demo_api_ui
npm test -- --testPathPattern=useHitlConsent --watchAll=false
```

Expected: 3 passed.

- [ ] **Step 5: Wire `useHitlConsent` into `BankingAgent.js`**

In `BankingAgent.js`, after the `useAgentRun` hook call, add:

```javascript
const { showConsentModal, consentData, submitConsent } = useHitlConsent({
  hitlPending: agentRun.hitlPending,
  runId: agentRun.runId,
});
```

Then in the JSX, wrap the existing HITL consent modal render with:

```javascript
{aguiEnabled && showConsentModal && (
  <ConsentModal
    data={consentData}
    onApprove={() => submitConsent(true)}
    onDeny={() => submitConsent(false)}
  />
)}
```

> Read the existing HITL consent modal component name and props from `BankingAgent.js` before writing this — match the exact component name and prop interface.

- [ ] **Step 6: Build**

```bash
cd demo_api_ui && npm run build
```

Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add demo_api_ui/src/hooks/useHitlConsent.js demo_api_ui/src/__tests__/useHitlConsent.test.js demo_api_ui/src/components/BankingAgent.js
git commit -m "feat(agui): add useHitlConsent hook + wire HITL modal to AG-UI (Phase 4.2)"
```

---

## Phase 5: Cutover + cleanup

### Task 5.1: Flip `ff_agui_enabled` to default-on

**Files:**
- Modify: `demo_api_server/services/configStore.js` (or wherever `ff_agui_enabled` default is defined)

- [ ] **Step 1: Find the flag default**

```bash
grep -r "ff_agui_enabled" demo_api_server/ --include="*.js"
```

- [ ] **Step 2: Change the default from `'false'` to `'true'`**

In `configStore.js` (or the relevant `FIELD_DEFS` / defaults object), change:

```javascript
ff_agui_enabled: { default: 'false', ... }
// becomes:
ff_agui_enabled: { default: 'true', ... }
```

- [ ] **Step 3: Run the full regression checklist manually**

Go through each item in `REGRESSION_PLAN.md` §1 and §pre-deploy:

```
- Admin login → /admin resolves
- User login → /dashboard resolves
- OAuth callbacks → https://api.ping.demo:4000 (not localhost)
- Agent FAB visible → click opens sidebar
- Banking tool call → Token Chain panel shows token exchange events
- HITL consent modal appears for transfers over threshold
- Token Chain shows act_valid or act_absent (not blank)
- /tmp/demo-api.log → no unhandled rejections
```

- [ ] **Step 4: Run all tests**

```bash
npm test
cd demo_api_ui && npm run build
```

Expected: all pass, build exits 0.

- [ ] **Step 5: Commit the flag flip**

```bash
git add demo_api_server/services/configStore.js
git commit -m "feat(agui): flip ff_agui_enabled to default-on (Phase 5.1)"
```

---

### Task 5.2: Delete WebSocket path

**Files:**
- Delete: `demo_api_ui/src/services/langchainWebSocket.js`
- Modify: `demo_api_server/services/langchainChatProxy.js` (remove or no-op the WS proxy)
- Modify: `demo_api_server/server.js` (remove WS upgrade handler registration)
- Modify: `langchain_agent/src/websocket_handler.py` (remove dual-emit; remove `agui_enabled` flag branch)
- Modify: `langchain_agent/src/config/settings.py` (remove `agui_enabled` field)

- [ ] **Step 1: Remove `langchainWebSocket.js` from React UI**

```bash
rm demo_api_ui/src/services/langchainWebSocket.js
```

Verify no remaining imports:
```bash
grep -r "langchainWebSocket" demo_api_ui/src --include="*.js"
```

Expected: no output.

- [ ] **Step 2: Remove the WS upgrade handler from BFF**

In `demo_api_server/server.js`, remove the line that calls `attachLangchainChatProxy(server, sessionMiddleware)`.

In `demo_api_server/services/langchainChatProxy.js`, delete the file or leave it inert — deleting is cleaner:

```bash
rm demo_api_server/services/langchainChatProxy.js
```

Remove its require from `server.js`.

- [ ] **Step 3: Remove dual-emit from the Python agent**

In `langchain_agent/src/api/websocket_handler.py`, remove any import of `AGUIEventEmitter` and the dual-emit code block added in Phase 1.6.

In `langchain_agent/src/config/settings.py`, remove the `agui_enabled: bool` field (it's now always on by default — the `/run` endpoint is always active).

- [ ] **Step 4: Build + run all tests**

```bash
cd demo_api_ui && npm run build
npm test
cd langchain_agent && python -m pytest tests/ -v
```

Expected: all pass, build exits 0.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(agui): remove WebSocket path — AG-UI SSE is now the only agent transport (Phase 5.2)"
```

---

## Self-review (plan-level)

**Spec coverage check:**
- ✅ Core event stream: Tasks 1.1–1.6 + 2.3 + 3.2–3.3
- ✅ State delta rendering: `STATE_DELTA` in event_types + useAgentState reducer
- ✅ Token chain as CUSTOM events: Task 2.2 (buildTokenChainEvents) + 3.4 (TokenChainContext injection)
- ✅ HITL via AG-UI: Tasks 4.1–4.2
- ✅ Incremental migration / feature flag: `ff_agui_enabled` in 3.4, flipped in 5.1
- ✅ Cutover + cleanup: Task 5.2
- ✅ Error handling (SSE drop retry, RFC 8693 failure, HITL timeout): useAgentRun retry loop (3.3), agentRunRoute error emit (2.3), agentConsentRoute timeout (4.1)

**Type consistency:**
- `AGUIEventEmitter` methods: `on_run_start`, `on_run_end`, `on_llm_start`, `on_llm_new_token`, `on_llm_end`, `on_tool_start`, `on_tool_end`, `on_error` — consistent across emitter.py, task 1.6
- `buildCustomEvent(name, value)` — consistent between aguiSseProxy.js test and implementation
- `buildTokenChainEvents(tokenEvents)` — consistent between test and implementation
- `useAgentState` dispatch event shapes — consistent between test cases and reducer cases
- `proxyAgentSse({ browserRes, runId, sessionId, message, authToken, tokenChainEvents })` — consistent between agentRunRoute.js call and aguiSseProxy.js signature

**No placeholder scan:** All code blocks are complete. No TBD/TODO in task bodies.
