# Agent Framework Technical Comparison

A technical comparison of the four AI agent implementations in this project to help you choose the right one for your use case.

---

## At a Glance

| | LangChain | Mastra | OpenAI Agents | Pydantic AI |
|---|---|---|---|---|
| **Language** | Python 3.11 | Node.js 20 / TypeScript | Python 3.11 | Python 3.11 |
| **Framework version** | LangChain >=1.3.0,<2.0.0 + LangGraph >=1.2.0,<2.0.0 | Mastra 1.37 | openai-agents 0.17 | pydantic-ai 1.107.0 |
| **Agent loop** | ReAct (LangGraph StateGraph) | Tool-calling | Tool-calling | Tool-calling |
| **LLM providers** | Helix, LM Studio, Anthropic | OpenAI-compat, Anthropic | OpenAI / OpenAI-compat | OpenAI-compat, Anthropic |
| **MCP support** | Full MCP host | None | None | None |
| **OAuth / tokens** | Manages its own (agent + user flows) | Delegated to BFF | Delegated to BFF | Delegated to BFF |
| **Conversation memory** | Per-session, with trimming | Stateless (BFF owns it) | Stateless | Stateless |
| **Invocation** | WebSocket + SSE + HTTP | HTTP SSE | HTTP SSE | HTTP SSE |
| **Port (default)** | 8888 / 8889 / 8890 | 8892 | 8891 | 8893 |
| **Tracing / observability** | Built-in trace server + callbacks | AG-UI events only | AG-UI events + token usage | AG-UI events only |
| **Horizontal scaling** | Harder (session state) | Easy | Easy | Easy |
| **Complexity** | High — production-grade | Low — simple compute | Medium | Medium |

---

## LangChain Agent

### What it is
The most complete agent in the project. Built on LangChain + LangGraph, it acts as a full **MCP host** — it manages its own OAuth tokens, discovers and connects to MCP servers, maintains per-session conversation history, and streams in real time over WebSocket or SSE.

### How the agent loop works
Uses LangGraph's `create_react_agent`, which runs a **ReAct (Reason + Act)** loop:
1. LLM receives the user message + tool list + conversation history
2. LLM decides to call a tool or produce a final response
3. If a tool call: executes via MCP, result appended to context
4. Loop repeats until the LLM produces a final answer

The loop state is checkpointed by LangGraph's `MemorySaver` keyed on `session_id`, so the full reasoning chain is recoverable.

### LLM providers
Configured via `LANGCHAIN_PROVIDER` env var:
- `helix` — Helix internal LLM (default)
- `lmstudio` — local OpenAI-compatible endpoint
- `anthropic` — Anthropic cloud API
- `anthropic-lmstudio` — Anthropic wire format via LM Studio

### MCP and tools
This is the only agent that is a real **MCP host**. It maintains an `MCPClientManager` and `MCPConnectionPool` that:
- Connects to configured MCP servers on startup
- Discovers tools dynamically on connect
- Supports WebSocket and Streamable HTTP transports
- Handles reconnection and retries

Tools surface to LangChain as `BaseTool` objects. The agent doesn't need to be restarted to pick up new tools — they're discovered at connection time.

### OAuth and tokens
Implements a full dual-token model:
- **Agent token**: Client credentials flow — the agent registers itself with PingOne/ForgeRock and gets its own access token
- **User token**: Authorization code flow — triggered on demand when an MCP server requests user-level access; the agent generates an auth URL, user completes the flow, and the token is stored in memory
- Tokens are automatically refreshed 5 minutes before expiry
- Token storage is in-memory (plain in-memory dicts via the abstract `TokenStorage` interface; encrypted storage is not yet implemented)

### Memory
Per-session conversation history stored in memory:

- **Stage 1 trim**: Message count cap (default 4096 messages, coarse)
- **Stage 2 trim**: Message count cap (default 100 messages)
- Background task evicts inactive sessions after `SESSION_TIMEOUT_MINUTES` (default 60)
- No cross-session memory

### Observability
- `DetailedTracingCallbackHandler` intercepts every LangChain step
- `ExecutionTracer` reconstructs the full reasoning chain
- Optional trace visualizer at port 8090
- Security-aware structured logging (redacts sensitive fields)
- `/inspector/mcp-host` endpoint shows live MCP registry state

