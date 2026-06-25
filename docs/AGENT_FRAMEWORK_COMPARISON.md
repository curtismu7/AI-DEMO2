# AI Agent Framework Comparison
## LangChain · Pydantic AI · Mastra · OpenAI Agents SDK

> Last updated: 2026-05-27

---

## At a Glance

| | LangChain / LangGraph | Pydantic AI | Mastra | OpenAI Agents SDK |
|---|---|---|---|---|
| **Language** | Python + JS/TS | Python | TypeScript | Python (primary) + TS |
| **Release** | 2022 | Oct 2024 | Nov 2024 | Mar 2025 |
| **Philosophy** | Maximum integrations, composable chains | Type safety, correctness | Full-stack agent backend | Minimal surface area, OpenAI-native |
| **Orchestration model** | Graph / DAG (LangGraph) | Code-driven, dependency-injection | Workflow engine + agents | Model-driven handoffs |
| **MCP support** | 3rd-party / community | Limited | Built-in | First-class, built-in |
| **Built-in tracing** | LangSmith (opt-in, paid) | OpenTelemetry (built-in) | OpenTelemetry (built-in) | OpenAI Dashboard (on by default) |
| **Memory** | External (vectorstore) | External | Built-in (semantic + episodic) | External (no built-in) |
| **OAuth management** | DIY | DIY | Built-in connection manager | DIY (MCP OAuth supported) |
| **Vendor dependency** | Low — provider-neutral | Low — provider-neutral | Low — Vercel AI SDK abstraction | Medium-High — hosted tools are OpenAI-only |
| **Best for** | Breadth-first integrations, graph workflows | Type-safe production pipelines | TypeScript agent backends | OpenAI-stack rapid development |

---

## 1. LangChain / LangGraph

### Overview
The oldest and most widely adopted framework. Split into two packages: **LangChain** (chain/agent primitives + 700+ integrations) and **LangGraph** (explicit state machine / DAG orchestration on top of LangChain). LangGraph is now the recommended path for any non-trivial agent.

### Architecture

```
User input
  └─ Graph node (LLM call)
       └─ Conditional edge (router logic)
            ├─ Tool node (function call)
            └─ Handoff edge → next node
```

Control flow is **explicit and deterministic** — you define the graph, the edges, and the conditions. The model decides *which* tool to call; the graph decides *where* to go next.

### Strengths
- **Ecosystem breadth** — 700+ integrations: every vector DB, every LLM provider, dozens of document loaders. Switching providers is a one-line change.
- **LangGraph for deterministic workflows** — if you need provable, auditable, human-in-the-loop pipelines, the graph primitive gives you checkpointing, time-travel debugging, and explicit state management.
- **LCEL (LangChain Expression Language)** — composable pipe-syntax for building chains.
- **LangSmith** — when configured, provides excellent tracing, evals, and prompt versioning.
- **Mature community** — Stack Overflow answers, third-party tutorials, extensive examples.

### Weaknesses
- **Developer experience debt** — API surface has grown organically over three years. Multiple abstraction layers (chains, agents, runnables, LCEL) confuse new users. Deprecation warnings are common.
- **Verbose boilerplate** — comparable tasks require 3–5x more code than newer frameworks.
- **LangSmith is opt-in and paid** — tracing is not free or on-by-default.
- **Abstraction overhead** — framework wrappers around every LLM call add latency and obscure errors.
- **Type safety** — Python SDK is loosely typed; runtime surprises are common.

### MCP Support
Not first-class. Community packages exist (`langchain-mcp-adapters`) and can convert MCP tools into LangChain tools, but it requires additional setup and is not maintained by the LangChain team.

### Authentication
No built-in OAuth or connection manager. Credentials are passed directly into tool constructors or read from environment variables. Token refresh and storage are entirely the application's responsibility.

### When to Choose
- You need to integrate with an obscure data source, vector DB, or LLM provider with no official SDK.
- Your pipeline needs deterministic, auditable graph execution (LangGraph).
- Your team already has LangChain muscle memory and LangSmith instrumented.
- You are building a research/RAG pipeline with complex document ingestion.

