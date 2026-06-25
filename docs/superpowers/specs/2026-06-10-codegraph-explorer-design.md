# Code Explorer — Design Spec

**Date:** 2026-06-10  
**Status:** Approved  
**Author:** Curtis Muir

---

## Overview

Add a "Code Explorer" feature to the AI-Demo app: a chat interface where developers can ask natural-language questions about the codebase and receive answers grounded in actual code, with file:line citations.

The feature is powered by the existing CodeGraph MCP index (already running locally as a SQLite-backed daemon) and a new lightweight LangChain ReAct agent using Claude Haiku-4-5. It is accessible from the main SideNav with no authentication required, and runs both locally and in Kubernetes.

---

## Goals

- Developers exploring the AI-Demo architecture can ask questions like "How does the MCP gateway work?" or "What calls the authorize endpoint?" and get answers backed by real code
- Works in k8s (demo environment) without requiring a running CodeGraph daemon at runtime
- No auth barrier — open to anyone viewing the demo
- Positioned as a developer tool, distinct from the banking/vertical AI agent flows

---

## Architecture

```text
Browser: CodeExplorerPage.jsx
  │
  └─ POST /codegraph/query  { question, history[] }
       │
       ▼
  langchain_agent service  (new /codegraph FastAPI router — port 8888)
       │
       └─ CodeGraphAgent  (LangGraph create_react_agent, no OAuth)
            ├─ LLM: Claude Haiku-4-5 via Anthropic API
            ├─ codegraph_explore(query)  ─┐
            ├─ codegraph_search(term)     ├─ sqlite3 → CODEGRAPH_DB_PATH
            ├─ codegraph_callers(symbol)  │
            └─ codegraph_callees(symbol) ─┘
       │
       └─ SSE token stream → UI
```

### k8s DB Strategy

The CodeGraph SQLite DB (`.codegraph/codegraph.db`) is baked into the `langchain_agent` Docker image at build time via `COPY .codegraph/codegraph.db /app/codegraph.db`. The index is frozen at build time and refreshes with every image rebuild — the right cadence for a demo.

**Local dev:** `CODEGRAPH_DB_PATH` defaults to `../../.codegraph/codegraph.db` (relative to the service root; live, daemon-maintained).  
**k8s:** `CODEGRAPH_DB_PATH=/app/codegraph.db` set in the configmap (baked copy).

---

## Files

### New (backend — `langchain_agent/src/`)

| File | Purpose |
| ------ | --------- |
| `codegraph/__init__.py` | Package marker |
| `codegraph/db.py` | Raw SQLite queries: explore (FTS5 + edge traversal), search, callers, callees |
| `codegraph/tools.py` | LangChain `BaseTool` wrappers around `db.py` |
| `codegraph/agent.py` | `create_react_agent` with Haiku LLM + code-assistant system prompt |
| `api/codegraph_handler.py` | `POST /codegraph/query` FastAPI router → SSE stream |

### Changed (backend)

| File | Change |
| ------ | -------- |
| `src/main.py` | Register `/codegraph` router at startup |
| `src/config/settings.py` | Add `CODEGRAPH_DB_PATH` setting (default `../../.codegraph/codegraph.db`) |
| `Dockerfile` | Add `COPY .codegraph/codegraph.db /app/codegraph.db` and `ENV CODEGRAPH_DB_PATH=/app/codegraph.db`. The build must be invoked from the repo root so `.codegraph/` is in the build context (already the case — `docker-compose.yml` sets `context: .` for all services). |

### New (UI — `demo_api_ui/src/`)

| File | Purpose |
| ------ | --------- |
| `components/CodeExplorerPage.jsx` | Chat UI + starter chips, SSE consumer |
| `components/CodeExplorerPage.css` | Styling |

### Changed (UI)

| File | Change |
| ------ | -------- |
| `src/App.js` | Add `/code-explorer` public route (no auth guard) |
| `src/components/SideNav.js` | Add "Code Explorer" item to a new "Tools" nav group, `MdCode` icon |

### Changed (k8s)

| File | Change |
| ------ | -------- |
| `k8s/02-configmap.yaml` | Add `CODEGRAPH_DB_PATH: /app/codegraph.db` |