### When to use
- You need an agent that manages its own OAuth tokens end-to-end
- You need MCP tool discovery (connecting to MCP servers, not just HTTP endpoints)
- You need persistent per-session conversation history
- You need detailed execution tracing and replay
- You want local LLM support via Helix or LM Studio alongside cloud providers

### Tradeoffs

- The most complex of the four — many moving parts
- Session state makes horizontal scaling harder (no distributed state by default)
- Tied to PingOne/ForgeRock for OAuth flows

---

## Mastra Agent

### What it is
A lightweight, stateless compute engine built in TypeScript with the Mastra framework. It receives everything it needs per request from the BFF — conversation history, tool schemas, session context — and streams the result back. The BFF owns all state; Mastra just runs the reasoning.

### How the agent loop works
Mastra's native **tool-calling loop** (not ReAct):
1. BFF sends: messages, tool schemas, context, session ID
2. Agent builds Mastra `Agent` + tool wrappers for this request
3. `agent.stream(userMessage)` runs: LLM picks tools or returns text
4. Each tool call is an HTTP POST to the BFF endpoint; result fed back to LLM
5. Response streamed as AG-UI SSE events

The agent is constructed **fresh per request** — no warm state between calls.

### LLM providers
Configured via `AGENT_LLM_BASE_URL` + `AGENT_LLM_MODEL` env vars:
- **OpenAI-compatible** (default): LM Studio, Groq, Together, etc. — any endpoint that speaks the OpenAI API
- **Anthropic**: Switch by passing `context.provider = "anthropic"` in the request payload — no server restart needed

### MCP and tools
No MCP support. Tools are built at runtime from BFF-provided JSON schemas via `buildBffTools()`. Each tool is a thin wrapper that POSTs to a BFF HTTP endpoint. Tool list changes with every request.

### OAuth and tokens
None. The agent passes `sessionId` as a header on tool calls; the BFF handles token lookup and exchange. The agent never sees a bearer token.

### Memory
Stateless. The BFF sends the full conversation history in the request payload on every turn. No trimming or cleanup happens in Mastra — that is the BFF's responsibility.

### Observability
AG-UI standard events only: `RUN_STARTED`, `TEXT_MESSAGE_START`, `TOOL_CALL_START`, `TOOL_CALL_END`, `RUN_FINISHED`, `RUN_ERROR`. No dedicated tracing infrastructure.

### When to use
- You want simple, horizontally scalable compute with no shared state
- You prefer TypeScript/Node.js over Python
- You want per-request model/provider switching without restarting the server
- The BFF will manage all state, tokens, and conversation history
- You want easy local LLM support via LM Studio

### Tradeoffs

- No MCP, no OAuth — you give up a lot for simplicity
- Conversation history must fit in the request payload (no server-side trimming)
- No tracing beyond AG-UI events

---

## OpenAI Agents SDK

### What it is
A stateless Python agent using OpenAI's official `openai-agents` SDK. The same BFF-owned state model as Mastra, but Python-native and tightly integrated with OpenAI's streaming event model, which gives slightly richer tool lifecycle visibility than the other stateless agents.

### How the agent loop works
OpenAI's native **tool-calling loop** via `Runner.run_streamed()`:
1. BFF sends: messages, tool schemas, context, session ID
2. `build_agent()` constructs an `Agent` with `FunctionTool` objects
3. `Runner.run_streamed()` manages the loop: LLM → tool calls → results → LLM
4. `result.stream_events()` yields typed SDK events (`RawResponsesStreamEvent`, `RunItemStreamEvent`)
5. Events mapped to AG-UI format and streamed as SSE

### LLM providers
Primarily OpenAI. Base URL override (`AGENT_LLM_BASE_URL`) allows pointing at an OpenAI-compatible endpoint. Anthropic is also supported: `run_handler.py` explicitly handles `run_provider == 'anthropic'`, routing to `https://api.anthropic.com/v1` with `claude-sonnet-4-6` as the default model.

### MCP and tools
No MCP support. Tools are `FunctionTool` objects built from BFF schemas. Each tool POSTs to the BFF on invocation.

### OAuth and tokens
None. Same as Mastra — `sessionId` header on tool calls, BFF manages tokens.

### Memory
Stateless. Conversation history is in the request payload per turn.

### Observability
Slightly better than Mastra and Pydantic because the OpenAI SDK emits structured `stream_events()` with explicit tool-call and tool-result events. Token usage is captured if the SDK provides it. Everything is surfaced via `AGUIEmitter`.

