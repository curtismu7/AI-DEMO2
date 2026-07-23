# Multi-Framework Agent Ecosystem

Current map of agent **framework packages** and **LLM brains** in this demo.
Ping identity / Authorize / MCP stay the same regardless of which package or brain runs the turn.

> Last updated: 2026-07-22

## Overview

| Layer | What you pick | Where |
|-------|---------------|--------|
| **Framework** | Which agent runtime handles AG-UI `/run` | Feature flag `llm_framework` |
| **Brain** | Heuristics vs cloud/local LLM | Agent mode picker (`agentModes.js`) |

Banking chat UI (`AIAgent`) is framework-agnostic: the BFF routes to the selected package and streams AG-UI SSE back.

## Architecture (simplified)

```
┌────────────────────────────────────────────────────────────┐
│  demo_api_ui — AIAgent (framework-agnostic)                │
│  Brain picker: Heuristics · Gemini · llama.cpp · …         │
└──────────────────────────┬─────────────────────────────────┘
                           │
┌──────────────────────────▼─────────────────────────────────┐
│  demo_api_server (BFF) :3001                               │
│  llm_framework → langchain | openai_agents | mastra |      │
│                  pydantic_ai                               │
└───────┬────────────┬────────────┬────────────┬─────────────┘
        │            │            │            │
   :8888         :8891        :8892        :8893
 langchain_   openai_      mastra_     pydantic_
   agent        agent        agent        agent

Also (not llm_framework):
  llamaindex_agent :8894  — RAG / codebase (Compose profile `rag`)
  compliance_agent :3007  — AML / risk specialist (Pydantic AI)
  demo_llm_proxy   :8090  — local llama.cpp router for brain=llamacpp
```

## Framework packages (`llm_framework`)

| Directory | Flag value | Port | Language | Role |
|-----------|------------|------|----------|------|
| `langchain_agent/` | `langchain` (default) | 8888 | Python | Default banking AG-UI runtime (LangGraph ReAct) |
| `openai_agent/` | `openai_agents` | 8891 | Python | OpenAI Agents SDK AG-UI variant |
| `mastra_agent/` | `mastra` | 8892 | TypeScript | Mastra + Vercel AI SDK AG-UI variant |
| `pydantic_agent/` | `pydantic_ai` | 8893 | Python | Pydantic AI DI AG-UI variant |

Switch: **Config → Agent LLM Framework**, or set `llm_framework` via feature flags. Compose profile `agents` starts the non-default packages; lean-core often runs LangChain only.

## Specialist / adjacent agents

| Directory | Port | Role |
|-----------|------|------|
| `llamaindex_agent/` | 8894 | LlamaIndex RAG over Weaviate + embeddings (`rag` profile). FastAPI `/ask`, `/health`. |
| `compliance_agent/` | 3007 | Pydantic AI AML / risk microservice. BFF bridge under `/api/compliance-agent/*`. Not a banking-chat brain swap. |

## Demo LLM brains (agent mode picker)

Orthogonal to framework — same package, different brain:

| Mode (picker) | Provider id | Notes |
|---------------|-------------|--------|
| **Heuristics** | *(none)* | Deterministic NL → tool path; always available |
| **Google Gemini** | `google` (`gemini` mode) | Fast cloud LLM for SE demos |
| **llama.cpp** | `llamacpp` | Local models via `demo_llm_proxy` on `:8090` |

Other modes (MLX, Anthropic, Helix, Groq) are defined in `demo_api_ui/src/config/agentModes.js` when keys / hosts are configured. Heuristics / Gemini / llama.cpp are the usual live-demo trio.

## How a turn runs

1. User sends a message (or Demo step / chip).
2. BFF resolves **brain** (`agent_mode` / session langchain config) and **framework** (`llm_framework`).
3. Framework service calls tools back through the BFF (`/internal/agent-tool`) with the delegated Ping token chain.
4. UI shows the same Token Chain / HITL / MFA surfaces regardless of framework.

## Run locally

```bash
# Core stack (LangChain agent typically included)
./run.sh
# or lean Docker core:
./run-docker.sh

# Optional AG-UI framework variants:
# Compose profile: agents  → openai / mastra / pydantic on 8891–8893

# Optional RAG (LlamaIndex):
# Compose profile: rag → weaviate, embeddings, llamaindex-agent :8894

# Compliance specialist (native):
cd compliance_agent && ./start.sh   # :3007
```

API / UI (native TLS): API `https://api.ping.demo:3001` · UI `https://local.ping-devops.com:4000`.

## Education UI

In-app panel: **Learn → Agent frameworks (inventory)** (`AgentFrameworksPanel.js`).
Overview ends with the full agent + brain inventory table.

## Related docs

- [docs/AGENT_FRAMEWORK_COMPARISON.md](docs/AGENT_FRAMEWORK_COMPARISON.md) — deeper framework comparison
- [docs/AGENT_FRAMEWORK_TECHNICAL_COMPARISON.md](docs/AGENT_FRAMEWORK_TECHNICAL_COMPARISON.md)
- [CLAUDE.md](CLAUDE.md) — repo run / test map
- `demo_api_server/data/serverInventory.js` — probed ports and containers

---

## All agents we have

### Framework & specialist packages

| Directory | Framework | Port | In `llm_framework`? |
|-----------|-----------|------|---------------------|
| `langchain_agent` | LangChain / LangGraph | 8888 | Yes — `langchain` |
| `openai_agent` | OpenAI Agents SDK | 8891 | Yes — `openai_agents` |
| `mastra_agent` | Mastra | 8892 | Yes — `mastra` |
| `pydantic_agent` | Pydantic AI | 8893 | Yes — `pydantic_ai` |
| `llamaindex_agent` | LlamaIndex | 8894 | No (RAG profile) |
| `compliance_agent` | Pydantic AI (specialist) | 3007 | No (microservice) |

### Demo brains

| Brain | Mode id | Needs |
|-------|---------|--------|
| Heuristics | `heuristics` | Nothing |
| Google Gemini | `gemini` | Google API key |
| llama.cpp | `llamacpp` | `demo_llm_proxy` + GGUF models |
