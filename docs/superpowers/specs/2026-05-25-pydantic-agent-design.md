# PydanticAI Agent — Design Spec

**Date:** 2026-05-25  
**Status:** Approved  
**Author:** Curtis Muir (via brainstorm session)

---

## 1. Goal

Add a second, fully independent AI agent service to the banking demo built with [PydanticAI](https://pydantic.dev/docs/ai/overview/). It runs side-by-side with the existing LangChain/LangGraph agent, is selectable from the UI via `AgentModeSelector`, and showcases PydanticAI's structured output and type-safety strengths through a purpose-built React component.

The existing `langchain_agent/` service is untouched.

---

## 2. Architecture Overview

### Directory layout

```
pydantic_agent/                    # New top-level directory
├── src/
│   ├── main.py                    # Entry point — PydanticAIApplication class
│   ├── agent/
│   │   ├── banking_agent.py       # PydanticAI Agent definition, tools, system prompt
│   │   ├── agent_runner.py        # Run/stream agent turns, session memory
│   │   └── llm_factory.py        # Provider factory (Helix, Ollama, LM Studio, Anthropic)
│   ├── api/
│   │   ├── websocket_handler.py   # WebSocket server, new wire protocol
│   │   ├── message_processor.py   # Per-session worker pool (WR-02 pattern)
│   │   └── health.py              # GET /health, GET /inspector
│   ├── mcp/
│   │   ├── client.py              # PydanticAI MCPServerHTTP wrapper + auth headers
│   │   └── auth_challenge.py      # AuthChallenge state machine (CSRF, popup, resume)
│   ├── authentication/
│   │   └── oauth_manager.py       # Client credentials + PKCE
│   ├── config/
│   │   └── settings.py            # Dataclasses: AgentConfig, ChatConfig, MCPConfig
│   └── models/
│       └── messages.py            # Wire protocol message types (Pydantic models)
├── tests/
├── requirements.txt               # pydantic-ai, fastapi, uvicorn, httpx, pyjwt
└── README.md
```

### Ports

| Service | Port | Protocol |
|---|---|---|
| Chat WebSocket | **8893** | WebSocket |
| Health check | **8894** | HTTP |

These ports do not conflict with any existing service (see `REGRESSION_PLAN.md §3`).

### Key constraints

- `pydantic_agent/` has zero imports from `langchain_agent/`. Fully self-contained.
- `run.sh` gains a new entry in `SVC_LIST` so the agent starts/stops/status with the rest of the stack.
- Depends on Phase 277 (`StreamableHttpMCPConnection`) — confirmed shipped. `demo_mcp_server` already exposes `POST /mcp`.
- `pydantic-ai` is not yet installed; `requirements.txt` is greenfield.

---

## 3. PydanticAI Agent Core

### Agent definition (`banking_agent.py`)

```python
from pydantic_ai import Agent
from pydantic_ai.mcp import MCPServerHTTP

banking_agent = Agent(
    model=llm_factory.get_model(),
    mcp_servers=[MCPServerHTTP(
        url="http://localhost:8080/mcp",   # demo_mcp_server Streamable HTTP endpoint
        headers=lambda: {"Authorization": f"Bearer {oauth_manager.get_agent_token()}"}
    )],
    system_prompt=build_system_prompt(),
    result_type=AgentResponse,
)
```

### Structured output types

```python
class ToolCall(BaseModel):
    tool_name: str
    args: dict[str, Any]
    result: dict[str, Any] | None = None
    duration_ms: int | None = None

class ReasoningStep(BaseModel):
    step_index: int
    thought: str

class AgentResponse(BaseModel):
    final_text: str
    tool_calls: list[ToolCall] = []
    reasoning_steps: list[ReasoningStep] = []
```

### Session memory

PydanticAI does not have a built-in equivalent of LangGraph's `MemorySaver`. Session history is maintained in `agent_runner.py` as a per-`session_id` dict of `list[ModelMessage]` (PydanticAI's native message type), passed into each `agent.run()` call via `message_history`. In-process only — same pattern as `langchain_agent`'s `ConversationMemory`. Cleanup loop reaps idle sessions after 900s (configurable).

### LLM providers (`llm_factory.py`)

