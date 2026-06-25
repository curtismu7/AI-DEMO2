# AG-UI Agent Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the LangChain BFF adapter's `STATE_DELTA` shape, then add token event forwarding to the OpenAI, Pydantic AI, and Mastra BFF tool adapters so all four agents stream token chain events to the browser.

**Architecture:** Each agent's BFF tool adapter calls `/internal/agent-tool` on the BFF and receives `{ result, tokenEvents }`. Currently all but LangChain discard `tokenEvents`. We thread an `emit_fn / sink` callback from each run handler through the agent factory to the tool adapter, where it emits one `STATE_DELTA` `add` patch per token event after each tool call. The sink is the same async callable the AG-UI emitter already uses internally — no new interface.

**Tech Stack:** Python (FastAPI + httpx + pytest + respx) for OpenAI / Pydantic AI agents; TypeScript (Express + Jest) for Mastra agent; Python (LangChain + httpx + pytest) for LangChain agent.

**Spec:** [docs/superpowers/specs/2026-06-06-agui-agent-parity-design.md](../specs/2026-06-06-agui-agent-parity-design.md)

---

## File Map

| File | Change |
|---|---|
| `langchain_agent/src/agui/bff_tool_adapter.py` | Fix `replace` → per-event `add` on `/tokenEvents/-` |
| `openai_agent/src/bff_tool_adapter.py` | Accept optional `sink`, emit per-event STATE_DELTA |
| `openai_agent/src/agent_factory.py` | Accept and thread `sink` param to `build_bff_tools` |
| `openai_agent/src/run_handler.py` | Pass `sink` to `build_agent` |
| `pydantic_agent/src/bff_tool_adapter.py` | Accept optional `emit_fn`, emit per-event STATE_DELTA |
| `pydantic_agent/src/agent_factory.py` | Accept and thread `emit_fn` param to `build_tool_functions` |
| `pydantic_agent/src/run_handler.py` | Pass `emitter._emit` to `build_agent` |
| `mastra_agent/src/bffToolAdapter.ts` | Accept optional `emitFn`, emit per-event STATE_DELTA |
| `mastra_agent/src/agentFactory.ts` | Accept and thread `emitFn` to `buildBffTools` |
| `mastra_agent/src/runHandler.ts` | Extract emit fn as named var; pass to `buildAgent` |
| `langchain_agent/tests/agui/test_bff_tool_adapter.py` | New file — tests for per-event add |
| `openai_agent/tests/test_bff_tool_adapter.py` | Add token event forwarding test |
| `pydantic_agent/tests/test_bff_tool_adapter.py` | Add token event forwarding test |
| `mastra_agent/tests/bffToolAdapter.test.ts` | Add token event forwarding test |

---

## Task 1: Fix LangChain BFF adapter — per-event STATE_DELTA

The LangChain adapter already emits STATE_DELTA but uses a single `replace` patch that overwrites all prior token events on multi-tool runs. Fix: emit one `add` patch per event.

**Files:**
- Modify: `langchain_agent/src/agui/bff_tool_adapter.py:144-153`
- Create: `langchain_agent/tests/agui/test_bff_tool_adapter.py`

- [ ] **Step 1: Write the failing test**

Create `langchain_agent/tests/agui/test_bff_tool_adapter.py`:

