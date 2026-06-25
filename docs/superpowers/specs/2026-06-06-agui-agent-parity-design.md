# Design: AG-UI Agent Parity — LangChain Fix + Token Chain for All Agents

**Date:** 2026-06-06
**Approach:** A — Surgical per-file fixes, no new files

---

## Problem Statement

Two independent gaps prevent the Token Chain panel from working correctly when using any agent runtime other than `demo_agent_service`:

1. **LangChain AG-UI path is broken.** `MessageProcessor.process_agui_message` is implemented and `bff_tool_adapter.py` exists, but `message_processor.py` imports it with `from .bff_tool_adapter` (resolves to `src/api/bff_tool_adapter.py`, which does not exist). The correct path is `src/agui/bff_tool_adapter.py`. Every LangChain AG-UI call fails with `ImportError` before the agent runs.

   Secondary bug in the same file: `BffTool._arun()` emits `{"op": "replace", "path": "/tokenEvents", "value": token_events}` — a single replace patch that overwrites all prior token events on multi-tool runs. Should be one `add` patch per event.

2. **OpenAI Agents, Pydantic AI, and Mastra discard `tokenEvents`.** The BFF's `/internal/agent-tool` response always includes a `tokenEvents` array (RFC 8693 exchange trace). All three adapters call `data.get("result", data)` and throw the rest away. The Token Chain panel stays empty for these runtimes.

---

## Architecture

### Component map

| Component | File | Change |
|---|---|---|
| LangChain import fix | `langchain_agent/src/api/message_processor.py` | `from .bff_tool_adapter` → `from ..agui.bff_tool_adapter` |
| LangChain STATE_DELTA fix | `langchain_agent/src/agui/bff_tool_adapter.py` | `replace` → per-event `add` on `/tokenEvents/-` |
| OpenAI adapter | `openai_agent/src/bff_tool_adapter.py` | Accept `sink`, emit per-event STATE_DELTA |
| OpenAI run handler | `openai_agent/src/run_handler.py` | Pass `emitter._sink` (takes `dict`) into `build_bff_tools` |
| Pydantic adapter | `pydantic_agent/src/bff_tool_adapter.py` | Accept `emit_fn`, emit per-event STATE_DELTA |
| Pydantic run handler | `pydantic_agent/src/run_handler.py` | Pass `emitter._emit` (takes `dict`) into `build_tool_functions` |
| Mastra adapter | `mastra_agent/src/bffToolAdapter.ts` | Accept `emitFn: EmitFn`, emit per-event STATE_DELTA |
| Mastra run handler | `mastra_agent/src/runHandler.ts` | Extract emit fn as named var; pass to both `AGUIEmitter` and `buildBffTools` |

### Unchanged

- `demo_agent_service` — reference impl, not touched
- `useAgentRun.js` / `BankingAgent.js` — frontend already handles STATE_DELTA correctly
- BFF STATE_SNAPSHOT injection before stream start — already correct
- All `RUN_STARTED/FINISHED`, `TEXT_MESSAGE_*`, `TOOL_CALL_*` event shapes

---

## Data Flow

```
Agent run handler
  └─ emitter = AGUIEmitter(run_id, thread_id, sink)
  └─ tools = build_bff_tools(schemas, ctx, sink=emitter._sink)
       │
       │  POST /internal/agent-tool
       │  { tool, args, sessionId }
       ▼
  BFF agentTool.js
       │  returns { result, tokenEvents: [...] }
       ▼
  tool adapter _invoke / _arun / execute
       └─ for each te in tokenEvents:
            sink({ type: "STATE_DELTA",
                   delta: [{ op: "add", path: "/tokenEvents/-", value: te }] })
       └─ return json.dumps(result)
```

The sink is the same async callable the emitter already uses internally. The STATE_DELTA reaches the browser via the SSE stream and is applied by `useAgentRun.js`'s `onStateDelta` handler, which appends to `aguiState.tokenEvents`. `BankingAgent.js` syncs that array to `tokenChain` once the run finishes.

---

## Error Handling

- If `tokenEvents` is absent or empty in the BFF response: skip emission, no error.
- If the sink call throws during STATE_DELTA emission: log and continue. A dropped token event must never fail the tool call or the agent run.
- LangChain import fix is fail-fast at server startup — wrong path = immediate `ImportError` in logs, not a silent runtime failure.

---

## Testing

### LangChain
- Fix verified by starting the agent and making a BFF-path request; the prior `ImportError` disappears.
- Existing `agui_run_handler` test confirms the `/run` route returns a stream.

### OpenAI / Pydantic / Mastra
- Each agent's existing adapter unit test gets one new assertion: after a mocked BFF response containing `tokenEvents: [{ id: "test-event" }]`, the sink receives `{ type: "STATE_DELTA", delta: [{ op: "add", path: "/tokenEvents/-", value: { id: "test-event" } }] }`.
- Multi-tool scenario: two tool calls → two separate STATE_DELTA batches → `tokenEvents` array grows, not replaced.

### No E2E changes
- `banking-agent.spec.js` already exercises the token chain display end-to-end.

---

## Success Criteria

1. LangChain AG-UI `/run` path handles a message without `ImportError`.
2. All four agents emit at least one `STATE_DELTA` with `op: add, path: /tokenEvents/-` when a tool call returns token events from the BFF.
3. Multi-tool runs accumulate token events (array grows); no event is overwritten by a later call.
4. Unit tests for all four adapters pass with the new assertion.
5. `npm run build` in `demo_api_ui` exits 0 (no frontend changes expected).