| Provider | PydanticAI model string | Config |
|---|---|---|
| Anthropic (direct) | `anthropic:claude-sonnet-4-6` | `ANTHROPIC_API_KEY` |
| Ollama | `ollama:llama3.2` | `OLLAMA_BASE_URL` |
| LM Studio (OpenAI-compat) | `openai:<model>` + custom base URL | `LMSTUDIO_BASE_URL` |
| LM Studio (Anthropic-compat) | `anthropic:<model>` + custom base URL | `LMSTUDIO_ANTHROPIC_BASE_URL` |
| Helix | Custom `HelixModel(Model)` subclass | `HELIX_*` env vars |

Provider resolution mirrors `langchain_agent/src/agent/llm_factory.py` — read `AGENT_PROVIDER` env var, default to `helix`.

### Auth challenge flow

When the MCP server returns an auth challenge during a tool call:

1. `mcp/auth_challenge.py` intercepts the challenge response.
2. Sends `auth_challenge` WebSocket message to the UI (includes `authorization_url`, `scope`, `state` CSRF token).
3. Pauses execution by awaiting an `asyncio.Event` inside the tool function (the tool blocks until the event is set or the timeout fires).
4. UI opens the PingOne popup; user authorizes.
5. UI sends `auth_response { code, state }` over WebSocket.
6. `auth_challenge.py` validates the CSRF state, resolves the `asyncio.Event`.
7. Tool call resumes with the user's auth code injected into the next MCP request header.
8. Timeout: 120s. On timeout, `error { code: "auth_timeout" }` is sent and the turn is cancelled.

CSRF state tokens are `secrets.token_urlsafe(32)` — not predictable (mirrors WR-11 from `langchain_agent`).

---

## 4. Wire Protocol

All messages are Pydantic models serialised as JSON over WebSocket. Every message has a `type` discriminator field.

### Client → Server

| Type | Fields |
|---|---|
| `chat_message` | `session_id`, `content`, `user_token?` |
| `auth_response` | `session_id`, `code`, `state` |
| `ping` | — |

### Server → Client

| Type | Fields | Notes |
|---|---|---|
| `connected` | `session_id`, `agent_version: "pydantic"` | On WebSocket connect |
| `error` | `code`, `message` | Any error |
| `pong` | — | Response to ping |
| `turn_start` | `session_id`, `turn_id` | UUID per turn |
| `turn_complete` | `session_id`, `turn_id`, `final_text` | Turn finished |
| `token_delta` | `turn_id`, `delta` | LLM token streaming |
| `tool_start` | `turn_id`, `tool_name`, `args: dict` | Typed args object |
| `tool_result` | `turn_id`, `tool_name`, `result: dict`, `duration_ms` | Typed result object |
| `tool_error` | `turn_id`, `tool_name`, `error` | Tool call failed |
| `auth_challenge` | `turn_id`, `authorization_url`, `scope`, `expires_at`, `state` | User consent required |
| `reasoning_step` | `turn_id`, `step_index`, `thought` | Agent reasoning exposed |

Key differences from LangChain agent protocol:
- `tool_start.args` and `tool_result.result` are **typed objects**, not raw strings.
- `reasoning_step` exposes intermediate thinking as discrete numbered steps.
- `turn_id` (UUID) groups all events for one agent response — allows ordered rendering.
- `agent_version: "pydantic"` on `connected` tells the UI which component to mount.

---

## 5. React UI Component

### Component tree

```
PydanticAgent
├── PydanticAgentHeader          # "PydanticAI Agent" label + connection status
├── MessageThread
│   └── MessageBubble (per turn)
│       ├── ReasoningSteps       # Collapsible accordion — "Agent reasoning (N steps)"
│       │   └── ReasoningStep    # Numbered step + thought text
│       ├── ToolCallCards        # One card per tool_start/tool_result pair
│       │   └── ToolCallCard
│       │       ├── ToolName     # e.g. "get_account_balance"
│       │       ├── ArgsTable    # typed key/value pairs from tool_start.args
│       │       ├── ResultTable  # typed key/value pairs from tool_result.result
│       │       └── Duration     # "42ms" badge
│       └── FinalAnswer          # final_text from turn_complete, clearly separated
├── AuthChallengeModal           # Reuses existing modal pattern
├── ChatInput                    # Text input + send button
└── StreamingIndicator           # Animated dots while turn_id is active
```