---

## 2. Pydantic AI

### Overview
Released October 2024 by the Pydantic team. Built with the insight that most production agent bugs come from unvalidated inputs and outputs. Uses Pydantic's schema enforcement at every boundary: tool input schemas are auto-derived, structured outputs are type-checked before the calling code sees them, and the entire agent is parameterized with generics for type safety end-to-end.

### Architecture

```python
agent = Agent(
    'openai:gpt-4o',
    deps_type=MyDeps,          # dependency injection
    result_type=MyResult,      # typed output contract
    system_prompt="..."
)

@agent.tool
async def my_tool(ctx: RunContext[MyDeps], param: str) -> str:
    ...  # param is validated before this runs
```

Control flow is **code-driven**: you write async Python, call `agent.run()`, and the framework enforces types at every step. No graph DSL; orchestration is just function calls.

### Strengths
- **Strongest type safety** of any framework — Pydantic model validation on all tool inputs and all outputs; errors surface at parse time, not at `result["foo"]` KeyError.
- **Built-in OpenTelemetry tracing** — provider-agnostic, works with any OTel backend (Jaeger, Datadog, Honeycomb).
- **Dependency injection** — test and production code share the same agent; swap `MyDeps` in tests without mocking global state.
- **Provider-neutral** — OpenAI, Anthropic, Gemini, Mistral, Groq, Ollama, AWS Bedrock; switching is a string change.
- **Pydantic v2 speed** — Rust-based validation core; fast.
- **API stability commitment** (v1.0, September 2025) — SemVer guarantees.
- Caught **23 production bugs** in documented case studies that LangChain-based code missed.

### Weaknesses
- **No built-in handoff primitive** — multi-agent orchestration is manual (call one agent from another via code; no `handoffs=[]` list).
- **Small ecosystem** — ~15x fewer integrations than LangChain; no community plugin index.
- **Opinionated about Python async** — synchronous-first teams may feel friction.
- **No built-in memory** — cross-session context requires an external vector store.
- **No built-in MCP support** as of mid-2025 (community adaptors exist).

### Authentication
DIY, same as LangChain. Dependency injection makes it cleaner to inject authenticated clients, but there is no OAuth lifecycle management built in.

### When to Choose
- Type safety and correctness are non-negotiable (financial, healthcare, compliance workloads).
- You want provider neutrality with no lock-in.
- Your team is Python-first and values testable, injectable code.
- Output schema contracts must be enforced — you can't afford a field being `None` when the calling code expects a `str`.

---

## 3. Mastra

### Overview
Released November 2024 by the cofounders of Gatsby and Netlify. TypeScript-native, designed as a complete agent backend framework. 21K+ GitHub stars, 300K weekly npm downloads. Production at Replit, PayPal, Sanity, and Brex. Sits on top of the **Vercel AI SDK** abstraction layer, giving provider breadth without coupling.

### Architecture

```
Mastra
├── Agents          (LLM + tools + instructions)
├── Tools           (typed functions, auto-validated)
├── Workflows       (deterministic multi-step pipelines)
├── Memory          (semantic + episodic, built-in)
├── RAG             (document ingestion + retrieval)
├── Integrations    (OAuth connection manager)
└── Observability   (OpenTelemetry built-in)
```

Uniquely combines the "code-driven orchestration" model of Pydantic AI with a built-in **workflow engine** for deterministic pipelines, plus a built-in **connection manager** for OAuth integrations.

