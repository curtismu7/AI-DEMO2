# Prompt Flow Inspector — Agent-Layer Emitter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `langchain_agent` a hop emitter — matching the shape of the existing TS/JS ones — that forwards redacted agent reasoning/tool/LLM steps into the BFF's shared transaction ledger under phase `agent.step`, threaded with LangChain's own `runId`/`parentRunId`/`sessionId` and an (optional, BFF-sourced) `correlationId`.

**Architecture:** Two new standalone modules (`prompt_flow_redact.py`, a Python port of `demo_api_server/utils/logRedact.js`; `prompt_flow_hop.py`, a Python port of `demo_mcp_gateway/src/transactionHop.ts`) are wired into `DetailedTracingCallbackHandler`'s six start/end hooks in `tracing_callback.py`. A `correlation_id` is threaded from the incoming WebSocket message, through `ChatMessage.metadata`, `message_processor.py`, and `process_message_with_tracing`, into `AgentExecutionTracer` — where the hop emitter reads it back out on every hook firing.

**Tech Stack:** Python 3.11, `httpx` (existing dependency, already used for outbound BFF calls in `bff_tool_adapter.py`), `pytest` + `pytest-asyncio` + `respx` (existing dev dependencies), stdlib `threading` for fire-and-forget dispatch.

**Spec:** docs/superpowers/specs/2026-08-16-prompt-flow-inspector-design.md

## Global Constraints

- Fire-and-forget: "All hop emissions ... follow the established fire-and-forget pattern — POST with timeout, swallow errors. Agent/LLM proxy never block or fail a user-facing request if the BFF ledger endpoint is unreachable." (spec §6)
- "Redaction failure → placeholder text ..., never raw content." (spec §3, §6)
- "Content capped at ~4000 chars per field." (spec §3)
- Agent hop phase is always `agent.step` (spec §2, "Agent" paragraph).
- `runId`/`parentRunId`/`sessionId` carried through from LangChain's own IDs (spec §2, "Agent" paragraph).
- `correlationId` is sourced at the BFF and threaded through every hop (spec §1) — this plan wires the Python-side plumbing to accept and forward it; the BFF side that actually sends it on the WebSocket message is a sibling plan's responsibility (out of scope here — see "Decisions" below).

## Decisions (read before implementing)

**1. `demo_api_server/utils/logRedact.js` does not contain SSN/card/email patterns.** The spec's §3 parenthetical ("SSN/card/email/token patterns") does not match the actual file: `logRedact.js` redacts (a) bare JWTs via a regex (`JWT_RE`) and (b) values under known secret-shaped keys (`authorization`, `access_token`, `refresh_token`, `id_token`, `client_secret`, `password`, `passwd`, `secret`, `api_key`/`api-key`, `cookie`, `set-cookie`, `bearer`) via `SECRET_KEY_RE`. There is no SSN, card-number, or email regex anywhere in that file, and a repo-wide grep for SSN/card patterns in `demo_api_server/utils` and `demo_api_server/middleware` found none. Task 1 ports exactly what the file contains — not what the spec's prose describes.

**2. `StructuredLogger`/`LogContext` (`langchain_agent/src/log_utils/structured_logger.py`) is NOT wired up.** It is dead scaffolding: nothing in the codebase calls `StructuredLogger(...)` or constructs a `LogContext` (confirmed via repo-wide grep — the only reference to the module is `main.py` importing the unrelated `setup_logging` function). It also solves a different problem — local structured console/file logging with `request_id`/`trace_id`/`span_id` fields — not HTTP delivery to an external ledger, and its field names don't map cleanly onto the hop shape (`correlationId`/`runId`/`parentRunId`/`sessionId`) used by every other layer's emitter. This plan writes a fresh, minimal emitter module (`prompt_flow_hop.py`) instead of retrofitting `StructuredLogger`, to stay in the same shape as `demo_mcp_gateway/src/transactionHop.ts` and the P1AZ hop emitter, and to avoid conflating two unrelated concerns.

**3. Dispatch model for the fire-and-forget POST.** `DetailedTracingCallbackHandler`'s hooks (`on_tool_start`, `on_llm_end`, etc.) are synchronous `BaseCallbackHandler` methods, not coroutines — there is no `await` point available to use `httpx.AsyncClient` the way `bff_tool_adapter.py` does. To guarantee the hop POST never blocks or slows the agent's response (per the fire-and-forget constraint), `prompt_flow_hop.py` dispatches the POST onto a short-lived daemon thread. The dispatch call itself is a swappable module-level function (`_dispatch`) so tests can force it to run synchronously and assert on the outgoing request without racing a background thread.

**4. Only `on_chain_start/end`, `on_tool_start/end`, `on_llm_start/end` are wired — not the `*_error` hooks.** The spec explicitly lists only the six start/end hooks (spec §2, "Agent" paragraph: "hooked into `tracing_callback.py`'s `on_chain_start/end`, `on_tool_start/end`, `on_llm_start/end`"). `on_tool_error`/`on_llm_error`/`on_chain_error` are left untouched — adding hop emission there is not requested by the spec and is out of scope for this plan.

---

### Task 1: Redaction module (port of `logRedact.js`)

**Files:**
- Create: `langchain_agent/src/agent/prompt_flow_redact.py`
- Test: `langchain_agent/tests/test_prompt_flow_redact.py`

**Interfaces:**
- Consumes: nothing (pure functions, stdlib `json`/`re` only).
- Produces: `redact_value(value: Any) -> Any`, `redact_object(obj: dict) -> dict`, `redact_message(message: Any) -> str`, `redact_and_cap(value: Any, max_chars: int = DEFAULT_MAX_CHARS) -> str`, constants `SECRET_KEY_RE`, `JWT_RE`, `DEFAULT_MAX_CHARS = 4000`, `REDACTION_ERROR_PLACEHOLDER = "[redaction-error, content omitted]"`. `redact_and_cap` is what Task 5 calls to build `details.content`.

- [ ] **Step 1: Write the failing test**

Create `langchain_agent/tests/test_prompt_flow_redact.py`:

```python
"""Unit tests for the Prompt Flow Inspector's redaction module.

src.agent.prompt_flow_redact ports demo_api_server/utils/logRedact.js. That
file redacts bare JWTs (JWT_RE) and values under known secret-shaped keys
(SECRET_KEY_RE) — it has no SSN/card/email patterns, so neither does this
port. See docs/superpowers/plans/2026-08-16-prompt-flow-agent-emitter.md
"Decisions" §1 for why.
"""
from src.agent.prompt_flow_redact import (
    redact_value,
    redact_object,
    redact_message,
    redact_and_cap,
    REDACTION_ERROR_PLACEHOLDER,
)

SAMPLE_JWT = (
    "eyJhbGciOiJIUzI1NiJ9"
    ".eyJzdWIiOiIxMjM0NTY3ODkwIn0"
    ".dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"
)


class TestRedactValue:
    def test_redacts_bare_jwt_in_string(self):
        assert redact_value(f"token={SAMPLE_JWT}") == "token=[REDACTED_JWT]"

    def test_leaves_plain_string_untouched(self):
        assert redact_value("hello world") == "hello world"

    def test_passes_through_none(self):
        assert redact_value(None) is None

    def test_redacts_list_items(self):
        assert redact_value([f"a={SAMPLE_JWT}", "plain"]) == ["a=[REDACTED_JWT]", "plain"]

    def test_redacts_nested_dict(self):
        assert redact_value({"outer": {"password": "hunter2"}}) == {
            "outer": {"password": "[REDACTED]"}
        }


class TestRedactObject:
    def test_redacts_known_secret_keys(self):
        obj = {
            "authorization": "Bearer abc",
            "access_token": "abc123",
            "refresh_token": "def456",
            "id_token": "ghi789",
            "client_secret": "shh",
            "password": "hunter2",
            "passwd": "hunter2",
            "secret": "shh",
            "api_key": "key123",
            "api-key": "key456",
            "cookie": "sid=1",
            "set-cookie": "sid=1",
            "bearer": "abc",
        }
        redacted = redact_object(obj)
        assert all(v == "[REDACTED]" for v in redacted.values())

    def test_key_matching_is_case_insensitive(self):
        assert redact_object({"Authorization": "Bearer abc"}) == {"Authorization": "[REDACTED]"}

    def test_non_secret_keys_pass_through(self):
        assert redact_object({"user_id": "u1", "amount": 42}) == {"user_id": "u1", "amount": 42}


class TestRedactMessage:
    def test_redacts_jwt_in_plain_message(self):
        assert redact_message(f"Authorization: Bearer {SAMPLE_JWT}") == "Authorization: Bearer [REDACTED_JWT]"

    def test_non_string_input_stringified(self):
        assert redact_message(42) == "42"

    def test_none_input_returns_empty_string(self):
        assert redact_message(None) == ""


class TestRedactAndCap:
    def test_redacts_and_serializes_dict(self):
        result = redact_and_cap({"password": "hunter2", "note": "hi"})
        assert '"password": "[REDACTED]"' in result
        assert '"note": "hi"' in result

    def test_caps_long_content(self):
        long_text = "x" * 5000
        result = redact_and_cap(long_text, max_chars=4000)
        assert len(result) == 4000 + len("...[truncated]")
        assert result.endswith("...[truncated]")

    def test_short_content_not_truncated(self):
        assert redact_and_cap("short") == "short"

    def test_redaction_failure_returns_placeholder(self):
        class BadDict(dict):
            def items(self):
                raise RuntimeError("boom")

        result = redact_and_cap(BadDict({"a": 1}))
        assert result == REDACTION_ERROR_PLACEHOLDER
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd langchain_agent && bash scripts/run-pytest.sh tests/test_prompt_flow_redact.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'src.agent.prompt_flow_redact'`

- [ ] **Step 3: Write minimal implementation**

Create `langchain_agent/src/agent/prompt_flow_redact.py`:

```python
"""Redaction for content captured by the Prompt Flow Inspector's agent-layer
hop emitter (see prompt_flow_hop.py).

Ported from demo_api_server/utils/logRedact.js. That file redacts bare JWTs
and values under known secret-shaped keys — it has no SSN/card/email
patterns despite how docs/superpowers/specs/2026-08-16-prompt-flow-inspector-design.md
§3 describes it; this module ports exactly what the source file contains.
"""
from __future__ import annotations

import json
import re
from typing import Any

SECRET_KEY_RE = re.compile(
    r"^(authorization|access_token|refresh_token|id_token|client_secret|"
    r"password|passwd|secret|api[_-]?key|cookie|set-cookie|bearer)$",
    re.IGNORECASE,
)

JWT_RE = re.compile(r"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b")

DEFAULT_MAX_CHARS = 4000
REDACTION_ERROR_PLACEHOLDER = "[redaction-error, content omitted]"


def redact_value(value: Any) -> Any:
    """Recursively redact bare JWTs in strings and secret-shaped keys in dicts."""
    if value is None:
        return value
    if isinstance(value, str):
        return JWT_RE.sub("[REDACTED_JWT]", value)
    if isinstance(value, list):
        return [redact_value(item) for item in value]
    if isinstance(value, dict):
        return redact_object(value)
    return value


def redact_object(obj: dict) -> dict:
    """Redact a dict's values, replacing secret-shaped keys wholesale."""
    out: dict = {}
    for key, value in obj.items():
        if isinstance(key, str) and SECRET_KEY_RE.match(key):
            out[key] = "[REDACTED]"
        else:
            out[key] = redact_value(value)
    return out


def redact_message(message: Any) -> str:
    """Redact bare JWTs in a plain string message."""
    if not isinstance(message, str):
        message = "" if message is None else str(message)
    return JWT_RE.sub("[REDACTED_JWT]", message)


def redact_and_cap(value: Any, max_chars: int = DEFAULT_MAX_CHARS) -> str:
    """Redact `value`, serialize it to a string, and cap its length.

    Used to build details.content for the agent-layer hop emitter. Never
    raises and never returns unredacted content on failure — any exception
    during redaction or serialization yields REDACTION_ERROR_PLACEHOLDER.
    """
    try:
        if isinstance(value, str):
            text = redact_message(value)
        else:
            redacted = redact_value(value)
            text = json.dumps(redacted, default=str)
    except Exception:
        return REDACTION_ERROR_PLACEHOLDER

    if len(text) > max_chars:
        return text[:max_chars] + "...[truncated]"
    return text
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd langchain_agent && bash scripts/run-pytest.sh tests/test_prompt_flow_redact.py -v`
Expected: PASS (13 tests)

- [ ] **Step 5: Commit**

```bash
git add langchain_agent/src/agent/prompt_flow_redact.py langchain_agent/tests/test_prompt_flow_redact.py
git commit -m "feat(langchain_agent): add prompt flow redaction module ported from logRedact.js"
```

---

### Task 2: Agent-layer hop emitter (port of `transactionHop.ts`)

**Files:**
- Create: `langchain_agent/src/agent/prompt_flow_hop.py`
- Test: `langchain_agent/tests/test_prompt_flow_hop.py`