```python
"""Tests for langchain BFF tool adapter STATE_DELTA token event emission."""
import pytest
import httpx
import respx
from src.agui.bff_tool_adapter import build_bff_tools

SCHEMA = {
    "name": "get_accounts",
    "description": "List accounts",
    "inputSchema": {"type": "object", "properties": {"userId": {"type": "string"}}},
}

BFF_URL = "http://127.0.0.1:3001/internal/agent-tool"


@pytest.mark.asyncio
@respx.mock
async def test_emits_one_add_patch_per_token_event():
    """Each token event becomes its own STATE_DELTA add patch, not a replace."""
    emitted = []

    async def sink(event: dict) -> None:
        emitted.append(event)

    respx.post(BFF_URL).mock(return_value=httpx.Response(200, json={
        "result": {"accounts": []},
        "tokenEvents": [
            {"id": "user-token", "label": "Bearer"},
            {"id": "exchanged-token", "label": "MCP"},
        ],
    }))

    tools = build_bff_tools([SCHEMA], BFF_URL, "sess_1", sink)
    await tools[0]._arun(userId="u1")

    state_deltas = [e for e in emitted if e.get("type") == "STATE_DELTA"]
    assert len(state_deltas) == 2
    for delta_event in state_deltas:
        patch = delta_event["delta"][0]
        assert patch["op"] == "add"
        assert patch["path"] == "/tokenEvents/-"


@pytest.mark.asyncio
@respx.mock
async def test_multi_tool_calls_accumulate_events():
    """Second tool call appends rather than overwrites token events."""
    emitted = []

    async def sink(event: dict) -> None:
        emitted.append(event)

    respx.post(BFF_URL).mock(return_value=httpx.Response(200, json={
        "result": {"ok": True},
        "tokenEvents": [{"id": "evt-1", "label": "First"}],
    }))

    tools = build_bff_tools([SCHEMA], BFF_URL, "sess_1", sink)
    await tools[0]._arun(userId="u1")
    await tools[0]._arun(userId="u2")

    # Two calls × one event each = two STATE_DELTA add patches, none with op=replace
    add_patches = [
        e for e in emitted
        if e.get("type") == "STATE_DELTA" and e["delta"][0]["op"] == "add"
    ]
    assert len(add_patches) == 2
    replace_patches = [
        e for e in emitted
        if e.get("type") == "STATE_DELTA" and e["delta"][0]["op"] == "replace"
    ]
    assert len(replace_patches) == 0
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd langchain_agent
.venv/bin/pytest tests/agui/test_bff_tool_adapter.py -v
```

Expected: `FAILED` — the adapter emits `replace` not `add`.

- [ ] **Step 3: Fix the adapter**

In `langchain_agent/src/agui/bff_tool_adapter.py`, replace the STATE_DELTA emission block (the `if token_events and self._sink:` block, roughly lines 147–153):

```python
        token_events = data.get("tokenEvents") or []
        if token_events and self._sink:
            for te in token_events:
                try:
                    await self._sink({
                        "type": "STATE_DELTA",
                        "delta": [{"op": "add", "path": "/tokenEvents/-", "value": te}],
                    })
                except Exception:
                    logger.exception("[BffTool] Failed to emit STATE_DELTA for tokenEvents")
```

Also update the docstring at the top of the file from:
```
   client's onStateDelta replaces /tokenEvents (not silently discarded as a plain dict).
```
to:
```
   client's onStateDelta appends each event to /tokenEvents via JSON Patch add ops.
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd langchain_agent
.venv/bin/pytest tests/agui/test_bff_tool_adapter.py -v
```

Expected: both tests `PASSED`.

- [ ] **Step 5: Commit**

```bash
git add langchain_agent/src/agui/bff_tool_adapter.py langchain_agent/tests/agui/test_bff_tool_adapter.py
git commit -m "fix(langchain): emit per-event STATE_DELTA add patches for tokenEvents"
```

---

## Task 2: OpenAI agent — thread sink, forward token events

The OpenAI adapter's `_invoke` closure currently discards `tokenEvents`. Thread `sink` from `run_handler → build_agent → build_bff_tools → _invoke`.

**Files:**
- Modify: `openai_agent/src/bff_tool_adapter.py`
- Modify: `openai_agent/src/agent_factory.py`
- Modify: `openai_agent/src/run_handler.py`
- Modify: `openai_agent/tests/test_bff_tool_adapter.py`

- [ ] **Step 1: Write the failing test**

Add to `openai_agent/tests/test_bff_tool_adapter.py`:

```python
@pytest.mark.asyncio
@respx.mock
async def test_emits_state_delta_per_token_event():
    """After a BFF call that returns tokenEvents, sink receives one STATE_DELTA add per event."""
    from src.bff_tool_adapter import build_bff_tools

    emitted = []

    async def sink(event: dict) -> None:
        emitted.append(event)

    respx.post("http://127.0.0.1:3001/internal/agent-tool").mock(
        return_value=httpx.Response(200, json={
            "result": {"accounts": []},
            "tokenEvents": [
                {"id": "user-token", "label": "Bearer"},
                {"id": "exchanged-token", "label": "MCP"},
            ],
        })
    )

    tools = build_bff_tools([TOOL_SCHEMA], RUN_CONTEXT, sink=sink)
    await tools[0].on_invoke_tool(None, '{"userId": "u1"}')

    state_deltas = [e for e in emitted if e.get("type") == "STATE_DELTA"]
    assert len(state_deltas) == 2
    for delta_event in state_deltas:
        patch = delta_event["delta"][0]
        assert patch["op"] == "add"
        assert patch["path"] == "/tokenEvents/-"
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd openai_agent
.venv/bin/pytest tests/test_bff_tool_adapter.py::test_emits_state_delta_per_token_event -v
```