### Strengths
- **Most batteries-included** of the four — agents, tools, RAG, workflows, memory, and OAuth connections in one package.
- **Built-in OAuth connection management** — define an integration once; Mastra handles PKCE flows, token storage, and refresh automatically.
- **Built-in semantic + episodic memory** — agents remember past conversations and user context across sessions without an external vector DB.
- **Workflow engine** — deterministic, sequential/parallel step execution with retry logic; not LangGraph-complex but more controlled than model-driven handoffs.
- **Vercel AI SDK underneath** — 30+ model providers; switching is a config change.
- **OpenTelemetry built-in** — same observability story as Pydantic AI.
- **MCP support** — can act as both MCP client (consume MCP tools) and MCP server (expose Mastra tools over MCP).
- **TypeScript-first** — strong IDE support, type-safe tool definitions.

### Weaknesses
- **TypeScript only** — Python teams are excluded.
- **Younger than LangChain** — community resources thinner; some APIs still evolving.
- **Heavier startup** — more dependencies and services to configure than the OpenAI SDK's "four lines to running."
- **Workflow engine is simpler than LangGraph** — for complex conditional branching with checkpointing, LangGraph still wins.
- **Vercel AI SDK dependency** — adds one more abstraction layer between you and the raw provider API.

### Authentication
First-class. Mastra's integration system manages the full OAuth 2.0 lifecycle: authorization URL generation, PKCE, callback handling, token storage, and refresh. Define a connection config once; the framework handles the rest.

### MCP Integration
Native bidirectional. Mastra agents can consume tools from any MCP server, and Mastra tools can be exposed as an MCP server for other agents or clients to consume.

### When to Choose
- Your stack is TypeScript and you want an all-in-one backend framework.
- You need built-in memory without wiring up a vector DB yourself.
- You're integrating with external SaaS APIs that require OAuth (Salesforce, GitHub, Slack) — Mastra's connection manager saves significant boilerplate.
- You want both deterministic workflow steps and flexible LLM agent behavior in the same framework.

---

## 4. OpenAI Agents SDK

### Overview
Released March 2025 as the production successor to the experimental Swarm framework. Design philosophy: a working agent in four lines of code, production-grade from day one. Available in Python (`openai-agents`) and TypeScript (`@openai/agents`). Tight OpenAI platform integration — tracing on by default in the OpenAI Dashboard, hosted tools (web search, file search, code interpreter) require zero infrastructure.

### Architecture

```python
from agents import Agent, Runner

agent = Agent(
    name="Banking Assistant",
    instructions="Help users with their accounts.",
    tools=[get_balance, transfer_funds],
    handoffs=[specialist_agent],
    guardrails=[input_guardrail, output_guardrail],
)

result = await Runner.run(agent, "What's my balance?")
```

**Core primitives:**
- **Agents** — LLM + instructions + tools + handoffs + guardrails
- **Tools** — function tools, hosted OpenAI tools, MCP tools, agents-as-tools
- **Handoffs** — one-way control transfer to a specialist agent (full history passed)
- **Guardrails** — input/output validation at agent or tool level; runs in parallel with the agent for low latency
- **Tracing** — automatic span capture on every run; OpenAI Dashboard by default

### Strengths
- **Fastest time-to-working-agent** — minimal boilerplate; works on any OpenAI-compatible endpoint.
- **Tracing on by default** — zero config for OpenAI Dashboard; swap to Arize, Datadog, Langfuse, or Agenta with one `set_trace_processors()` call.
- **Hosted tools require no infrastructure** — `WebSearchTool`, `FileSearchTool`, `CodeInterpreterTool`, `ComputerTool` run on OpenAI servers; attach and go.
- **First-class MCP support** — stdio, SSE, and Streamable HTTP transports at SDK launch; hosted connectors with OAuth.
- **Guardrails as first-class primitives** — input/output guardrails plus per-tool guardrails, all running in parallel with the agent.
- **Multi-agent handoffs built-in** — specialist handoff chains or orchestrator/manager pattern (sub-agents as tools).
- **Provider-agnostic at inference** — any OpenAI-compatible Chat Completions endpoint works; 100+ LLMs via compatible APIs.
- **Full streaming** — `Runner.run_streamed()` with typed `RawResponsesStreamEvent`, `RunItemStreamEvent`, `AgentUpdatedStreamEvent`.
- **Voice / Realtime API** — Realtime API GA in 2025; bidirectional audio, interruption detection, guardrails in voice pipeline.
- **Agents-as-tools** — delegate to a sub-agent without a full handoff; caller retains control and sees the sub-agent's result.

