# LangChain Agent — Improvement Opportunities & Agent Parity Report

---

## Part 1: LangChain Agent — What Can Be Better or Smaller

The LangChain agent is approximately 16,975 lines across 60 files. The core agent loop itself is roughly 500 lines. The rest is MCP integration, OAuth, session infrastructure, logging, and tests. There is real over-engineering and dead code that can come out.

### Immediate wins (remove / consolidate now)

**1. Delete dead code — ~250 LOC**

- `BasicChatAgent` (`langchain_mcp_agent.py`) — a 91-line fallback agent used when MCP tools are unavailable. It re-implements LangGraph streaming that already exists in the main path. Either initialize tools properly or raise a clear error; don't maintain a parallel agent. **Already removed — verify before applying.**
- `ConversationMemory.get_conversation_history()` (`conversation_memory.py`) — a deprecated stub that returns an empty list and logs a warning. LangGraph's `MemorySaver` handles checkpoints; this method should just be deleted. **Already removed — verify before applying.**
- `_create_banking_tool_schema()` (`mcp_tool_provider.py`) — marked "not used" in source. Dead. **Already removed — verify before applying.**

**2. Merge duplicate response formatters — ~200 LOC**

`MCPTool` has formatting methods in `mcp_tool_provider.py`. `MCPToolProvider` has static copies of the same logic in the same file. They exist because the two classes evolved separately. Extract to a single `ResponseFormatter` class. *(Line numbers approximate — verify before applying.)*

**3. Simplify the system message builder — ~80 LOC**

`_build_system_message()` in `langchain_mcp_agent.py` is 99 lines of string concatenation, with tool schema extraction done via reflection. It should be a Jinja2 template or a dedicated `PromptBuilder` class. The current approach is fragile and untestable. *(Line numbers approximate — verify before applying.)*

**4. Replace hand-rolled retry logic — ~50 LOC**

`oauth_manager.py` implements exponential backoff with hardcoded `asyncio.sleep()` calls. The `tenacity` library is already a common Python dependency and does this in one decorator. *(Line numbers approximate — verify before applying.)*

---

### Short-term simplifications (next sprint)

**5. Split `process_message_with_tracing()` — ~150 LOC saved**

This single method in `langchain_mcp_agent.py` is 362 lines. It handles: message classification, OAuth completion retry, user identification, tool initialization, graph execution, and response post-processing. Each of those is a separable concern. Splitting saves ~150 lines of logic duplication with `process_message()`, which does the same session setup. *(Line numbers approximate — verify before applying.)*

**6. Extract auth challenge handling from `MCPTool._arun()`**

`_arun()` in `mcp_tool_provider.py` is 249 lines. Approximately 82 lines handle the HITL/OAuth challenge flow. This is a separate concern from tool execution and should be an `AuthChallengeHandler` class. The method should delegate there and focus on: extract params → execute → format result. *(Line numbers approximate — verify before applying.)*

**7. Unify message classification**

Three separate methods in `langchain_mcp_agent.py` — `_is_authorization_complete_message`, `_detect_authorization_code`, `_looks_like_email` — each do regex/string matching independently. Replace with a single classifier that returns an enum. Saves ~70 lines and makes it easier to add new message types without touching multiple methods. *(Line numbers approximate — verify before applying.)*

**8. Fix unreachable trimming code**

`conversation_memory.py` Stage-1 token trim is unreachable in configurations where `max_context_tokens >= max_messages_per_session`. Enforce `max_context_tokens < max_messages_per_session` in `__init__` with a hard error. Remove the unreachable branch. Also switch from `len()` as the token counter to the actual LLM tokenizer — currently the "token" count is just character count. *(Line numbers approximate — verify before applying.)*

**9. Simplify LLM provider factory**

`llm_factory.py` is a chain of `if/elif` blocks, each one importing a different `ChatXXX` class and constructing it. Replace with a provider registry dict:

```python
PROVIDERS = {
    "helix":     (HelixChatModel,  helix_kwargs),
    "lmstudio":  (ChatOpenAI,      lmstudio_kwargs),
    "anthropic": (ChatAnthropic,   anthropic_kwargs),
    "llamacpp":  (ChatOpenAI,      llamacpp_kwargs),
    # ... other providers already present in the factory
}
```

This removes ~60 lines and makes adding a new provider a one-liner. *(Note: `anthropic` and `llamacpp` providers are already present in the factory — include them in the registry. Line numbers approximate — verify before applying.)*

---

### Medium-term architectural improvements

**10. Proper `SessionChallengeStore`**

`mcp_tool_provider.py` lines 592–612 access `_session_challenges` directly as a dict via private attribute access. Replace with a `SessionChallengeStore` class with TTL eviction and a clean public API. Fixes a concurrency risk and removes the private-attribute coupling.

**11. ConversationMemory async safety**

The `defaultdict(list)` backing the conversation store has no async locking. It works today because Python's GIL protects individual dict operations, but message ordering within a session is not guaranteed under concurrent appends. Add an `asyncio.Lock` per session or use a thread-safe structure.

**12. Auto-start cleanup task**

`conversation_memory.py` has a `start_cleanup_task()` method that must be called explicitly. If it isn't called in production, inactive sessions accumulate forever. Move it to `__init__` with an option to disable for testing.

---

### What to leave alone

- The **per-session worker queue** (`message_processor.py`) — complex but correct. It guarantees message ordering within a session while allowing cross-session concurrency. The 1-hop latency is worth it.
- The **MCPConnectionPool and retry/reconnect logic** — MCP WebSocket connections drop; the pool handles this correctly. Don't simplify away the resilience.
- The **dual streaming paths** (WebSocket + SSE/AG-UI) — both are used by different consumers.

---

### Summary table

| Issue | File | Lines | Action | Saves |
|---|---|---|---|---|
| Delete BasicChatAgent | langchain_mcp_agent.py | — | **Already removed** | ~91 LOC |
| Delete deprecated get_conversation_history | conversation_memory.py | — | **Already removed** | ~14 LOC |
| Delete _create_banking_tool_schema | mcp_tool_provider.py | — | **Already removed** | ~41 LOC |
| Merge duplicate formatters | mcp_tool_provider.py | approx. (verify) | Extract ResponseFormatter | ~200 LOC |
| System message template | langchain_mcp_agent.py | approx. (verify) | Jinja2 template | ~80 LOC |
| Replace retry logic | oauth_manager.py | approx. (verify) | Use tenacity | ~50 LOC |
| Split process_message_with_tracing | langchain_mcp_agent.py | approx. (verify) | Extract sub-methods | ~150 LOC |
| Extract auth challenge handler | mcp_tool_provider.py | approx. (verify) | AuthChallengeHandler | ~80 LOC |
| Unify message classifier | langchain_mcp_agent.py | approx. (verify) | Single classifier enum | ~70 LOC |
| Provider factory dict | llm_factory.py | approx. (verify) | Registry dict | ~60 LOC |
| **Total (remaining work)** | | | | **~690 LOC** |

Removing ~690 lines of production code (not tests) while keeping all functionality (the 146 LOC of dead code already removed). All line numbers are approximate — verify against current source before applying.

---

## Part 2: Bringing the Other Agents Up to LangChain's Capabilities

The other three agents (Mastra, OpenAI Agents, Pydantic AI) are 99–163 lines each. They are stateless compute nodes — the BFF owns all state, tokens, and conversation history. LangChain owns all of that itself.

This section covers what it would actually take to add each LangChain capability to the other three.

---

### Capability 1: MCP Host Support

**What LangChain does:** Maintains persistent WebSocket connections to MCP servers. Discovers tools dynamically on connect. Tools surface as native LangChain `BaseTool` objects. Handles reconnection, connection pooling, and per-server auth.

**What the others do:** None. Their "tools" are HTTP POST calls to the BFF.