Expected: `FAILED` — `build_bff_tools` does not accept `sink`.

- [ ] **Step 3: Update `openai_agent/src/bff_tool_adapter.py`**

Replace the entire file content:

```python
"""Wraps BFF /internal/agent-tool calls as OpenAI Agents SDK FunctionTool objects."""
from __future__ import annotations
import json
import logging
from typing import Any, Callable, Coroutine, Optional, TypedDict

import httpx
from agents import FunctionTool, RunContextWrapper

logger = logging.getLogger(__name__)


class BffToolError(Exception):
    pass


class RunCtx(TypedDict):
    bff_tool_url: str
    bff_internal_secret: str
    session_id: str


def build_bff_tools(
    tool_schemas: list[dict],
    run_ctx: RunCtx,
    sink: Optional[Callable[[dict], Coroutine]] = None,
) -> list[FunctionTool]:
    """
    For each tool schema from the BFF run payload, create a FunctionTool that
    POSTs to the BFF /internal/agent-tool endpoint when invoked.

    sink: async callable that receives AG-UI event dicts. When provided,
    each tokenEvent in the BFF response is emitted as a STATE_DELTA add patch.
    """
    return [_make_tool(schema, run_ctx, sink) for schema in tool_schemas]


def _make_tool(
    schema: dict,
    run_ctx: RunCtx,
    sink: Optional[Callable[[dict], Coroutine]],
) -> FunctionTool:
    tool_name = schema["name"]
    tool_description = schema.get("description", "")
    input_schema = schema.get("inputSchema", {"type": "object", "properties": {}})

    async def _invoke(ctx: RunContextWrapper, args_json: str) -> str:
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

        token_events = data.get("tokenEvents") or []
        if token_events and sink:
            for te in token_events:
                try:
                    await sink({
                        "type": "STATE_DELTA",
                        "delta": [{"op": "add", "path": "/tokenEvents/-", "value": te}],
                    })
                except Exception:
                    logger.exception("[BffTool] Failed to emit STATE_DELTA")

        return json.dumps(data.get("result", data))

    return FunctionTool(
        name=tool_name,
        description=tool_description,
        params_json_schema=input_schema,
        on_invoke_tool=_invoke,
        strict_json_schema=False,
    )
```

- [ ] **Step 4: Update `openai_agent/src/agent_factory.py`**

Replace the file content:

```python
"""Constructs the openai-agents Agent for a single run."""
from __future__ import annotations
from typing import Callable, Coroutine, Optional
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
    model: str,
    api_key: str,
    system_prompt: str | None = None,
    sink: Optional[Callable[[dict], Coroutine]] = None,
) -> Agent:
    client = AsyncOpenAI(
        api_key=api_key,
        base_url=run_ctx.get("base_url"),
    )
    tools = build_bff_tools(tool_schemas, run_ctx, sink=sink)
    return Agent(
        name="BankingAssistant",
        instructions=system_prompt or DEFAULT_SYSTEM_PROMPT,
        model=OpenAIChatCompletionsModel(model=model, openai_client=client),
        tools=tools,
    )
```

- [ ] **Step 5: Update `openai_agent/src/run_handler.py` — pass sink to build_agent**

In `_stream`, the `sink` function is already defined at line 84. Pass it to `build_agent`. Change:

```python
            agent = build_agent(
                tool_schemas=tool_schemas,
                run_ctx=run_ctx,
                model=model,
                api_key=api_key,
                system_prompt=vertical_flavor,
            )
```

to:

```python
            agent = build_agent(
                tool_schemas=tool_schemas,
                run_ctx=run_ctx,
                model=model,
                api_key=api_key,
                system_prompt=vertical_flavor,
                sink=sink,
            )
```