### Weaknesses
- **Hosted tool lock-in** — `FileSearchTool`, `Threads`, and `Vector Stores` are OpenAI infrastructure only; not portable to other providers.
- **No durable memory** — no built-in cross-session context; external integration required (Mem0, a vector DB).
- **No built-in OAuth connection manager** — managing tokens for external APIs is the application's responsibility (MCP OAuth is handled for MCP-connected tools, but not for arbitrary API calls).
- **Model-driven flow** — no explicit state machine or DAG; the model decides when to hand off. Less deterministic than LangGraph or Mastra workflows.
- **TypeScript lags Python** — sandbox execution and some newer harness features arrive in Python first.
- **Vendor dependency risk** — hosted tools and tracing are commercial OpenAI services; no SLA on model availability.

### MCP Integration
First-class, built-in, no extra libraries. Three transports: `stdio`, `SSE`, `Streamable HTTP`. Hosted MCP connectors (supply a `connector_id` + access token; OpenAI handles auth). MCP tools declaring OAuth 2.0 security schemes trigger a PKCE authorization flow automatically. MCP tools are indistinguishable from function tools from the agent's perspective.

### Authentication
Three distinct layers:
1. **SDK auth** — `OPENAI_API_KEY`; no OAuth involved.
2. **MCP tool OAuth** — tools declare `securitySchemes`; the Agents SDK handles Authorization Code + PKCE, stores and forwards tokens on each call.
3. **Apps SDK / ChatGPT connector context** — full OAuth 2.1 with DCR, PKCE, `private_key_jwt`; third-party guide from Stytch documents this pattern.

For agents calling arbitrary external APIs on behalf of users (not via MCP), token management is entirely DIY.

### When to Choose
- Your team is already on OpenAI and wants the fastest path to a production agent.
- You want hosted tools (web search, code interpreter) with zero infrastructure.
- You're building multi-agent pipelines with specialist handoffs and guardrails.
- You need voice agents via the Realtime API.
- You're connecting to MCP tool servers and want built-in OAuth handling.
- You want tracing with zero configuration.

---

## Decision Matrix

| Question | Points toward... |
|---|---|
| We need to integrate with [obscure data source / vector DB] | **LangChain** |
| Our pipeline must be deterministic and auditable | **LangGraph** or **Mastra workflows** |
| Type safety and output contracts are non-negotiable | **Pydantic AI** |
| We need cross-session memory without wiring up a vector DB | **Mastra** |
| We're integrating with OAuth-protected SaaS APIs | **Mastra** |
| Our stack is TypeScript | **Mastra** |
| Our stack is Python | **Pydantic AI** or **OpenAI Agents SDK** |
| We're already on OpenAI and want the fastest start | **OpenAI Agents SDK** |
| We want voice / realtime audio agents | **OpenAI Agents SDK** |
| We want tracing on by default with no configuration | **OpenAI Agents SDK** |
| We need MCP support out of the box | **OpenAI Agents SDK** or **Mastra** |
| We need to avoid vendor lock-in | **Pydantic AI** or **LangChain** |
| We want a full-stack agent backend in one package | **Mastra** |

---

## MCP Support Summary

| Framework | MCP Client | MCP Server | Transports | Auth on MCP tools |
|---|---|---|---|---|
| LangChain | Community adapter only | No | stdio (via adapter) | DIY |
| Pydantic AI | Community adapter only | No | stdio (via adapter) | DIY |
| Mastra | Built-in | Built-in (expose Mastra tools) | stdio, HTTP | Built-in OAuth |
| OpenAI Agents SDK | Built-in | No | stdio, SSE, Streamable HTTP | PKCE OAuth built-in |

---

## Token Exchange / Delegation