**Interfaces:**
- Consumes: `os.environ["BFF_TRANSACTION_HOP_URL"]`, `os.environ["BFF_INTERNAL_SECRET"]` (same env vars `demo_mcp_gateway/src/transactionHop.ts` reads).
- Produces: `emit_agent_hop(*, op: str, run_id: str, parent_run_id: Optional[str], session_id: Optional[str], correlation_id: Optional[str], content: str, duration_ms: Optional[int] = None, status: str = "ok") -> None`, module-level `_dispatch` (test seam), `_default_dispatch(fn)`, constants `SERVICE = "langchain-agent"`, `PHASE = "agent.step"`. Task 5 calls `emit_agent_hop` from `tracing_callback.py`.

- [ ] **Step 1: Write the failing test**

Create `langchain_agent/tests/test_prompt_flow_hop.py`:

```python
"""Unit tests for the Prompt Flow Inspector's agent-layer hop emitter.

Ported from demo_mcp_gateway/src/transactionHop.ts — same fire-and-forget
shape (POST to the BFF ledger, swallow all errors, no-op with no
correlation_id or missing config).
"""
import json
import threading

import httpx
import pytest
import respx

from src.agent import prompt_flow_hop
from src.agent.prompt_flow_hop import emit_agent_hop

HOP_URL = "http://127.0.0.1:3001/internal/transaction-hop"


@pytest.fixture(autouse=True)
def sync_dispatch(monkeypatch):
    """Run the emitter's POST synchronously so respx can observe it before
    the test returns — the default dispatch fires it on a daemon thread."""
    monkeypatch.setattr(prompt_flow_hop, "_dispatch", lambda fn: fn())


@pytest.fixture(autouse=True)
def hop_env(monkeypatch):
    monkeypatch.setenv("BFF_TRANSACTION_HOP_URL", HOP_URL)
    monkeypatch.setenv("BFF_INTERNAL_SECRET", "test-secret")


@respx.mock
def test_posts_expected_payload_shape():
    route = respx.post(HOP_URL).mock(return_value=httpx.Response(200, json={"ok": True}))

    emit_agent_hop(
        op="llm_start",
        run_id="run-1",
        parent_run_id="parent-1",
        session_id="sess-1",
        correlation_id="corr-1",
        content="redacted prompt text",
        duration_ms=42,
        status="ok",
    )

    assert route.called
    request = route.calls[-1].request
    assert request.headers["x-internal-gateway-secret"] == "test-secret"
    body = json.loads(request.content)
    assert body == {
        "phase": "agent.step",
        "op": "llm_start",
        "runId": "run-1",
        "parentRunId": "parent-1",
        "sessionId": "sess-1",
        "correlationId": "corr-1",
        "durationMs": 42,
        "status": "ok",
        "details": {"content": "redacted prompt text"},
        "service": "langchain-agent",
    }


@respx.mock
def test_no_correlation_id_skips_emission():
    route = respx.post(HOP_URL).mock(return_value=httpx.Response(200, json={"ok": True}))

    emit_agent_hop(
        op="tool_start",
        run_id="run-2",
        parent_run_id=None,
        session_id="sess-2",
        correlation_id=None,
        content="ignored",
    )

    assert not route.called


@respx.mock
def test_missing_env_config_skips_emission(monkeypatch):
    monkeypatch.delenv("BFF_TRANSACTION_HOP_URL", raising=False)
    route = respx.post(HOP_URL).mock(return_value=httpx.Response(200, json={"ok": True}))

    emit_agent_hop(
        op="tool_start",
        run_id="run-3",
        parent_run_id=None,
        session_id="sess-3",
        correlation_id="corr-3",
        content="ignored",
    )

    assert not route.called


@respx.mock
def test_post_failure_never_raises():
    respx.post(HOP_URL).mock(side_effect=httpx.ConnectError("boom"))

    emit_agent_hop(
        op="tool_end",
        run_id="run-4",
        parent_run_id=None,
        session_id="sess-4",
        correlation_id="corr-4",
        content="ignored",
    )
    # Reaching this line without an exception is the assertion.


def test_default_dispatch_runs_target_on_a_daemon_thread():
    """The real (non-test) dispatch path never blocks the caller."""
    ran = {}
    done = threading.Event()

    def target():
        current = threading.current_thread()
        ran["name"] = current.name
        ran["is_daemon"] = current.daemon
        done.set()

    prompt_flow_hop._default_dispatch(target)

    assert done.wait(timeout=1.0), "target was not invoked"
    assert ran["name"] != threading.current_thread().name
    assert ran["is_daemon"] is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd langchain_agent && bash scripts/run-pytest.sh tests/test_prompt_flow_hop.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'src.agent.prompt_flow_hop'`

- [ ] **Step 3: Write minimal implementation**

Create `langchain_agent/src/agent/prompt_flow_hop.py`:

```python
"""Agent-layer hop emitter for the Prompt Flow Inspector.

Ported from demo_mcp_gateway/src/transactionHop.ts — same fire-and-forget
shape (POST one hop to the BFF's transaction ledger, swallow every error).
Called from tracing_callback.py's on_chain_start/end, on_tool_start/end, and
on_llm_start/end hooks. Phase is always "agent.step" — see
docs/superpowers/specs/2026-08-16-prompt-flow-inspector-design.md §2 (Agent).
"""
from __future__ import annotations

import logging
import os
import threading
from typing import Any, Callable, Dict, Optional

import httpx

logger = logging.getLogger(__name__)

SERVICE = "langchain-agent"
PHASE = "agent.step"
_HOP_TIMEOUT_SECONDS = 2.0


def _default_dispatch(fn: Callable[[], None]) -> None:
    """Run `fn` on a daemon thread.

    The callback hooks that call emit_agent_hop are synchronous LangChain
    callback methods — dispatching to a background thread means a slow or
    unreachable BFF ledger endpoint can never delay or fail the agent's
    user-facing response.
    """
    threading.Thread(target=fn, daemon=True).start()


# Test seam — tests monkeypatch this to run `fn` synchronously so they can
# assert on the outgoing request without racing a background thread.
_dispatch: Callable[[Callable[[], None]], None] = _default_dispatch


def emit_agent_hop(
    *,
    op: str,
    run_id: str,
    parent_run_id: Optional[str],
    session_id: Optional[str],
    correlation_id: Optional[str],
    content: str,
    duration_ms: Optional[int] = None,
    status: str = "ok",
) -> None:
    """Ship one agent.step hop to the BFF ledger, fire-and-forget.

    Never raises and never blocks the calling callback hook. No-ops when
    BFF_TRANSACTION_HOP_URL / BFF_INTERNAL_SECRET are unset, or when
    correlation_id is missing — mirrors transactionHop.ts's emitHop, which
    skips silently rather than emitting a hop nothing can be joined against.
    """
    try:
        if not correlation_id:
            return
        url = os.environ.get("BFF_TRANSACTION_HOP_URL")
        secret = os.environ.get("BFF_INTERNAL_SECRET")
        if not url or not secret:
            return

        payload: Dict[str, Any] = {
            "phase": PHASE,
            "op": op,
            "runId": run_id,
            "parentRunId": parent_run_id,
            "sessionId": session_id,
            "correlationId": correlation_id,
            "durationMs": duration_ms,
            "status": status,
            "details": {"content": content},
            "service": SERVICE,
        }

        def _send() -> None:
            try:
                httpx.post(
                    url,
                    json=payload,
                    headers={
                        "Content-Type": "application/json",
                        "x-internal-gateway-secret": secret,
                    },
                    timeout=_HOP_TIMEOUT_SECONDS,
                )
            except Exception:
                logger.debug("Prompt flow hop POST failed", exc_info=True)

        _dispatch(_send)
    except Exception:
        logger.debug("Prompt flow hop emission failed", exc_info=True)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd langchain_agent && bash scripts/run-pytest.sh tests/test_prompt_flow_hop.py -v`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add langchain_agent/src/agent/prompt_flow_hop.py langchain_agent/tests/test_prompt_flow_hop.py