- [ ] **Step 6: Run all openai_agent tests to confirm passing**

```bash
cd openai_agent
.venv/bin/pytest tests/ -v
```

Expected: all tests pass including `test_emits_state_delta_per_token_event`.

- [ ] **Step 7: Commit**

```bash
git add openai_agent/src/bff_tool_adapter.py openai_agent/src/agent_factory.py openai_agent/src/run_handler.py openai_agent/tests/test_bff_tool_adapter.py
git commit -m "feat(openai-agent): forward tokenEvents as STATE_DELTA patches to AG-UI stream"
```

---

## Task 3: Pydantic AI agent — thread emit_fn, forward token events

Pydantic's `Sink = Callable[[str], Awaitable[None]]` (takes a pre-formatted SSE string). To emit dicts we use `emitter._emit` which takes a `dict` and handles SSE formatting internally.

**Files:**
- Modify: `pydantic_agent/src/bff_tool_adapter.py`
- Modify: `pydantic_agent/src/agent_factory.py`
- Modify: `pydantic_agent/src/run_handler.py`
- Modify: `pydantic_agent/tests/test_bff_tool_adapter.py`

- [ ] **Step 1: Write the failing test**

Add to `pydantic_agent/tests/test_bff_tool_adapter.py`:

```python
import pytest
import httpx
import respx
from unittest.mock import AsyncMock


@pytest.mark.asyncio
@respx.mock
async def test_emits_state_delta_per_token_event():
    """After a BFF call that returns tokenEvents, emit_fn receives one STATE_DELTA add per event."""
    from src.bff_tool_adapter import build_tool_functions

    emitted = []

    async def emit_fn(event: dict) -> None:
        emitted.append(event)

    respx.post("http://127.0.0.1:3001/internal/agent-tool").mock(
        return_value=httpx.Response(200, json={
            "result": {"accounts": []},
            "tokenEvents": [
                {"id": "user-token", "label": "Bearer"},
                {"id": "exchanged-token", "label": "MCP"},
            ],
        })
    )

    from src.models import BffDeps
    deps = BffDeps(
        bff_tool_url="http://127.0.0.1:3001/internal/agent-tool",
        bff_internal_secret="secret",
        session_id="sess_abc",
    )

    schema = {
        "name": "get_accounts",
        "description": "List accounts",
        "inputSchema": {"type": "object", "properties": {"userId": {"type": "string"}}},
    }
    tools = build_tool_functions([schema], emit_fn=emit_fn)

    from unittest.mock import MagicMock
    ctx = MagicMock()
    ctx.deps = deps
    # pydantic-ai Tool stores the original callable as .function
    await tools[0].function(ctx, userId="u1")

    state_deltas = [e for e in emitted if e.get("type") == "STATE_DELTA"]
    assert len(state_deltas) == 2
    for delta_event in state_deltas:
        patch = delta_event["delta"][0]
        assert patch["op"] == "add"
        assert patch["path"] == "/tokenEvents/-"
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd pydantic_agent
.venv/bin/pytest tests/test_bff_tool_adapter.py::test_emits_state_delta_per_token_event -v
```

Expected: `FAILED` — `build_tool_functions` does not accept `emit_fn`.

- [ ] **Step 3: Update `pydantic_agent/src/bff_tool_adapter.py`**

Replace the file content:

```python
from __future__ import annotations
from typing import Any, Callable, Coroutine, Optional
import httpx
from pydantic_ai import RunContext
from pydantic_ai.tools import Tool
from .models import BffDeps
import logging

logger = logging.getLogger(__name__)


class BffToolError(Exception):
    pass


def build_tool_functions(
    tool_schemas: list[dict],
    emit_fn: Optional[Callable[[dict], Coroutine]] = None,
) -> list[Tool]:
    """
    Build one pydantic-ai Tool per schema that calls the BFF /internal/agent-tool.

    emit_fn: async callable that receives AG-UI event dicts. When provided,
    each tokenEvent in the BFF response is emitted as a STATE_DELTA add patch.
    """
    return [_make_tool(schema, emit_fn) for schema in tool_schemas]


def _make_tool(
    schema: dict,
    emit_fn: Optional[Callable[[dict], Coroutine]],
) -> Tool:
    name: str = schema["name"]
    description: str = schema["description"]
    properties: dict = schema.get("inputSchema", {}).get("properties", {})
    param_names: list[str] = list(properties.keys())

    async def tool_fn(ctx: RunContext[BffDeps], **kwargs: Any) -> Any:
        args = {k: kwargs[k] for k in param_names if k in kwargs}
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                ctx.deps.bff_tool_url,
                json={"tool": name, "args": args, "sessionId": ctx.deps.session_id},
                headers={
                    "x-internal-gateway-secret": ctx.deps.bff_internal_secret,
                    "x-session-id": ctx.deps.session_id,
                },
                timeout=30.0,
            )
        if resp.status_code != 200:
            raise BffToolError(f"BFF returned HTTP {resp.status_code}: {resp.text[:200]}")

        data = resp.json()

        token_events = data.get("tokenEvents") or []
        if token_events and emit_fn:
            for te in token_events:
                try:
                    await emit_fn({
                        "type": "STATE_DELTA",
                        "delta": [{"op": "add", "path": "/tokenEvents/-", "value": te}],
                    })
                except Exception:
                    logger.exception("[BffTool] Failed to emit STATE_DELTA")

        return data.get("result", data)

    tool_fn.__name__ = name
    tool_fn.__doc__ = description
    return Tool(tool_fn, name=name, description=description, takes_ctx=True)
```

- [ ] **Step 4: Update `pydantic_agent/src/agent_factory.py`**

Replace the file content:

```python
from __future__ import annotations
import os
from typing import Callable, Coroutine, Optional
from pydantic_ai import Agent
from pydantic_ai.models.openai import OpenAIModel
from pydantic_ai.providers.openai import OpenAIProvider
from .bff_tool_adapter import build_tool_functions
from .models import BffDeps

_ANTHROPIC_DEFAULT_MODEL = "claude-sonnet-4-6"


def build_agent(
    tool_schemas: list[dict],
    model_name: str,
    base_url: str,
    api_key: str,
    system_prompt: str | None = None,
    provider: str = "",
    emit_fn: Optional[Callable[[dict], Coroutine]] = None,
) -> Agent:
    if provider == "anthropic":
        from pydantic_ai.models.anthropic import AnthropicModel
        anthropic_key = os.environ.get("ANTHROPIC_API_KEY", "")
        effective_model = model_name if model_name else _ANTHROPIC_DEFAULT_MODEL
        model = AnthropicModel(effective_model, api_key=anthropic_key or None)
    else:
        model = OpenAIModel(
            model_name=model_name,
            provider=OpenAIProvider(base_url=base_url, api_key=api_key),
        )
    tools = build_tool_functions(tool_schemas, emit_fn=emit_fn)
    prompt = system_prompt or (
        "You are a helpful banking assistant. "
        "Use the available tools to answer user questions accurately."
    )
    return Agent(
        model,
        deps_type=BffDeps,
        tools=tools,
        system_prompt=prompt,
        defer_model_check=True,
    )
```

- [ ] **Step 5: Update `pydantic_agent/src/run_handler.py` — pass emitter._emit to build_agent**

In `stream_events`, `emitter` is constructed with `sink`. Add `emit_fn=emitter._emit` to the `build_agent` call. Change:

```python
    agent = build_agent(
        tool_schemas,
        model_name=model,
        base_url=cfg.LLM_BASE_URL,
        api_key=cfg.LLM_API_KEY,
        system_prompt=vertical_flavor,
        provider=run_provider,
    )
```

to:

```python
    agent = build_agent(
        tool_schemas,
        model_name=model,
        base_url=cfg.LLM_BASE_URL,
        api_key=cfg.LLM_API_KEY,
        system_prompt=vertical_flavor,
        provider=run_provider,
        emit_fn=emitter._emit,
    )
```

Note: `emitter` is created inside `stream_events` as a closure variable, so it is in scope at the `build_agent` call site.

- [ ] **Step 6: Run all pydantic_agent tests to confirm passing**

```bash
cd pydantic_agent
.venv/bin/pytest tests/ -v
```

Expected: all tests pass including `test_emits_state_delta_per_token_event`.