No new entry in `service-topology.json` — this is a new endpoint on the existing `langchain-agent` service (port 8888).

---

## Backend Detail

### SQLite Tools

The four LangChain tools query the CodeGraph SQLite schema directly:

| Tool | Query pattern | Typical use |
| ------ | --------------- | ------------- |
| `codegraph_explore` | FTS5 match on `nodes.name + source`, return top-10 nodes with source | "How does X work?" |
| `codegraph_search` | FTS5 match on `nodes.name`, return qualified names + file:line | Finding a specific symbol |
| `codegraph_callers` | `edges WHERE to_id = ? AND edge_type = 'calls'` | "What calls X?" |
| `codegraph_callees` | `edges WHERE from_id = ? AND edge_type = 'calls'` | "What does X call?" |

Each tool caps output at a safe token budget (explore: 8000 chars, others: 4000 chars) to avoid overflowing Haiku's context.

### Agent System Prompt

```text
You are a code navigator for the AI-Demo repository — a multi-vertical AI agent
security demo built on PingOne, MCP, and LangChain. The repo contains:
- demo_api_server: Node.js BFF
- demo_mcp_gateway / demo_mcp_server: MCP protocol services
- langchain_agent: Python LangChain agent
- demo_api_ui: React frontend
- demo_authz_server: mock PingOne Authorize

Use the available tools to look up real code before answering. Always cite
file:line references in your answer. Keep answers focused and concrete.
Typical flow: call codegraph_explore first, then codegraph_search or
codegraph_callers if you need to narrow down or trace a call chain.
```

### Endpoint

`POST /codegraph/query`  
Request: `{ "question": "...", "history": [{ "role": "user"|"assistant", "content": "..." }] }`  
Response: `text/event-stream` SSE — `data: <token>\n\n` per chunk, `data: [DONE]\n\n` at end  
Auth: none (public endpoint)

---

## UI Detail

### Page States

**Empty state:** Page title "Code Explorer", subtitle "Ask anything about this codebase", then a 2×3 grid of starter chips:
1. How does the MCP gateway work?
2. Trace the token chain flow
3. What calls the authorize endpoint?
4. How is delegation implemented?
5. Show me the OAuth login flow
6. What tools does the LangChain agent have?

Clicking a chip populates the input and immediately submits.

**Active chat:** Messages render in a scrollable list. AI responses stream token-by-token. File:line references in responses are rendered as inline code (not clickable links — the app may not be running against the local filesystem in k8s).

**Loading:** Typing indicator (three dots) while waiting for the first SSE token.

### SideNav Entry

Added to a new "Tools" group in `SideNav.js` for both `ADMIN_NAV` and `buildUserNav`:

```js
{
  group: "Tools",
  items: [
    { to: "/code-explorer", label: "Code Explorer", icon: "MdCode" },
  ],
}
```

`MdCode` is already imported in `SideNav.js`.

---

## Error Handling

| Scenario | Behaviour |
| ---------- | ----------- |
| `CODEGRAPH_DB_PATH` file missing | `/codegraph/query` returns 503 `{ "error": "CodeGraph index not available" }` |
| Anthropic API error | SSE stream emits `data: [ERROR] <message>\n\n` then closes |
| Empty tool results | Agent falls back to answering from training knowledge, notes it could not find the symbol |
| DB read under WAL mode | SQLite read-only opens are safe under WAL — no locking concern |

---

## Out of Scope

- Real-time index updates in k8s (index is build-time only in containers)
- Auth-gating the endpoint (intentionally open)
- Writing to the CodeGraph index
- Syntax-highlighted source code display (plain text citations only)
- A dedicated vertical in the vertical switcher

---

## Success Criteria

1. `POST /codegraph/query` returns a streaming answer for "How does the MCP gateway work?" with at least one file:line citation
2. Starter chips render on the empty state and submitting one produces an answer
3. The "Code Explorer" SideNav item is visible when logged in and when not logged in
4. The feature works in k8s: `docker build` includes the DB, `CODEGRAPH_DB_PATH` is set in the configmap
5. No regressions in the existing LangChain agent WebSocket flow