| Agent | Feasibility | Effort | Notes |
|---|---|---|---|
| OpenAI Agents | Yes | ~2,000 LOC | Build MCPClientManager equivalent using `mcp` Python library; convert tool schemas to `FunctionTool`; add connection lifecycle management |
| Pydantic AI | Yes | ~500–800 LOC | pydantic-ai 1.107.0+ has native MCP support; adapter wiring and connection lifecycle management still required but scaffolding cost is much lower |
| Mastra | Yes | ~1,500 LOC (TS) | Mastra has experimental MCP support; the scaffolding is closer |

**80% solution (much cheaper):** Add an MCP sidecar proxy alongside each agent. The agent still calls HTTP, but the sidecar translates those calls to MCP. Zero changes to the agent itself. This gives MCP tool access without turning each agent into a full MCP host.

---

### Capability 2: OAuth / Token Management

**What LangChain does:** Runs its own OAuth client credentials flow (agent identity). Initiates authorization code flow on demand (user identity). Stores tokens in session (AES-128-GCM encryption is not yet implemented). Auto-refreshes 5 minutes before expiry. Supports dynamic client registration with PingOne/ForgeRock.

**What the others do:** None. They pass `sessionId` to the BFF and let it handle everything.

| Agent | Feasibility | Effort | Notes |
|---|---|---|---|
| OpenAI Agents | Yes | ~300 LOC | Port `oauth_manager.py` to Python; integrate token refresh into tool call pipeline |
| Pydantic AI | Yes | ~300 LOC | Same; `RunContext[BffDeps]` pattern makes injection clean |
| Mastra | Yes | ~400 LOC (TS) | TypeScript port; use `node-oauth2` or similar |

**80% solution:** BFF pre-provisions short-lived tokens and includes them in the `/run` payload. Agent passes them as headers on tool calls. No refresh logic needed for requests that complete in under 5 minutes. This covers the majority of use cases with zero new agent code.

---

### Capability 3: Conversation Memory

**What LangChain does:** Maintains per-session message history in memory. Two-stage trimming: token count cap (coarse), then message count cap. LangGraph `MemorySaver` checkpoints the reasoning state. Background cleanup evicts inactive sessions.

**What the others do:** None. BFF sends full history in each request payload. No trimming happens in the agent.

| Agent | Feasibility | Effort | Notes |
|---|---|---|---|
| OpenAI Agents | Yes | ~500 LOC | Add session dict; trim messages before each `Runner.run_streamed()` call; background cleanup task |
| Pydantic AI | Yes | ~500 LOC | Same; attach to FastAPI lifespan for cleanup |
| Mastra | Yes | ~500 LOC (TS) | Same; Node.js `Map` for sessions; `setInterval` for cleanup |

**80% solution:** BFF sends last N messages (sliding window, e.g. last 20). Agent receives a pre-trimmed history — no trimming logic needed in the agent. This is already how the three stateless agents work today; just tune N in the BFF.

**Important:** Adding server-side memory to the stateless agents breaks their horizontal scaling story. Once an agent has session state, you need sticky sessions or a shared store (Redis). This is a real trade-off, not a free upgrade.

---

### Capability 4: Execution Tracing and Observability

**What LangChain does:** `DetailedTracingCallbackHandler` intercepts every LangChain step. `ExecutionTracer` reconstructs the full reasoning chain. Optional HTML trace visualizer on port 8090. Security-aware structured logging that redacts sensitive fields. `/inspector/mcp-host` endpoint shows live MCP registry state.

**What the others do:** AG-UI standard events only (`TOOL_CALL_START`, `TOOL_CALL_END`, `TEXT_MESSAGE_CONTENT`). No structured logs. No trace replay.

| Agent | Feasibility | Effort | Notes |
|---|---|---|---|
| OpenAI Agents | Easy | ~400 LOC | The SDK already emits typed stream events; hook them into a trace collector; write a viewer |
| Pydantic AI | Easy | ~400 LOC | Text deltas stream cleanly; tool lifecycle is less visible (events not emitted separately today) |
| Mastra | Easy | ~400 LOC (TS) | `stream.fullStream` already has `text-delta`, `tool-call`, `tool-result` parts; easy to wire |

