# RAG Code Search — Working End-to-End Design

**Date:** 2026-06-30
**Status:** Approved (design), pending implementation
**Branch:** `worktree-wire-rag-code-search`

## Problem

The RAG code-search stack is unfinished scaffolding:

- `demo-mcp-code-search` is a 134-line **stdio MCP stub** that returns `files_indexed: 0`
  and empty search results. But the BFF (`mcpCodeSearchClient.js`) calls it as a **plain
  HTTP REST service** — protocol mismatch.
- Weaviate runs with **no vectorizer** configured, so it has no embedding capability.
- The embedding service is `ollama/ollama:latest` (2.77GB pull) serving `nomic-embed-text`,
  but **nothing consumes it** — and the project standard is llama.cpp, not Ollama.

Goal: `docker-compose up --build` brings up a **working** semantic code-search pipeline,
with **no Ollama** anywhere. The existing UI page (`/code-search`) and BFF routes
(`/api/code-search/index`, `/api/code-search/search`) become functional unchanged.

## Fixed Contract (do not change — already consumed by the BFF)

`demo_api_server/src/services/mcpCodeSearchClient.js` defines the wire contract the
service MUST satisfy:

**`POST /index`**
```
Request:  { files: [{ path: string, content: string(base64) }],
            codebase_id: string, codebase_name: string, chunk_strategy?: string }
Response: { codebase_id: string, files_indexed: number, chunks_created: number, errors?: string[] }
```

**`POST /search`**
```
Request:  { query: string, codebase_id: string, limit?: number, file_filter?: string }
Response: { results: [{ file: string, line_start: number, line_end: number,
            relevance: number, snippet: string }], query_time_ms: number }
```

**`GET /health`** → 200 (compose healthcheck hits `http://localhost:8095/health`).

The BFF returns a 503 to the UI when the service reports unavailable.

## Architecture

```
UI (/code-search)
  -> BFF /api/code-search/{index,search}  (routes/codeSearch.js, unchanged)
    -> demo-mcp-code-search :8095  (REWRITE: express HTTP server)
        -> embeddings :8080   (llama.cpp --embedding, /v1/embeddings)
        -> weaviate   :8080   (BYO vectors, class CodeChunk)
```

### 1. Embedding service (replaces `ollama/ollama`)

- Image: `ghcr.io/ggml-org/llama.cpp:server`.
- Command: `--embedding` + model via `-hf nomic-ai/nomic-embed-text-v1.5-GGUF` (Q8_0),
  `--pooling mean`, host `0.0.0.0`, port `8080`.
- Model GGUF (~140MB) downloads once, cached in a named volume (replaces `llama-models`).
- Exposes OpenAI-compatible `POST /v1/embeddings` → `{ data: [{ embedding: number[] }] }`.
- Embedding dimension: **768**.

### 2. Weaviate — BYO vectors

- `vectorizer: none` (the service computes vectors; Weaviate stores/queries them).
- Single class `CodeChunk` with properties:
  `codebase_id` (text), `codebase_name` (text), `file` (text),
  `line_start` (int), `line_end` (int), `snippet` (text).
- Vector = the chunk's embedding (768-dim).
- Schema created **idempotently** on service startup (create if absent).

### 3. `demo-mcp-code-search` — rewrite to HTTP

Replace the stdio MCP SDK entirely with an `express` server on `:8095`.

**Modules (each one clear purpose, independently testable):**

- `chunker.ts` — line-based chunking. Fixed window (default 40 lines) with small overlap
  (8 lines). Emits `{ file, line_start, line_end, snippet }` per chunk. Pure function.
- `embeddings.ts` — POST to `${EMBEDDING_URL}/v1/embeddings`, returns `number[][]`.
  Batches inputs; retries transient failures. Uses `axios` (already a dep).
- `weaviateStore.ts` — schema ensure, batch insert chunks-with-vectors, `nearVector`
  query with `codebase_id` filter. Uses `weaviate-ts-client`.
- `fileFilter.ts` — translate a glob (`file_filter`) to a matcher; applied as a Weaviate
  `where` on `file` where possible, else post-filter. Pure function.
- `server.ts` — express wiring: `/health`, `/index`, `/search`; decode base64; orchestrate
  chunk → embed → store / embed → query → map; error handling → 503/500.
- `index.ts` — bootstrap (config from env, ensure schema, listen).

**Indexing flow (`/index`):** decode each file's base64 content → chunk → embed all chunks
(batched) → batch-insert into Weaviate with vectors → return
`{ codebase_id, files_indexed, chunks_created }`. On partial failure, collect `errors[]`.

**Search flow (`/search`):** embed `query` → Weaviate `nearVector` (limit, `where` on
`codebase_id` + optional `file` glob) → map each hit to
`{ file, line_start, line_end, relevance, snippet }` where `relevance = certainty`
(0–1, from cosine distance) → return with `query_time_ms`.

**New deps:** `express`, `weaviate-ts-client`. Remove `@modelcontextprotocol/sdk`.
`axios`, `pino` already present.

### 4. Compose wiring (`docker-compose.yml`)

- Replace `llama-embedding` (ollama) with `embeddings` (llama.cpp) as above.
- Weaviate: add `DEFAULT_VECTORIZER_MODULE: none` (explicit; no modules enabled).
- `demo-mcp-code-search` env: `EMBEDDING_URL=http://embeddings:8080`,
  `WEAVIATE_URL=http://weaviate:8080`; `depends_on` both `service_healthy`.
- Rename volume `llama-models` → `embed-models`.
- `run-docker.sh` host llama.cpp (chat model, :8090) is **unchanged** — separate concern.

## Error Handling

- Embedding service down → `/index` and `/search` return 503 (BFF surfaces "unavailable").
- Weaviate down → 503 likewise.
- Per-file decode/chunk errors during index → collected in `errors[]`, indexing continues.
- Empty query / missing codebase_id → 400 (BFF already validates too).

## Testing (jest, already configured)

Unit (mocked embedding + Weaviate clients):

- `chunker` — window/overlap boundaries, last-chunk remainder, empty file, line numbers.
- `fileFilter` — glob→matcher correctness (`*.js`, `src/**`, exact path).
- `server` — `/index` happy path returns correct counts; `/search` maps hits to the exact
  response shape; missing fields → 400; embedding failure → 503; `/health` → 200.

Out of scope for unit tests: live llama.cpp / Weaviate (covered by the manual
`up --build` verification).

## Verification (definition of done)

1. `jest` green in `demo_mcp_code_search`.
2. `docker-compose up --build` brings `embeddings`, `weaviate`, `demo-mcp-code-search`
   all to healthy; **no `ollama/ollama` image pulled**.
3. Manual: index a small codebase via the UI/BFF, then a semantic query returns
   non-empty, plausibly-ranked results with correct `file`/line ranges.

## Out of Scope

- AST-aware chunking (`chunk_strategy: ast_aware`) — accept the param, treat as line-based.
- Re-indexing / dedup of an already-indexed `codebase_id` (append-only for now).
- Auth on the code-search service (internal network only).
- Changing the host chat-model llama.cpp lifecycle in `run-docker.sh`.