git commit -m "feat(langchain_agent): add agent.step hop emitter ported from transactionHop.ts"
```

---

### Task 3: Thread `correlation_id` through the tracer (`execution_tracer.py`, `langchain_mcp_agent.py`)

**Files:**
- Modify: `langchain_agent/src/agent/execution_tracer.py:23-31` (`AgentExecutionTracer.__init__`)
- Modify: `langchain_agent/src/agent/execution_tracer.py:865-867` (`TracingMixin._create_tracer`)
- Modify: `langchain_agent/src/agent/langchain_mcp_agent.py:812-830` (`process_message_with_tracing`)
- Test: `langchain_agent/tests/test_execution_tracer.py` (new)
- Test: `langchain_agent/tests/test_langchain_mcp_agent.py` (add to existing `TestProcessMessageWithTracing`)

**Interfaces:**
- Consumes: nothing new.
- Produces: `AgentExecutionTracer(session_id: str, correlation_id: Optional[str] = None)` now exposes `.correlation_id`; `TracingMixin._create_tracer(self, session_id: str, correlation_id: Optional[str] = None) -> AgentExecutionTracer`; `process_message_with_tracing(self, user_message: str, session_id: str, stream_context: Optional[Dict[str, Any]] = None, correlation_id: Optional[str] = None) -> str`. Task 5's `_emit_hop` reads `self.tracer.correlation_id`.

- [ ] **Step 1: Write the failing test for `AgentExecutionTracer`/`TracingMixin`**

Create `langchain_agent/tests/test_execution_tracer.py`:

```python
"""Unit tests for AgentExecutionTracer / TracingMixin correlation_id threading.

Only covers the Prompt Flow Inspector's correlation_id plumbing (see
docs/superpowers/specs/2026-08-16-prompt-flow-inspector-design.md §1) —
execution_tracer.py's HTML/JSON trace-file writing is out of scope here.
"""
from src.agent.execution_tracer import AgentExecutionTracer, TracingMixin


class TestAgentExecutionTracerCorrelationId:
    def test_correlation_id_defaults_to_none(self):
        tracer = AgentExecutionTracer("sess-1")
        assert tracer.correlation_id is None

    def test_correlation_id_is_stored(self):
        tracer = AgentExecutionTracer("sess-1", correlation_id="corr-abc")
        assert tracer.correlation_id == "corr-abc"
        assert tracer.session_id == "sess-1"


class TestTracingMixinCreateTracer:
    def test_create_tracer_forwards_correlation_id(self):
        mixin = TracingMixin()
        tracer = mixin._create_tracer("sess-2", correlation_id="corr-xyz")
        assert isinstance(tracer, AgentExecutionTracer)
        assert tracer.session_id == "sess-2"
        assert tracer.correlation_id == "corr-xyz"

    def test_create_tracer_correlation_id_optional(self):
        mixin = TracingMixin()
        tracer = mixin._create_tracer("sess-3")
        assert tracer.correlation_id is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd langchain_agent && bash scripts/run-pytest.sh tests/test_execution_tracer.py -v`
Expected: FAIL with `TypeError: AgentExecutionTracer.__init__() got an unexpected keyword argument 'correlation_id'`

- [ ] **Step 3: Implement `AgentExecutionTracer.__init__` and `TracingMixin._create_tracer`**

In `langchain_agent/src/agent/execution_tracer.py`, replace the `__init__` method (originally lines 23-31):

```python
    def __init__(self, session_id: str, correlation_id: Optional[str] = None):
        self.session_id = session_id
        self.correlation_id = correlation_id
        self.execution_steps = []
        self.step_counter = 0
        self.start_time = datetime.now()

        # Ensure visualizations directory exists
        self.viz_dir = Path("visualizations")
        self.viz_dir.mkdir(exist_ok=True)
```

And replace `TracingMixin._create_tracer` (originally lines 865-867):

```python
    def _create_tracer(self, session_id: str, correlation_id: Optional[str] = None) -> AgentExecutionTracer:
        """Create a new execution tracer for the session."""
        return AgentExecutionTracer(session_id, correlation_id=correlation_id)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd langchain_agent && bash scripts/run-pytest.sh tests/test_execution_tracer.py -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Write the failing test for `process_message_with_tracing`**

In `langchain_agent/tests/test_langchain_mcp_agent.py`, add two tests inside the existing `class TestProcessMessageWithTracing:` (after `test_uses_astream_events_for_execution`, following the same fixture setup pattern already used there):

```python
    @pytest.mark.asyncio
    async def test_forwards_correlation_id_to_tracer(self, agent, mock_tools):
        """correlation_id passed into process_message_with_tracing reaches
        _create_tracer (docs/superpowers/specs/2026-08-16-prompt-flow-inspector-design.md §1)."""
        session_id = "test-session-corr"
        user_message = "What are my accounts?"

        mock_graph = _make_mock_graph()
        agent._graph = mock_graph
        agent._tools = mock_tools

        agent.mcp_tool_provider.set_session_context = AsyncMock()
        agent.mcp_tool_provider.set_tracer = Mock()
        agent.mcp_tool_provider.mcp_client_manager._session_challenges = {}

        await agent.conversation_memory.set_user_identified(session_id, "user@test.com", "user-1")

        with patch.object(agent, '_create_tracer', wraps=agent._create_tracer) as mock_create_tracer:
            await agent.process_message_with_tracing(
                user_message, session_id, correlation_id="corr-999"
            )

        mock_create_tracer.assert_called_once_with(session_id, correlation_id="corr-999")

    @pytest.mark.asyncio
    async def test_correlation_id_defaults_to_none(self, agent, mock_tools):
        """Omitting correlation_id (e.g. before the BFF sends one) still works."""
        session_id = "test-session-no-corr"
        user_message = "What are my accounts?"

        mock_graph = _make_mock_graph()
        agent._graph = mock_graph
        agent._tools = mock_tools

        agent.mcp_tool_provider.set_session_context = AsyncMock()
        agent.mcp_tool_provider.set_tracer = Mock()
        agent.mcp_tool_provider.mcp_client_manager._session_challenges = {}

        await agent.conversation_memory.set_user_identified(session_id, "user@test.com", "user-1")

        with patch.object(agent, '_create_tracer', wraps=agent._create_tracer) as mock_create_tracer:
            await agent.process_message_with_tracing(user_message, session_id)

        mock_create_tracer.assert_called_once_with(session_id, correlation_id=None)
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd langchain_agent && bash scripts/run-pytest.sh tests/test_langchain_mcp_agent.py -v -k correlation_id`
Expected: FAIL — `process_message_with_tracing() got an unexpected keyword argument 'correlation_id'`