### WebSocket client

New `pydanticAgentWebSocket.js` service — singleton, manages one WebSocket to port 8893, reconnects on drop, dispatches events by `type` to registered handlers. Mirrors the pattern of `bffAxios.js` (import once, use everywhere).

### State model

Each turn is modelled as a structured object in React state:

```js
{
  turnId: string,
  reasoningSteps: [{ stepIndex, thought }],
  toolCalls: [{ toolName, args, result, durationMs }],
  partialText: string,   // accumulates token_delta events
  finalText: string,     // set on turn_complete
}
```

Events from the WebSocket update this model in place. Components render directly from it — no string concatenation.

### AgentModeSelector update

Adds a third tab "PydanticAI" alongside "Helix" and "LangChain". Selecting it mounts `PydanticAgent` in the existing panel slot. No other UI changes.

### Styling

- Light background (`#f8f9fa` / white)
- Blue accent (`#2563eb` / `#dbeafe`)
- Tool call cards: white body, blue header, subtle border + shadow
- Reasoning accordion: light blue background when expanded
- Final answer: light green background with `✅` label
- No emoji beyond `⚠️ ✅ ❌` (CLAUDE.md rule 4)
- CSS only — no new icon libraries

---

## 6. Error Handling

| Scenario | Behaviour |
|---|---|
| MCP server unavailable at startup | Agent starts with empty tool list; `error { code: "mcp_unavailable" }` sent on first tool call |
| Auth challenge timeout (>120s) | Turn cancelled; `error { code: "auth_timeout" }` sent; session stays alive |
| LLM provider failure | `error { code: "llm_error", message }` sent; turn ends cleanly; server does not crash |
| WebSocket disconnect mid-turn | Per-session worker detects cancelled task, drops in-flight turn, reaps worker |
| PydanticAI `AgentResponse` validation failure | Retried once automatically; then `error { code: "validation_error" }` |

---

## 7. Testing Strategy

Two-tier pattern (matches `CLAUDE.md` test patterns):

| Layer | File | Focus |
|---|---|---|
| Unit | `test_banking_agent.py` | Agent init, system prompt, `AgentResponse` model validation |
| Unit | `test_llm_factory.py` | Provider resolution, config validation |
| Unit | `test_auth_challenge.py` | CSRF state machine, timeout, resume |
| Unit | `test_message_processor.py` | Per-session worker ordering, idle reaper |
| Unit | `test_wire_protocol.py` | All message types serialise/deserialise correctly |
| Integration | `test_integration_agent.py` | Agent + mocked MCP server, full turn lifecycle |
| Integration | `test_integration_websocket.py` | WebSocket connect → chat → disconnect flow |

MCP server mocked via `httpx.MockTransport` — no live `demo_mcp_server` needed in unit/integration tests. LLM calls mocked via PydanticAI's `TestModel`.

---

## 8. run.sh Integration

`pydantic_agent` added to `SVC_LIST` in `run.sh` with:

```bash
# Service: pydantic_agent
# Port: 8893 (WebSocket) + 8894 (health)
# Install: pip install -r requirements.txt
# Build: none
# Start: uvicorn src.main:app --port 8893
```

`./run.sh status` health-checks `http://localhost:8894/health`.

---

## 9. Dependencies on Other Phases

| Dependency | Status | Notes |
|---|---|---|
| Phase 277 Streamable HTTP (`POST /mcp`) | **Shipped** | `HttpMCPTransport.ts` + `StreamableHttpMCPConnection` both exist |
| `pydantic-ai` package | **Not installed** | First task in implementation plan |

No dependency on Phases 273, 274, 275, 281 — those are LangChain agent concerns only.

---

## 10. Out of Scope

- Sharing code between `pydantic_agent/` and `langchain_agent/` — each is self-contained.
- Side-by-side comparison mode (both agents simultaneously) — future enhancement.
- Human-in-the-loop via PydanticAI's native interrupt primitive — auth challenge reuses the existing WebSocket popup flow (Approach A).
- Vercel deployment of `pydantic_agent` — runs locally / Docker only, same as `langchain_agent`.