- [ ] **Step 7: Commit**

```bash
git add pydantic_agent/src/bff_tool_adapter.py pydantic_agent/src/agent_factory.py pydantic_agent/src/run_handler.py pydantic_agent/tests/test_bff_tool_adapter.py
git commit -m "feat(pydantic-agent): forward tokenEvents as STATE_DELTA patches to AG-UI stream"
```

---

## Task 4: Mastra agent — thread emitFn, forward token events

Mastra's emit fn is an inline anonymous function in `runHandler.ts`. Extract it as a named variable so it can be passed to both `AGUIEmitter` and `buildBffTools`.

**Files:**
- Modify: `mastra_agent/src/bffToolAdapter.ts`
- Modify: `mastra_agent/src/agentFactory.ts`
- Modify: `mastra_agent/src/runHandler.ts`
- Modify: `mastra_agent/tests/bffToolAdapter.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `mastra_agent/tests/bffToolAdapter.test.ts`:

```typescript
describe('buildBffTools — token event forwarding', () => {
  it('emits one STATE_DELTA add patch per tokenEvent in the BFF response', async () => {
    const emitted: unknown[] = [];
    const emitFn = jest.fn(async (event: unknown) => { emitted.push(event); });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        result: { accounts: [] },
        tokenEvents: [
          { id: 'user-token', label: 'Bearer' },
          { id: 'exchanged-token', label: 'MCP' },
        ],
      }),
    } as any);

    const tools = buildBffTools([SCHEMA], RUN_CTX, emitFn);
    await tools[0].execute!({ userId: 'u1' }, {} as any);

    const deltas = emitted.filter((e: any) => e.type === 'STATE_DELTA');
    expect(deltas).toHaveLength(2);
    for (const d of deltas as any[]) {
      expect(d.delta[0].op).toBe('add');
      expect(d.delta[0].path).toBe('/tokenEvents/-');
    }
  });

  it('does not throw when emitFn is undefined', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: {}, tokenEvents: [{ id: 'x' }] }),
    } as any);

    const tools = buildBffTools([SCHEMA], RUN_CTX);
    await expect(tools[0].execute!({ userId: 'u1' }, {} as any)).resolves.not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd mastra_agent
npm test -- --testPathPattern='bffToolAdapter' 2>&1 | tail -20
```

Expected: `FAILED` — `buildBffTools` does not accept a third `emitFn` argument.

- [ ] **Step 3: Update `mastra_agent/src/bffToolAdapter.ts`**

Replace the file content:

```typescript
import { createTool } from '@mastra/core/tools';
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

export type EmitFn = (event: Record<string, unknown>) => Promise<void>;

export class BffToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BffToolError';
  }
}

interface JsonSchemaProperty {
  type?: string;
}

interface JsonSchemaObject {
  properties?: Record<string, JsonSchemaProperty>;
}

export function buildBffTools(
  schemas: ToolSchema[],
  runCtx: RunCtx,
  emitFn?: EmitFn,
) {
  return schemas.map((schema) => _makeTool(schema, runCtx, emitFn));
}

function _makeTool(schema: ToolSchema, runCtx: RunCtx, emitFn?: EmitFn) {
  const props = (schema.inputSchema as JsonSchemaObject).properties ?? {};
  const zodShape: Record<string, z.ZodTypeAny> = {};
  for (const [key, val] of Object.entries(props)) {
    zodShape[key] = val.type === 'number' ? z.number().optional() : z.string().optional();
  }

  const executeImpl = async (args: Record<string, unknown>) => {
    const resp = await fetch(runCtx.bffToolUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-gateway-secret': runCtx.bffInternalSecret,
        'x-session-id': runCtx.sessionId,
      },
      body: JSON.stringify({ tool: schema.name, args, sessionId: runCtx.sessionId }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new BffToolError(`BFF returned HTTP ${resp.status}: ${text.slice(0, 200)}`);
    }
    const data = (await resp.json()) as Record<string, unknown>;

    const tokenEvents = (data.tokenEvents as unknown[] | undefined) ?? [];
    if (tokenEvents.length > 0 && emitFn) {
      for (const te of tokenEvents) {
        try {
          await emitFn({
            type: 'STATE_DELTA',
            delta: [{ op: 'add', path: '/tokenEvents/-', value: te }],
          });
        } catch {
          // Non-fatal: dropped token event must not fail the tool call
        }
      }
    }

    return (data.result as Record<string, unknown> | undefined) ?? data;
  };

  return createTool({
    id: schema.name,
    description: schema.description,
    inputSchema: z.object(zodShape),
    execute: async (inputData: Record<string, unknown>) => executeImpl(inputData),
  });
}
```

- [ ] **Step 4: Update `mastra_agent/src/agentFactory.ts`**

Replace the file content:

```typescript
import { Agent } from '@mastra/core/agent';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { buildBffTools, type EmitFn, type ToolSchema, type RunCtx } from './bffToolAdapter';