- [ ] **Step 7: Implement `process_message_with_tracing`'s `correlation_id` parameter**

In `langchain_agent/src/agent/langchain_mcp_agent.py`, replace the method signature and tracer-creation line (originally lines 812-830):

```python
    async def process_message_with_tracing(
        self,
        user_message: str,
        session_id: str,
        stream_context: Optional[Dict[str, Any]] = None,
        correlation_id: Optional[str] = None,
    ) -> str:
        """
        Process a user message with real-time execution tracing and visualization.

        Args:
            user_message: The user's input message
            session_id: The chat session ID
            stream_context: Optional dict with websocket_handler for stream_event (tool + LLM token) streaming
            correlation_id: Optional Prompt Flow Inspector correlation ID, sourced at the
                BFF and threaded through every hop for this run (see
                docs/superpowers/specs/2026-08-16-prompt-flow-inspector-design.md §1).

        Returns:
            str: The agent's response
        """
        # Create execution tracer
        tracer = self._create_tracer(session_id, correlation_id=correlation_id)
```

(Every line below `tracer = self._create_tracer(...)` in the original method is unchanged.)

- [ ] **Step 8: Run test to verify it passes**

Run: `cd langchain_agent && bash scripts/run-pytest.sh tests/test_langchain_mcp_agent.py -v -k correlation_id`
Expected: PASS (2 tests)

Then run the full file to confirm nothing else regressed:

Run: `cd langchain_agent && bash scripts/run-pytest.sh tests/test_langchain_mcp_agent.py -v`
Expected: PASS (all tests, including the 3 pre-existing `TestProcessMessageWithTracing` tests)

- [ ] **Step 9: Commit**

```bash
git add langchain_agent/src/agent/execution_tracer.py langchain_agent/src/agent/langchain_mcp_agent.py langchain_agent/tests/test_execution_tracer.py langchain_agent/tests/test_langchain_mcp_agent.py
git commit -m "feat(langchain_agent): thread correlation_id through AgentExecutionTracer and process_message_with_tracing"
```

---

### Task 4: Thread `correlation_id` from the incoming WebSocket message (`websocket_handler.py`, `message_processor.py`)

**Files:**
- Modify: `langchain_agent/src/api/websocket_handler.py:282-290` (`_handle_chat_message` — `ChatMessage` construction)
- Modify: `langchain_agent/src/api/message_processor.py:689-705` (`_handle_chat_message`)
- Test: `langchain_agent/tests/test_websocket_handler.py` (add to `TestChatWebSocketHandler`)
- Test: `langchain_agent/tests/test_message_processor.py` (update existing test + add new one)

**Interfaces:**
- Consumes: `AgentExecutionTracer`/`TracingMixin`/`process_message_with_tracing` from Task 3 (the `correlation_id` kwarg they now accept).
- Produces: `ChatMessage.metadata["correlationId"]` populated (`None` when the incoming message carries none — the BFF does not send this field yet; that wiring belongs to a sibling plan, see "Decisions" above). `message_processor._handle_chat_message` now calls `self.agent.process_message_with_tracing(..., correlation_id=chat_message.metadata.get("correlationId"))`.

- [ ] **Step 1: Write the failing tests for `websocket_handler.py`**

In `langchain_agent/tests/test_websocket_handler.py`, add two tests inside `class TestChatWebSocketHandler:`, after `test_handle_chat_message_success`:

```python
    async def test_handle_chat_message_forwards_correlation_id(self, websocket_handler):
        """correlationId on the incoming message reaches ChatMessage.metadata
        (docs/superpowers/specs/2026-08-16-prompt-flow-inspector-design.md §1)."""
        connection_id = "test-conn-1"
        session_id = "test-session-1"
        mock_websocket = MockWebSocket()

        websocket_handler._connections[connection_id] = mock_websocket
        websocket_handler._connection_metadata[connection_id] = {
            "connected_at": datetime.now(timezone.utc),
            "path": "/chat",
            "session_id": session_id,
            "user_id": None
        }

        with patch.object(websocket_handler, '_notify_message_processor') as mock_notify:
            message = {
                "type": "chat_message",
                "content": "Hello, world!",
                "session_id": session_id,
                "correlationId": "corr-xyz-789",
                "_connection_id": connection_id,
                "_timestamp": datetime.now(timezone.utc).isoformat()
            }

            await websocket_handler._handle_chat_message(message)

        mock_notify.assert_called_once()
        forwarded_chat_message = mock_notify.call_args[0][0]
        assert forwarded_chat_message.metadata.get("correlationId") == "corr-xyz-789"

    async def test_handle_chat_message_missing_correlation_id_is_none(self, websocket_handler):
        """No correlationId on the incoming message -> metadata carries None
        (the BFF does not send this field yet — a sibling plan's job)."""
        connection_id = "test-conn-1"
        session_id = "test-session-1"
        mock_websocket = MockWebSocket()

        websocket_handler._connections[connection_id] = mock_websocket
        websocket_handler._connection_metadata[connection_id] = {
            "connected_at": datetime.now(timezone.utc),
            "path": "/chat",
            "session_id": session_id,
            "user_id": None
        }

        with patch.object(websocket_handler, '_notify_message_processor') as mock_notify:
            message = {
                "type": "chat_message",
                "content": "Hello, world!",
                "session_id": session_id,
                "_connection_id": connection_id,
                "_timestamp": datetime.now(timezone.utc).isoformat()
            }

            await websocket_handler._handle_chat_message(message)

        forwarded_chat_message = mock_notify.call_args[0][0]
        assert forwarded_chat_message.metadata.get("correlationId") is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd langchain_agent && bash scripts/run-pytest.sh tests/test_websocket_handler.py -v -k correlation_id`
Expected: FAIL — `AssertionError: assert None == 'corr-xyz-789'` (metadata has no `correlationId` key yet)