For demos and platforms that use **RFC 8693 Token Exchange** (e.g., this demo app's MCP agent pipeline):

| Framework | Token exchange approach |
|---|---|
| LangChain | Fully manual — implement exchange in a custom tool pre-step |
| Pydantic AI | Fully manual — inject an authenticated client via `RunContext[MyDeps]` |
| Mastra | Mostly manual — OAuth connections handle 2-legged flows; 3-legged RFC 8693 is custom |
| OpenAI Agents SDK | Mostly manual — MCP OAuth handles tool-level auth; BFF-side token exchange (as in this demo) is custom |

In all four frameworks, the **BFF pattern** (this demo's architecture) remains the correct approach: the BFF performs the RFC 8693 exchange and forwards an MCP-scoped token to the tool server. No framework currently abstracts this specific delegation pattern.

---

## Quick Code Comparison — "Get account balance" tool

### LangChain
```python
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent

@tool
def get_balance(account_id: str) -> str:
    """Get account balance."""
    return banking_api.get_balance(account_id)

llm = ChatOpenAI(model="gpt-4o")
agent = create_react_agent(llm, [get_balance])
result = agent.invoke({"messages": [("user", "What's my balance?")]})
```

### Pydantic AI
```python
from pydantic_ai import Agent
from dataclasses import dataclass

@dataclass
class Deps:
    api_client: BankingAPIClient

agent = Agent('openai:gpt-4o', deps_type=Deps, result_type=str)

@agent.tool
async def get_balance(ctx: RunContext[Deps], account_id: str) -> str:
    return await ctx.deps.api_client.get_balance(account_id)

result = await agent.run("What's my balance?", deps=Deps(api_client=client))
```

### Mastra (TypeScript)
```typescript
import { Agent, createTool } from '@mastra/core';
import { z } from 'zod';

const getBalance = createTool({
  id: 'get_balance',
  inputSchema: z.object({ accountId: z.string() }),
  execute: async ({ context }) => bankingApi.getBalance(context.accountId),
});

const agent = new Agent({
  name: 'Banking Assistant',
  instructions: 'Help users with their accounts.',
  model: openai('gpt-4o'),
  tools: { getBalance },
});

const result = await agent.generate('What is my balance?');
```

### OpenAI Agents SDK
```python
from agents import Agent, Runner, function_tool

@function_tool
def get_balance(account_id: str) -> str:
    """Get account balance."""
    return banking_api.get_balance(account_id)

agent = Agent(
    name="Banking Assistant",
    instructions="Help users with their accounts.",
    tools=[get_balance],
)

result = await Runner.run(agent, "What's my balance?")
```

---

## Fit for This Demo App

This repo (`demo_api_server` / `demo_mcp_server`) uses a **BFF + MCP gateway** architecture with RFC 8693 token exchange. The BFF sends tool calls via HTTP JSON-RPC POST to the MCP gateway at `<gatewayBaseUrl>/mcp` (port 3005) with a delegated token. Relevant observations:

| Framework | Fit | Notes |
|---|---|---|
| LangChain | Medium | `langchain-mcp-adapters` works; verbose setup; tracing needs LangSmith |
| Pydantic AI | Good | Clean dependency injection for authenticated BFF client; type-safe tool results |
| Mastra | Good | Built-in MCP client; TypeScript-native matches `demo_mcp_server`; OAuth connections complement BFF pattern |
| OpenAI Agents SDK | Good | Built-in MCP support; hosted tools irrelevant (we run our own MCP server); tracing integrates with existing OTel |

The default/active production path in this demo app calls `runReasonLoop` against the TypeScript reasoning service at `:3006` (`demo_agent_service`), driven by `agentReasoningClient.js`. The `langchain_agent/` Python module is a separate microservice that can be selected but is not the default. A Pydantic AI implementation plan exists at [docs/superpowers/plans/2026-05-25-pydantic-agent.md](superpowers/plans/2026-05-25-pydantic-agent.md).