const DEFAULT_INSTRUCTIONS =
  'You are a helpful banking assistant. Use the available tools to answer the user\'s questions.';

export interface LlmProviderConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  provider?: string;
}

export function buildAgent(
  toolSchemas: ToolSchema[],
  runCtx: RunCtx,
  llm: LlmProviderConfig,
  instructions?: string,
  emitFn?: EmitFn,
): Agent {
  const tools = buildBffTools(toolSchemas, runCtx, emitFn);

  const toolMap: Record<string, (typeof tools)[number]> = {};
  for (const tool of tools) {
    toolMap[tool.id] = tool;
  }

  let languageModel: unknown;
  if (llm.provider === 'anthropic') {
    const anthropicProvider = createAnthropic({ apiKey: llm.apiKey });
    const effectiveModel = llm.model.startsWith('claude') ? llm.model : 'claude-sonnet-4-6';
    languageModel = anthropicProvider(effectiveModel);
  } else {
    const openaiProvider = createOpenAI({ baseURL: llm.baseUrl, apiKey: llm.apiKey });
    languageModel = openaiProvider(llm.model);
  }

  return new Agent({
    id: 'banking-agent',
    name: 'Banking Agent',
    instructions: instructions ?? DEFAULT_INSTRUCTIONS,
    model: languageModel as unknown as never,
    tools: toolMap,
  });
}
```

- [ ] **Step 5: Update `mastra_agent/src/runHandler.ts` — extract emit fn**

In `handleRun`, the emitter is currently constructed with an inline anonymous function. Extract it as `emitFn` and pass it to both the emitter and `buildAgent`. Find this block:

```typescript
  const emitter = new AGUIEmitter(runId, threadId, async (event) => {
    res.write(formatSse(event));
  });

  try {
    await emitter.onRunStart();
    const agent = buildAgent(toolSchemas, runCtx, {
      baseUrl: cfg.llmBaseUrl,
      apiKey: cfg.llmApiKey,
      model,
      provider,
    }, verticalFlavor);
```

Replace with:

```typescript
  const emitFn = async (event: Record<string, unknown>): Promise<void> => {
    res.write(formatSse(event));
  };
  const emitter = new AGUIEmitter(runId, threadId, emitFn);

  try {
    await emitter.onRunStart();
    const agent = buildAgent(toolSchemas, runCtx, {
      baseUrl: cfg.llmBaseUrl,
      apiKey: cfg.llmApiKey,
      model,
      provider,
    }, verticalFlavor, emitFn);
```

- [ ] **Step 6: Run all mastra_agent tests to confirm passing**

```bash
cd mastra_agent
npm test 2>&1 | tail -30
```

Expected: all tests pass including the two new `bffToolAdapter` token event tests.

- [ ] **Step 7: Commit**

```bash
git add mastra_agent/src/bffToolAdapter.ts mastra_agent/src/agentFactory.ts mastra_agent/src/runHandler.ts mastra_agent/tests/bffToolAdapter.test.ts
git commit -m "feat(mastra-agent): forward tokenEvents as STATE_DELTA patches to AG-UI stream"
```

---

## Task 5: Verify — build check

No UI changes were made, but run the build to confirm no accidental regressions.

- [ ] **Step 1: Run the UI build**

```bash
cd demo_api_ui && npm run build
```

Expected: exit code 0, no errors.

- [ ] **Step 2: Run the BFF test suite**

```bash
npm run test:api-server
```

Expected: all tests pass (no BFF changes were made; this confirms nothing was broken by the adapter changes).