- [ ] **Step 3: Implement the `websocket_handler.py` change**

In `langchain_agent/src/api/websocket_handler.py`, replace the `ChatMessage` construction (originally lines 282-290):

```python
            # Create chat message
            chat_message = ChatMessage.create_user_message(
                session_id=session_id,
                content=content.strip(),
                metadata={
                    "connection_id": connection_id,
                    "message_id": message.get("message_id", str(uuid.uuid4())),
                    # Prompt Flow Inspector correlation ID — sourced at the BFF
                    # (see docs/superpowers/specs/2026-08-16-prompt-flow-inspector-design.md
                    # §1). None until the BFF-side wiring sends it.
                    "correlationId": message.get("correlationId"),
                }
            )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd langchain_agent && bash scripts/run-pytest.sh tests/test_websocket_handler.py -v -k correlation_id`
Expected: PASS (2 tests)

- [ ] **Step 5: Write the failing tests for `message_processor.py`**

In `langchain_agent/tests/test_message_processor.py`, update the existing `test_handle_chat_message` assertion (originally lines 240-244) to expect the new kwarg:

```python
        # Should process with agent (tracing path with WS streaming context)
        mock_agent.process_message_with_tracing.assert_called_once_with(
            chat_message.content,
            session_id,
            stream_context={"websocket_handler": mock_websocket_handler},
            correlation_id=None,
        )
```

Then add a new test immediately after `test_handle_chat_message` (before `test_handle_chat_message_agent_error`):

```python
    async def test_handle_chat_message_forwards_correlation_id(self, message_processor, mock_agent, mock_websocket_handler):
        """correlationId carried in chat_message.metadata reaches the agent call
        (docs/superpowers/specs/2026-08-16-prompt-flow-inspector-design.md §1)."""
        session_id = "test-session-1"
        chat_message = ChatMessage.create_user_message(
            session_id, "Hello, world!", metadata={"correlationId": "corr-abc-123"}
        )

        await message_processor._handle_chat_message(chat_message)

        mock_agent.process_message_with_tracing.assert_called_once_with(
            chat_message.content,
            session_id,
            stream_context={"websocket_handler": mock_websocket_handler},
            correlation_id="corr-abc-123",
        )
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd langchain_agent && bash scripts/run-pytest.sh tests/test_message_processor.py -v -k correlation_id`
Expected: FAIL — `AssertionError: Expected call ... to have arguments ... correlation_id=None ... Actual call: ...(chat_message.content, session_id, stream_context={...})` (missing kwarg)

Also run the pre-existing `test_handle_chat_message` to confirm it now fails for the same reason:

Run: `cd langchain_agent && bash scripts/run-pytest.sh tests/test_message_processor.py -v -k test_handle_chat_message`
Expected: FAIL (assertion mismatch — `correlation_id` kwarg missing from the actual call)

- [ ] **Step 7: Implement the `message_processor.py` change**

In `langchain_agent/src/api/message_processor.py`, replace `_handle_chat_message` (originally lines 682-705):

```python
    async def _handle_chat_message(self, chat_message: ChatMessage) -> None:
        """
        Handle a chat message by processing it with the agent.
        
        Args:
            chat_message: The chat message to handle
        """
        session_id = chat_message.session_id
        # Prompt Flow Inspector correlation ID — sourced at the BFF and carried
        # on the WebSocket message's metadata (see
        # docs/superpowers/specs/2026-08-16-prompt-flow-inspector-design.md §1).
        correlation_id = chat_message.metadata.get("correlationId")
        
        try:
            logger.info(f"Processing chat message {chat_message.id} from session {session_id}")
            
            # Send typing indicator
            await self.websocket_handler.send_message_to_session(session_id, {
                "type": "typing_start",
                "timestamp": datetime.now(timezone.utc).isoformat()
            })
            
            # Process message with agent (with real-time tracing + optional WebSocket streaming)
            response = await self.agent.process_message_with_tracing(
                chat_message.content,
                session_id,
                stream_context={"websocket_handler": self.websocket_handler},
                correlation_id=correlation_id,
            )
```

(The rest of the method, from `# Stop typing indicator` onward, is unchanged.)

- [ ] **Step 8: Run test to verify it passes**

Run: `cd langchain_agent && bash scripts/run-pytest.sh tests/test_message_processor.py -v`
Expected: PASS (all tests, including the updated `test_handle_chat_message` and new `test_handle_chat_message_forwards_correlation_id`)

- [ ] **Step 9: Commit**

```bash
git add langchain_agent/src/api/websocket_handler.py langchain_agent/src/api/message_processor.py langchain_agent/tests/test_websocket_handler.py langchain_agent/tests/test_message_processor.py
git commit -m "feat(langchain_agent): forward correlationId from the WebSocket message into process_message_with_tracing"
```

---

### Task 5: Wire hop emission into `DetailedTracingCallbackHandler`'s six start/end hooks

**Files:**
- Modify: `langchain_agent/src/agent/tracing_callback.py:1-30` (imports, `__init__`, new `_emit_hop` helper)
- Modify: `langchain_agent/src/agent/tracing_callback.py:32-66` (`on_tool_start`)
- Modify: `langchain_agent/src/agent/tracing_callback.py:68-101` (`on_tool_end`)
- Modify: `langchain_agent/src/agent/tracing_callback.py:128-156` (`on_llm_start`)
- Modify: `langchain_agent/src/agent/tracing_callback.py:158-195` (`on_llm_end`)
- Modify: `langchain_agent/src/agent/tracing_callback.py:221-244` (`on_chain_start`)
- Modify: `langchain_agent/src/agent/tracing_callback.py:246-268` (`on_chain_end`)
- Test: `langchain_agent/tests/test_tracing_callback_hop.py` (new)

**Interfaces:**
- Consumes: `redact_and_cap` from `src.agent.prompt_flow_redact` (Task 1), `emit_agent_hop` from `src.agent.prompt_flow_hop` (Task 2), `self.tracer.session_id` / `self.tracer.correlation_id` from `AgentExecutionTracer` (Task 3).
- Produces: `DetailedTracingCallbackHandler._emit_hop(self, op: str, run_id: Any, parent_run_id: Optional[Any], content_value: Any, duration_ms: Optional[int] = None, status: str = "ok") -> None`.

- [ ] **Step 1: Write the failing test**

Create `langchain_agent/tests/test_tracing_callback_hop.py`:

```python
"""Unit tests for DetailedTracingCallbackHandler's agent.step hop emission.

Verifies the callback hooks call src.agent.prompt_flow_hop.emit_agent_hop with
the expected op/session_id/correlation_id/content shape — the outgoing POST
itself is covered by test_prompt_flow_hop.py.
"""
import pytest

from src.agent import tracing_callback
from src.agent.execution_tracer import AgentExecutionTracer
from src.agent.tracing_callback import DetailedTracingCallbackHandler


@pytest.fixture
def tracer():
    return AgentExecutionTracer("sess-hop-1", correlation_id="corr-hop-1")


@pytest.fixture
def handler(tracer):
    return DetailedTracingCallbackHandler(tracer)


@pytest.fixture
def captured_hops(monkeypatch):
    calls = []

    def fake_emit_agent_hop(**kwargs):
        calls.append(kwargs)

    monkeypatch.setattr(tracing_callback, "emit_agent_hop", fake_emit_agent_hop)
    return calls


class TestChainHops:
    def test_on_chain_start_emits_hop(self, handler, captured_hops):
        handler.on_chain_start(
            {"name": "test_chain"}, {"input": "hello"},
            run_id="run-1", parent_run_id=None,
        )

        assert len(captured_hops) == 1
        hop = captured_hops[0]
        assert hop["op"] == "chain_start"
        assert hop["run_id"] == "run-1"
        assert hop["parent_run_id"] is None
        assert hop["session_id"] == "sess-hop-1"
        assert hop["correlation_id"] == "corr-hop-1"
        assert "hello" in hop["content"]

    def test_on_chain_end_emits_hop_with_duration(self, handler, captured_hops):
        handler.on_chain_start({"name": "test_chain"}, {"input": "hello"}, run_id="run-1", parent_run_id=None)
        captured_hops.clear()

        handler.on_chain_end({"output": "done"}, run_id="run-1", parent_run_id=None)

        assert len(captured_hops) == 1
        hop = captured_hops[0]
        assert hop["op"] == "chain_end"
        assert hop["duration_ms"] is not None
        assert "done" in hop["content"]


class TestToolHops:
    def test_on_tool_start_emits_hop(self, handler, captured_hops):
        handler.on_tool_start(
            {"name": "get_balance"}, '{"account_id": "acc-1"}',
            run_id="run-2", parent_run_id=None,
        )

        assert len(captured_hops) == 1
        hop = captured_hops[0]
        assert hop["op"] == "tool_start"
        assert "acc-1" in hop["content"]

    def test_on_tool_end_redacts_content(self, handler, captured_hops):
        handler.on_tool_start({"name": "get_balance"}, "{}", run_id="run-3", parent_run_id=None)
        captured_hops.clear()

        handler.on_tool_end('{"access_token": "abc123", "balance": 42}', run_id="run-3", parent_run_id=None)

        assert len(captured_hops) == 1
        hop = captured_hops[0]
        assert hop["op"] == "tool_end"
        assert "abc123" not in hop["content"]
        assert "[REDACTED]" in hop["content"]


class TestLlmHops:
    def test_on_llm_start_emits_hop(self, handler, captured_hops):
        handler.on_llm_start(
            {"name": "test-model"}, ["What is my balance?"],
            run_id="run-4", parent_run_id=None,
        )

        assert len(captured_hops) == 1
        hop = captured_hops[0]
        assert hop["op"] == "llm_start"
        assert "balance" in hop["content"]

    def test_on_llm_end_emits_hop(self, handler, captured_hops):
        from langchain_core.outputs import LLMResult, Generation

        handler.on_llm_start({"name": "test-model"}, ["hi"], run_id="run-5", parent_run_id=None)
        captured_hops.clear()

        result = LLMResult(generations=[[Generation(text="Your balance is $42")]])
        handler.on_llm_end(result, run_id="run-5", parent_run_id=None)

        assert len(captured_hops) == 1
        hop = captured_hops[0]
        assert hop["op"] == "llm_end"
        assert "42" in hop["content"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd langchain_agent && bash scripts/run-pytest.sh tests/test_tracing_callback_hop.py -v`
Expected: FAIL — `AttributeError: <module 'src.agent.tracing_callback' ...> does not have the attribute 'emit_agent_hop'` (not imported yet) on every test

- [ ] **Step 3: Write minimal implementation**

In `langchain_agent/src/agent/tracing_callback.py`, add the two new imports after the existing `from .execution_tracer import AgentExecutionTracer` line (originally line 15):

```python
from .execution_tracer import AgentExecutionTracer
from .prompt_flow_hop import emit_agent_hop
from .prompt_flow_redact import redact_and_cap
```

Add a new `_emit_hop` helper method to `DetailedTracingCallbackHandler`, immediately after `__init__` (originally lines 25-30) and before `on_tool_start`:

```python
    def __init__(self, tracer: AgentExecutionTracer):
        super().__init__()
        self.tracer = tracer
        self.tool_start_times = {}
        self.chain_start_times = {}
        self.llm_start_times = {}

    def _emit_hop(
        self,
        op: str,
        run_id: Any,
        parent_run_id: Optional[Any],
        content_value: Any,
        duration_ms: Optional[int] = None,
        status: str = "ok",
    ) -> None:
        """Forward one agent.step hop to the BFF transaction ledger.

        Fire-and-forget — never raises, never blocks the calling hook. See
        prompt_flow_hop.emit_agent_hop.
        """
        content = redact_and_cap(content_value)
        emit_agent_hop(
            op=op,
            run_id=str(run_id),
            parent_run_id=str(parent_run_id) if parent_run_id else None,
            session_id=getattr(self.tracer, "session_id", None),
            correlation_id=getattr(self.tracer, "correlation_id", None),
            content=content,
            duration_ms=duration_ms,
            status=status,
        )
```

Add one call to `self._emit_hop(...)` at the end of each of the six hooks, right after the existing `self.tracer.log_step(...)` call:

In `on_tool_start` (after the existing `self.tracer.log_step("tool_start", ...)` call, originally ending at line 66):

```python
        self.tracer.log_step("tool_start", f"Tool: {tool_name}", {
            "tool_name": tool_name,
            "input_parameters": input_params,
            "run_id": run_id,
            "parent_run_id": parent_run_id,
            "tags": tags or [],
            "metadata": metadata or {},
            "tool_category": self._categorize_tool(tool_name)
        })
        self._emit_hop("tool_start", run_id, parent_run_id, input_params)
```

In `on_tool_end` (after the existing `self.tracer.log_step("tool_end", ...)` call, originally ending at line 101):

```python
        self.tracer.log_step("tool_end", "Tool Execution", {
            "output": parsed_output,
            "raw_output": output,
            "duration_ms": duration_ms,
            "run_id": run_id,
            "parent_run_id": parent_run_id,
            "success": True,
            "output_size": len(output)
        })
        self._emit_hop("tool_end", run_id, parent_run_id, parsed_output, duration_ms=duration_ms)
```

In `on_llm_start` (after the existing `self.tracer.log_step("llm_start", ...)` call, originally ending at line 156):