**80% solution:** Wire AG-UI events into an external collector (Jaeger, Datadog, Langfuse). No custom trace server needed. All three agents already emit structured AG-UI events — they just don't persist or visualize them.

---

### Capability 5: WebSocket + Per-Session Workers

**What LangChain does:** Accepts WebSocket connections from browser clients. Maintains per-session worker queues to guarantee message ordering within a session while allowing cross-session concurrency. Supports real-time token streaming to the browser.

**What the others do:** HTTP POST `/run` → SSE response. Single request/response cycle. No WebSocket.

| Agent | Feasibility | Effort | Notes |
|---|---|---|---|
| OpenAI Agents | Yes | ~800 LOC | Add WebSocket endpoint; per-session queue; adapt SSE emitter to WebSocket send |
| Pydantic AI | Yes | ~800 LOC | Same with FastAPI WebSocket |
| Mastra | Yes | ~800 LOC (TS) | Express + `ws` library; same per-session queue pattern |

**80% solution:** The BFF already holds the WebSocket connection with the browser and translates it to HTTP calls to the agent. This is the current architecture. Adding WebSocket to the stateless agents would duplicate the BFF's job — probably not worth it.

---

### Full parity cost summary

To bring each stateless agent to full LangChain capability parity:

| Capability | OpenAI Agents est. LOC | Pydantic AI est. LOC | Mastra est. LOC | OpenAI Agents effort | Pydantic AI effort | Mastra effort |
| --- | --- | --- | --- | --- | --- | --- |
| MCP Host | ~2,000 | ~500–800 | ~1,500 | High | Medium | Medium |
| OAuth management | ~300 | ~300 | ~400 | Medium | Medium | Medium |
| Conversation memory | ~500 | ~500 | ~500 | Medium | Medium | Medium |
| Tracing / observability | ~400 | ~400 | ~400 | Low | Low | Low |
| WebSocket + sessions | ~800 | ~800 | ~800 | Medium | Medium | Medium |
| **Total** | **~4,000 LOC** | **~2,500–2,800 LOC** | **~3,600 LOC** | **High** | **Medium-High** | **Medium-High** |

That is roughly 2,500–4,000 lines of new code per agent depending on framework, plus ongoing maintenance. The stateless agents would each become roughly 10–20× their current size. *(Note: pydantic-ai 1.107.0 includes native MCP support, which substantially reduces the MCP host implementation cost for that agent.)*

---

### The honest recommendation

**Don't make the stateless agents match LangChain.** They exist to show different frameworks, not to be production-grade alternatives. The BFF-delegation model is a valid architecture — it centralises state, simplifies the agents, and makes them easy to swap.

**Do these instead:**

1. **For MCP tool access from stateless agents** — use the 80% MCP sidecar proxy solution. Lets any agent call MCP tools without becoming a full host.

2. **For tracing** — wire AG-UI events from all four agents into a shared trace collector. Low effort, high value, works with the existing event model.

3. **For conversation memory** — tune the BFF's sliding-window history. The stateless agents already receive it; you get memory behaviour without server-side state.

4. **Clean up LangChain first** — the ~836 lines of dead code and duplication identified in Part 1 are the highest-value, lowest-risk work. Do that before adding capabilities anywhere.

---

### What LangChain has that is genuinely irreplaceable

If you need any of the following, LangChain (or a comparable stateful architecture) is the right choice — the 80% shortcuts don't cover it:

- **Long-running agent sessions** that span multiple user turns with full reasoning state preserved between them
- **OAuth flows initiated by the agent itself** (dynamic client registration, user authorization code flow)
- **MCP tool discovery** — connecting to an MCP server and finding out what tools it offers at runtime
- **Full execution trace replay** — stepping through the agent's reasoning chain after the fact for debugging or audit
