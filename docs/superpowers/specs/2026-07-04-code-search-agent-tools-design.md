# Code Search as Scoped Agent Tools — Design

**Date:** 2026-07-04
**Status:** Approved design (pending spec review)

## Goal

Expose the indexed codebase (Weaviate `CodeChunk`, codebase `ai-demo2`,
~24.7k chunks) as tools any agent can call, wired into the demo's RFC 8693
token-exchange + scope authorization pipeline so it appears in the token-chain
inspector like the banking tools.

## Decisions (from brainstorming)

1. **Surface:** register on the shared **`demo_mcp_server`** so all four agent
   frameworks (LangChain, OpenAI, Pydantic, Mastra) inherit the tools with one
   implementation.
2. **Auth:** **scoped** — a new `code:search` scope routed through the existing
   gateway token-exchange path, so it joins the authorization demo.
3. **Capability:** **three tools** — `code_search`, `get_code`, `list_codebases`.

## Non-goals (YAGNI)

- No new microservice; reuse `demo-mcp-code-search` (`:8095`).
- No fine-grained PingAuthorize policy — coarse `code:search` scope check only
  (code is public; no user data).
- No new PingOne resource server — `code:search` lives on the existing
  **Super Banking MCP Server** resource.
- No re-indexing; `get_code` reconstructs ranges from existing chunks.
- No write/index tools exposed to agents (indexing stays operator-driven).

## Architecture

No new services. Three tools on `demo_mcp_server`; handlers call the existing
code-search HTTP service.

```
agent
  → demo_mcp_gateway   (RFC 8693 exchange → aud = MCP Server resource;
                        scope check: code:search; Authorize decision;
                        token-chain audit)
  → demo_mcp_server    (tool handler)
  → demo-mcp-code-search:8095  → Weaviate / embeddings
```

The gateway already forwards every `CallTool` to the MCP server after its authz
check, so **no new gateway dispatch path is needed** — only a tool→scope mapping
in the manifest. The only difference from a banking tool is that the MCP-server
handler calls the code-search service instead of the BFF vertical executor.

## Components & interfaces

### 1. `demo-mcp-code-search` service — new `POST /code` endpoint

Reconstructs a line range from the indexed chunks (no repo mount, no re-index).

- **Request:** `{ codebase_id, file, line_start, line_end }`
- **Response:** `{ file, line_start, line_end, code }` (the source text for the
  range) or `404 { error: 'not_found' }` if no chunk covers the file.
- **Algorithm (`weaviateStore.getCode`):**
  1. Query `CodeChunk` where `codebase_id == X AND file == Y`, fetch
     `line_start line_end snippet`, ordered by `line_start`.
  2. Build a `Map<lineNumber, text>` by splitting each chunk's `snippet` into
     lines and assigning to `[chunk.line_start .. chunk.line_end]` (chunks tile
     the file with 8-line overlap, so overlaps agree).
  3. Return lines `[line_start .. line_end]` joined by `\n`; clamp to available
     range. If the map is empty → `not_found`.
- Reuses the same `Store` interface pattern (`listCodebases` precedent); add
  `getCode(opts): Promise<CodeRange | null>` to `Store`.

`list_codebases` and `code_search` reuse existing `GET /codebases` and
`POST /search` unchanged.

### 2. `demo_mcp_server` — register three tools + handlers

Add a `CodeSearchToolProvider` (mirrors `BankingToolProvider`) that registers:

| Tool | Input schema | Handler → service |
|---|---|---|
| `code_search` | `query: string`, `limit?: int(1–25)` | `POST /search` (`codebase_id` defaults to `ai-demo2`) |
| `get_code` | `file: string`, `line_start: int`, `line_end: int` | `POST /code` |
| `list_codebases` | *(none)* | `GET /codebases` |

- All three: `requiredScopes: ['code:search']`, `readOnly: true`,
  `annotations.userFacing = { readable: true, destructive: false, idempotent: true, openWorld: false }`.
- Service base URL from new env `MCP_CODE_SEARCH_URL` (default
  `http://demo-mcp-code-search:8095`); add to the MCP server's compose service.
- Handlers map service `503 → unavailable`, `4xx/5xx → tool error` with the
  service message, mirroring existing tool error handling.
- Descriptions written for LLM selection (e.g. `code_search`: "Semantic search
  over the indexed source code. Returns ranked snippets with file path and line
  range. Use when asked where something is implemented or how the code works.").

### 3. Scope wiring — `scope-topology.json` (SSOT)

`toolScopes.ts` / `scopeTopology.ts` derive everything from the manifest; never
hand-edit the derived maps. Manifest edits:

- **`scopes`**: add
  ```json
  "code:search": { "description": "Search and read the indexed source code (read-only)", "riskLevel": "low", "resource": "Super Banking MCP Server", "category": "infra" }
  ```
- **`tools`**: add three entries, each
  `{ "requiredScopes": ["code:search"], "surface": "gateway" }`.
- Keep **`npm run topology:verify`** green (running code + P1AZ + gateway must
  agree — the gate compares registered tools against the manifest).

### 4. PingOne provisioning (live, additive, reversible)

- Create the `code:search` scope on the **Super Banking MCP Server** resource
  via the repo's provisioning path (direct API for scopes per repo convention).
- Grant `code:search` to the agent actor app(s) so the gateway exchange yields a
  token carrying it. No secret rotation; no new resource server.
- **Rollback:** remove the scope grant + scope; revert the manifest. The tools
  then fail the scope check (clean deny) rather than breaking anything else.

## Data flow (example)

Agent asks "where is the Weaviate schema created?":
1. LLM picks `code_search({ query: "create weaviate schema", limit: 5 })`.
2. Gateway exchanges the agent token (aud = MCP Server), verifies `code:search`,
   audits the hop, forwards to the MCP server.
3. Handler → `POST /search` → ranked chunks (e.g. `weaviateStore.ts:65-104`).
4. LLM may follow up with `get_code({ file: "demo_mcp_code_search/src/weaviateStore.ts", line_start: 65, line_end: 104 })` → full range text.

## Error handling

- Missing `code:search` scope → gateway `403 insufficient_scope` (same shape as
  banking denials; visible in the token chain).
- Service down → tool returns an `unavailable` error (503 mapped).
- `get_code` for an unindexed file/range → `not_found`, handler returns an empty
  result with a message, not an exception.
- Invalid args (bad line numbers, empty query) → validation error before the
  service call.

## Testing

- **Service unit:** `getCode` stitch (multi-chunk overlap, out-of-range clamp,
  unknown file → null); `POST /code` route (200 / 404 / 503).
- **MCP server unit:** three tool handlers with a mocked service (success,
  unavailable, not_found); tool registration lists all three with
  `requiredScopes: ['code:search']`.
- **Topology gate:** `npm run topology:verify` passes with the new scope/tools.
- **Live e2e:** with the scope granted, an agent turn ("search the codebase for
  where the weaviate schema is created") returns results and the hop shows in the
  token-chain inspector; without the grant, a clean `insufficient_scope` deny.

## Rollout / phases (for the plan)

1. Service: `getCode` + `POST /code` (+ tests).
2. MCP server: `CodeSearchToolProvider`, env, handlers (+ tests).
3. Scope wiring: manifest scope + tools; `topology:verify` green.
4. PingOne: provision + grant `code:search` (isolated, reversible).
5. Live verification through the token chain (both grant + deny paths).

Phases 1–3 are code-only and safe to land/merge independently; phase 4 is the
only live-env change.