### When to use
- You want the official OpenAI SDK with its clean stream event model
- Your team is Python-native
- You expect to use OpenAI models (GPT-4o, GPT-4o-mini) in production
- You want slightly more structured tool lifecycle events than Pydantic offers

### Tradeoffs

- OpenAI-native; compat endpoints and Anthropic are supported via provider routing
- No Helix, no LM Studio natively
- Stateless like all BFF-backed agents
- No tracing beyond AG-UI events

---

## Pydantic AI Agent

### What it is
A stateless Python agent using Pydantic's own `pydantic-ai` framework (v1.107.0). Architecturally identical to the OpenAI agent — stateless, BFF-backed, SSE streaming — but built around Pydantic's type system and with native Anthropic support.

### How the agent loop works
Pydantic AI's `Agent.run_stream()`:
1. BFF sends: messages, tool schemas, context, session ID
2. `BffDeps` dataclass created (holds `bff_tool_url`, `bff_internal_secret`, `session_id`)
3. `Agent` built with LLM + tool list
4. `agent.run_stream(user_message, deps=deps)` runs the loop
5. `result.stream_text(delta=True)` yields text deltas; tool calls happen internally
6. AG-UI events emitted; response streamed as SSE

Tools receive `RunContext[BffDeps]` so they can access deps without global state.

### LLM providers
- **OpenAI-compatible** (default): LM Studio, Groq, etc. via `OpenAIModel` + `OpenAIProvider`
- **Anthropic**: Pass `context.provider = "anthropic"` — switches to `AnthropicModel` and `ANTHROPIC_API_KEY`

### MCP and tools
Native MCP support is available in pydantic-ai v1.107.0 (added in v0.0.14), but this agent does not use it. Tools are Pydantic AI `Tool` objects built from BFF schemas. Each invokes an HTTP POST to the BFF.

### OAuth and tokens
None. `session_id` flows through `BffDeps` to each tool call; BFF handles tokens.

### Memory
Stateless. Conversation history in request payload per turn.

### Observability
The least visible of the four for tool lifecycle — `Agent.run_stream()` doesn't emit explicit tool-call/tool-result events in the current version. Text deltas are streamed cleanly; tool execution happens inside the loop without surfacing as separate AG-UI events.

### When to use
- You want Anthropic + OpenAI-compat support without the complexity of LangChain
- Your codebase is Python-heavy and uses Pydantic models extensively
- You want a clean, type-safe tool invocation model (`RunContext[BffDeps]`)
- You want a stable v1.x framework with SemVer guarantees

### Tradeoffs

- Tool call lifecycle least visible of all four agents
- Stateless like all BFF-backed agents
- No tracing beyond basic AG-UI events

---

## Decision Guide

### I need full MCP tool discovery
**→ LangChain.** It's the only agent that acts as an MCP host. The others only call HTTP endpoints.

### I need the agent to handle OAuth itself
**→ LangChain.** The others all delegate token management to the BFF.

### I want local LLM support (Helix or LM Studio)
**→ LangChain** (Helix + LM Studio) or **Mastra / Pydantic AI** (LM Studio via OpenAI-compat endpoint). OpenAI Agents SDK can also point at LM Studio but isn't designed for it.

### I want the simplest possible stateless compute node
**→ Mastra** (TypeScript) or **OpenAI Agents / Pydantic AI** (Python). All three are pure request-response with no warm state.

### My team writes TypeScript
**→ Mastra.** It's the only Node.js agent.

### I use OpenAI in production and want the official SDK
**→ OpenAI Agents.** Best streaming event model for OpenAI-specific deployments.

### I want Anthropic support without LangChain complexity
**→ Pydantic AI** or **Mastra**. Both support Anthropic natively and are simpler to operate.

### I need to scale horizontally
**→ Mastra, OpenAI Agents, or Pydantic AI.** All three are stateless — any instance handles any request. LangChain's session memory makes this harder without a distributed store.

### I need full execution tracing and replay
**→ LangChain.** It has the only built-in trace server with step-by-step reasoning reconstruction.

---

## Key Architectural Difference

The most important distinction is **who owns state**:

- **LangChain** owns its own session memory, tokens, and MCP connections. It is a self-contained agent.
- **Mastra, OpenAI Agents, Pydantic AI** are stateless compute engines. The BFF sends them everything they need per request and receives the result. State, history, and tokens live in the BFF.

This means the three stateless agents are interchangeable from the BFF's perspective — swapping one for another requires no change to how the BFF constructs requests, only which endpoint it calls.