```python
        self.tracer.log_step("llm_start", f"LLM: {model_name}", {
            "model_name": model_name,
            "prompt": full_prompt[:1000] + "..." if len(full_prompt) > 1000 else full_prompt,
            "prompt_count": len(prompts),
            "estimated_tokens": len(full_prompt.split()) * 1.3,
            "run_id": run_id,
            "parent_run_id": parent_run_id,
            "tags": tags or [],
            "metadata": metadata or {}
        })
        self._emit_hop("llm_start", run_id, parent_run_id, full_prompt)
```

In `on_llm_end` (after the existing `self.tracer.log_step("llm_end", ...)` call, originally ending at line 195):

```python
        self.tracer.log_step("llm_end", "LLM Response", {
            "response": response_text[:500] + "..." if len(response_text) > 500 else response_text,
            "full_response_length": len(response_text),
            "duration_ms": duration_ms,
            "token_usage": token_usage,
            "run_id": run_id,
            "parent_run_id": parent_run_id,
            "generation_count": len(response.generations) if response.generations else 0
        })
        self._emit_hop("llm_end", run_id, parent_run_id, response_text, duration_ms=duration_ms)
```

In `on_chain_start` (after the existing `self.tracer.log_step("chain_start", ...)` call, originally ending at line 244):

```python
        self.tracer.log_step("chain_start", f"Chain: {chain_name}", {
            "chain_name": chain_name,
            "inputs": inputs,
            "run_id": run_id,
            "parent_run_id": parent_run_id,
            "tags": tags or [],
            "metadata": metadata or {}
        })
        self._emit_hop("chain_start", run_id, parent_run_id, inputs)
```

In `on_chain_end` (after the existing `self.tracer.log_step("chain_end", ...)` call, originally ending at line 268):

```python
        self.tracer.log_step("chain_end", "Chain Completion", {
            "outputs": outputs,
            "duration_ms": duration_ms,
            "run_id": run_id,
            "parent_run_id": parent_run_id,
            "success": True
        })
        self._emit_hop("chain_end", run_id, parent_run_id, outputs, duration_ms=duration_ms)
```

`on_tool_error`, `on_llm_error`, and `on_chain_error` are unchanged — see "Decisions" §4 above.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd langchain_agent && bash scripts/run-pytest.sh tests/test_tracing_callback_hop.py -v`
Expected: PASS (6 tests)

Then run the full targeted set from every task in this plan together to confirm no cross-task regression:

Run: `cd langchain_agent && bash scripts/run-pytest.sh tests/test_prompt_flow_redact.py tests/test_prompt_flow_hop.py tests/test_execution_tracer.py tests/test_tracing_callback_hop.py tests/test_langchain_mcp_agent.py tests/test_websocket_handler.py tests/test_message_processor.py -v`
Expected: PASS (all tests across all seven files)

- [ ] **Step 5: Commit**

```bash
git add langchain_agent/src/agent/tracing_callback.py langchain_agent/tests/test_tracing_callback_hop.py
git commit -m "feat(langchain_agent): wire agent.step hop emission into DetailedTracingCallbackHandler"
```

---

## Self-Review

**Spec §2 "Agent" paragraph coverage:**
- "new hop emitter (Python, same shape as the TS/JS ones)" → Task 2 (`prompt_flow_hop.py`, ported field-for-field from `transactionHop.ts`: `phase`, `runId`/`parentRunId`, `correlationId`, `durationMs`, `status`, `service`, plus `op`/`details` as this layer's equivalent of the TS interface's `op`/`decision`/`identity`/`params`).
- "hooked into `tracing_callback.py`'s `on_chain_start/end`, `on_tool_start/end`, `on_llm_start/end`" → Task 5, all six hooks wired, verified by six dedicated tests plus a `TestChainHops`/`TestToolHops`/`TestLlmHops` split matching the three hook families.
- "covering agent-level reasoning steps as well as individual tool/LLM calls, not just the leaf calls" → chain hooks (agent-level reasoning) and tool/LLM hooks are all wired identically via the shared `_emit_hop` helper — none is leaf-only.
- "Phase: `agent.step`" → hardcoded as `PHASE = "agent.step"` in `prompt_flow_hop.py`, asserted in `test_posts_expected_payload_shape`.
- "`details.content` = redacted prompt/tool I/O (capped ~4000 chars)" → `_emit_hop` calls `redact_and_cap(content_value)` before handing it to `emit_agent_hop`, which places it at `payload["details"]["content"]`; cap behavior tested in Task 1.
- "`runId`/`parentRunId`/`sessionId` carried through from LangChain's own IDs" → `_emit_hop` takes LangChain's `run_id`/`parent_run_id` directly from each hook's parameters; `session_id` comes from `self.tracer.session_id` (already LangChain's `session_id`, unchanged by this plan).
- "correlationId ... threaded through" (§1, cross-referenced by §2) → Tasks 3 and 4 thread it from the incoming WebSocket message through `ChatMessage.metadata`, `message_processor`, `process_message_with_tracing`, into `AgentExecutionTracer.correlation_id`, which `_emit_hop` reads.

**Spec §3 "Redaction" coverage:**
- "Port the pattern already in `demo_api_server/utils/logRedact.js` ... into Python" → Task 1, `prompt_flow_redact.py`, function-for-function (`redactValue`→`redact_value`, `redactObject`→`redact_object`, `redactMessage`→`redact_message`, plus `redact_and_cap` as this module's addition for the capping/placeholder requirements below).
- "read that file first for the actual patterns before porting" → done; documented the SSN/card/email discrepancy in "Decisions" §1 rather than inventing patterns not present in the source file.
- "Content capped at ~4000 chars per field" → `redact_and_cap`'s `max_chars` (default `DEFAULT_MAX_CHARS = 4000`), tested in `test_caps_long_content`.
- "Redaction failure → store `"[redaction-error, content omitted]"`, never raw content on error" → `redact_and_cap`'s `except Exception: return REDACTION_ERROR_PLACEHOLDER`, tested in `test_redaction_failure_returns_placeholder`.

**Placeholder scan:** searched the plan for `TBD`, `TODO`, `implement later`, `add appropriate error handling`, `similar to Task N` — none found. Every step contains complete, runnable code (no step describes a change without showing it).

**Type/naming consistency:** `emit_agent_hop`, `redact_and_cap`, `_emit_hop`, `correlation_id` (Python) / `correlationId` (wire payload and `ChatMessage.metadata` key, matching the JSON convention every other layer's hop already uses) are spelled identically everywhere they appear across all five tasks. `AgentExecutionTracer.correlation_id` / `TracingMixin._create_tracer(..., correlation_id=...)` / `process_message_with_tracing(..., correlation_id=...)` form one unbroken chain with the same parameter name at every hop.
