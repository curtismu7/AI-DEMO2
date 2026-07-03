# Code Search v2 — Default Index + Folder Ingest + Agent Chat — Design

**Date:** 2026-07-03
**Branch:** `worktree-weaviate-rag-education`
**Sibling spec:** `2026-07-03-weaviate-rag-education-design.md` (education/demo-guide/log-fix — separate PR)

## Purpose

Make the **Code Search** page (`/code-search`) usable out of the box and
conversational:

1. **A — Default index:** this demo's own source is searchable on first load, no
   upload required.
2. **B — Folder ingest:** the user can point at any folder on their machine and
   search it, without Docker mounts or restarts.
3. **C — Agent chat:** an assistant answers questions over the indexed content
   (RAG over Weaviate), with citations — alongside the existing raw search box.

**Build order:** A → B → C. A and B are independent (parallelizable); C depends on
an index existing.

## Constraints that shaped this design

- **Containers can't read arbitrary host paths.** The BFF (`demo-api-server`)
  mounts only `./demo_api_server:/app`; the code-search service mounts no source.
  A typed host path like `/Users/…` does not resolve inside a container.
  → Folder ingest (B) is done **client-side in the browser** (folder picker +
  upload), needing no host FS access. The default index (A) reads the repo via a
  new **read-only repo mount**.
- **Embedder is a local llama.cpp `nomic-embed-text` service.** Large index jobs
  are real compute and can flood it (this is the same "too many calls" symptom
  the user already flagged). → A is **bounded**: curated source roots, file/size
  caps, batched, run **once** (idempotent).
- **`.claude/worktrees/` contains many full copies of the repo.** Indexing it
  would multiply everything. → The walker **must** exclude it.
- **Docker serves the main checkout** (see memory `docker-serves-main-checkout`).
  The compose change (repo mount) needs a container recreate to take effect; the
  BFF runs `node --watch` so code reloads, but a new volume mount does not apply
  until recreate.

## Reused infrastructure

- **Existing agent-service pattern** (`pydantic_agent/`, `openai_agent/`,
  `mastra_agent/`) — the new `llamaindex_agent/` service (C) mirrors their compose
  shape (own dir, own port, `ai-demo` network, `:8090` for the LLM). No new
  pattern to invent.
- `demo_api_server/routes/codeSearch.js` `POST /index` already accepts **multiple
  files** (multer `upload.array('file')`). Folder ingest (B) reuses it. The BFF
  `/ask` route (C) is a thin proxy to the LlamaIndex service, same as how the BFF
  fronts the other agents.
- `demo_mcp_code_search` owns **writing** chunks into the `CodeChunk` class
  (used by A/B). The LlamaIndex service (C) **reads** that same class natively via
  `WeaviateVectorStore`, using the *same* `nomic-embed-text-v1.5` embedder so its
  query vectors match the stored ones. Shared class, shared embedder — one index,
  two readers.
- `demo_api_server/src/services/mcpCodeSearchClient.js` — `index()` / `search()`.
  No "list/count" method exists; the page tracks codebases in `localStorage`.

---

## Feature A — Default index of this demo's source

### Backend
- **Compose:** add a read-only repo mount to `demo-api-server`:
  `- .:/repo:ro`. (Read-only; no write path from the container.)
- **New module** `demo_api_server/services/defaultCodebaseIndexer.js`:
  - Constants: `DEFAULT_CODEBASE_ID = 'ai-demo2-default'`,
    `DEFAULT_CODEBASE_NAME = 'This demo (AI-DEMO2)'`.
  - `SOURCE_ROOTS` (configurable const, default curated): `demo_api_server`,
    `demo_api_ui/src`, `demo_mcp_code_search/src`, plus the other first-party
    service source dirs (e.g. `langchain_agent`, `demo_llm_proxy`, `mcp-*`) —
    **excluding** vendored/generated. Widening later = editing this list.
  - **Ignore rules** (hard-coded, applied during the walk): `.claude`,
    `node_modules`, `.git`, `dist`, `build`, `coverage`, `data`, `logs`,
    `.next`, `*.min.*`, lockfiles, and — **secrets** — `.env*`, `certs/`,
    `*.pem`, `*.key`, `*.p12`, plus any non-text/binary extension. Extension
    **allowlist** for text/code (`.js .jsx .ts .tsx .py .json .md .css .yml
    .yaml .sh .go .java …`).
  - **Caps:** per-file byte cap (e.g. 256 KB), total file cap (e.g. 3000), skip
    anything over. Report skipped counts in logs.
  - Walk → read text → POST to code-search `/index` in **batches** (respect the
    60 MB JSON body limit) under `DEFAULT_CODEBASE_ID`.
  - **Idempotency:** before indexing, probe
    `search({ query: 'function', codebase_id: DEFAULT_CODEBASE_ID, limit: 1 })`;
    if it returns hits, assume already indexed and skip. (Weaviate data persists
    across restarts.)
  - **Trigger:** kick off in the background at BFF startup, but **gated on the
    embedder being reachable** (retry with backoff until `/search` stops
    returning 503). Non-blocking — never delays server boot.
  - **Status:** module tracks `{ state: 'idle'|'indexing'|'ready'|'error',
    filesIndexed, chunksCreated, skipped, error? }`.
- **New route** `GET /api/code-search/default-status` → returns the status object
  above (mounted in `routes/codeSearch.js`).

### Frontend (`CodeSearchPage.jsx`)
- On mount, **always prepend** the default codebase
  `{ id: 'ai-demo2-default', name: 'This demo (AI-DEMO2)', isDefault: true }` to
  the list (independent of `localStorage`) and select it if nothing else is
  selected — so search/agent work on first load.
- Poll `GET /default-status`; show an "indexing…" chip on the default entry
  until `ready`; if `error`, show a small inline notice.

## Feature B — Folder picker ingest (browser-side)

### Frontend (`CodebaseUploader` or a new sibling control)
- Add a **folder picker**: `<input type="file" webkitdirectory directory
  multiple>`.
- On selection, **client-side filter** the `FileList`:
  - extension allowlist (same text/code set as A),
  - skip paths containing `node_modules`, `.git`, `dist`, `build`, `.next`,
  - per-file size cap (e.g. 256 KB) and total file-count cap (e.g. 2000),
  - read each accepted file as text (`file.text()`), preserving
    `webkitRelativePath` as the `path`.
- Upload via the existing `indexCodebase`/`/api/code-search/index` (multipart,
  multi-file). Codebase name defaults to the top-level folder name (editable).
- **Report, don't hide:** show "Indexed N files, skipped M (too large / binary /
  ignored)" — never silently truncate.
- Batch if the selection is large (chunk the upload to stay under limits).

### Backend
- No new endpoint. Verify multer + code-search 60 MB limits handle batched
  uploads; if a batch exceeds limits, the client splits it (client-driven
  batching keeps the server unchanged).

## Feature C — Agent chat over the index (LlamaIndex agent)

**Shape:** a **true tool-calling agent built on LlamaIndex** — an OSS,
RAG-native framework (chosen over a hand-rolled loop and over the banking
`langchain_agent`). It runs as a **new standalone Python service**
`llamaindex_agent/` (mirrors the existing `pydantic_agent` / `openai_agent`
service pattern), reasons with the `:8090` llm-proxy, and retrieves from the
Weaviate `CodeChunk` collection. It does **not** touch the banking agent.

### New service — `llamaindex-agent` (compose)
- New dir `llamaindex_agent/` (Python, FastAPI or similar), new compose service on
  a free port (e.g. `:8894`), on the `ai-demo` network.
- Env: `WEAVIATE_URL=http://weaviate:8080`,
  `EMBEDDING_URL=http://embeddings:8080`,
  `EMBEDDING_MODEL=nomic-embed-text-v1.5`,
  `LLAMACPP_BASE_URL=http://llm-proxy:8090`, `AGENT_MAX_TOOL_CALLS` (default 4).
- Exposes `POST /ask` `{ question, codebase_id, limit? }`.

### Retrieval — native `WeaviateVectorStore` over the `CodeChunk` class (chosen)
LlamaIndex owns retrieval: it connects **directly** to the existing Weaviate
`CodeChunk` class, embeds the query itself, and runs the ANN search — no hop
through code-search `/search`. Code-search still owns *writing* (A/B index into
`CodeChunk`); LlamaIndex only *reads*. This is the RAG-native design, and it
carries two hard correctness constraints that the implementation **must** satisfy
(they are not optional):

1. **Same embedder, or results are garbage.** `CodeChunk` holds **768-dim
   `nomic-embed-text-v1.5`** vectors (`vectorizer: none`). The LlamaIndex service
   **must** be configured with an embed model that calls the *same* embeddings
   service (OpenAI-compatible `EMBEDDING_URL` `/v1/embeddings`, model
   `nomic-embed-text-v1.5`) so query vectors share the stored vector space.
   Verify the returned dimension is 768.
2. **Foreign-schema mapping.** The class was created by code-search, not by
   LlamaIndex, so LlamaIndex must be told the mapping instead of assuming its own
   conventions:
   - `index_name = "CodeChunk"`, connect via `from_vector_store` (do **not** let
     LlamaIndex create/own the class).
   - `text_key = "snippet"` (the chunk body).
   - Metadata from `file / line_start / line_end / codebase_id / codebase_name`.
   - **Node reconstruction risk:** some LlamaIndex versions expect a
     `_node_content` blob they wrote themselves to rebuild nodes; `CodeChunk` has
     none. The impl must use a config/retriever that reconstructs nodes from
     `text_key` + metadata only (no `_node_content` dependency). **Verify the
     current `WeaviateVectorStore` behavior via context7 before coding** — if the
     installed version hard-requires `_node_content`, fall back to a thin custom
     retriever that queries `CodeChunk` with `nearVector` + a `codebase_id` filter
     and maps rows to nodes. Do not silently ship a store that returns empty.
   - **Scope filter:** every query applies a `MetadataFilters` equality on
     `codebase_id` (bound server-side from the request) so the agent can only
     read the requested codebase.
- Weaviate/LlamaIndex client versions are pinned; confirm the `weaviate-client`
  major version LlamaIndex's `WeaviateVectorStore` expects works against the
  running Weaviate 1.38.

### Agent behavior
- The vector store is wrapped as a **retriever/query-engine tool** the agent can
  call (LlamaIndex `FunctionAgent`/`ReActAgent`); the LLM decides when to call it
  and may call it multiple times to refine.
- System prompt: "You are a code-search agent. Use the code retrieval tool to
  find relevant code before answering. You may call it multiple times to refine.
  Answer **only** from retrieved snippets; cite `path:line_start-line_end`; if the
  code isn't found, say so — never invent code."
- The retrieval tool's `codebase_id` is **bound server-side** from the request
  (the model cannot read other codebases). Returns the matched chunks.
- **Bounded:** `AGENT_MAX_TOOL_CALLS` (default 4) caps tool iterations → caps
  embedder load and prevents runaway loops.
- If the `:8090` model can't tool-call reliably, LlamaIndex's agent still
  degrades to a single retrieval + answer; expose that as `mode` in the response.

### BFF wiring — `POST /api/code-search/ask`
- Thin proxy: BFF route forwards `{ question, codebase_id, limit }` to
  `llamaindex-agent:8894/ask` and returns its JSON (keeps the browser same-origin
  through the BFF, like the other agent services).
- **Response** `{ answer, sources: [{ file, line_start, line_end, snippet }],
  toolCalls: number, mode: 'agent' | 'single-shot' }` — `sources` = chunks the
  agent actually retrieved; `mode`/`toolCalls` make the agentic behavior visible.
- Errors: agent/embedder/LLM unreachable → `503` "assistant unavailable"; empty
  retrieval → "no relevant code found".

### Frontend (`CodeSearchPage.jsx`)
- Add a **two-tab layout** on the right pane: **Ask** (the agent) and **Search**
  (the existing raw box, unchanged).
- **Ask** tab: question input, answer area, a **Sources** list (file, line range,
  snippet — reuse/extend `SearchResults` styling), and a small indicator of how
  many `search_code` calls the agent made and whether it ran in `agent` or
  `single-shot` mode (so the agentic behavior is visible in the demo).
- Single-turn requests in v1 (no cross-question memory). Note for later:
  multi-turn conversation memory is a future enhancement, out of scope.

---

## Verification / "done" criteria

- **A:** With the stack up, visiting `/code-search` shows "This demo (AI-DEMO2)"
  selected; after the background job finishes, a query like "authentication
  logic" returns first-party-source chunks. `GET /default-status` transitions
  `indexing → ready`. Re-starting the BFF does **not** re-index (idempotent).
  The walk **never** descends into `.claude/worktrees` / `node_modules` (verified
  by inspecting indexed file paths and the skip log).
- **B:** Selecting a local folder indexes it into a new codebase named after the
  folder; skipped-file counts are shown; searching it returns relevant chunks.
- **C:** Asking a question on the **Ask** tab drives the agent to call its
  retrieval tool (visible in the response `toolCalls`/`mode`) and returns a
  grounded answer whose citations match retrieved chunks; an out-of-scope
  question yields "couldn't find it," not a hallucination; if the model can't
  tool-call, it transparently runs `single-shot` mode and still answers. Tool
  iterations are capped. The **Search** tab still works. The `llamaindex-agent`
  service comes up healthy and the BFF `/ask` proxy reaches it.
- **C retrieval correctness (explicit test):** a known query returns the expected
  `CodeChunk` (proving the LlamaIndex embedder matches the stored 768-dim
  `nomic` vectors and the foreign-class mapping works) — not just a non-empty
  response.
- **Bounded load:** the default index job embeds only the curated roots within
  caps; the log reports total chunks and skipped files. No sustained embedder
  traffic after `ready`.
- **Build:** `demo_api_ui` compiles; BFF starts without the indexer blocking boot.

## Risks / notes

- **Embedder saturation** is the main risk — mitigated by curated roots, caps,
  batching, and one-time idempotent runs. If the curated set is still too large,
  narrow `SOURCE_ROOTS`.
- **Repo mount** exposes the repo read-only inside the BFF container; acceptable
  (no secrets are indexed because `.env`/`certs`/`data` are excluded — double
  check the ignore list covers `.env*`, `certs/`, `*.pem`, `*.key`).
- **Landing to the running stack:** the `.:/repo:ro` mount requires recreating
  the `demo-api-server` container (a `node --watch` reload is not enough for a new
  volume). Call this out when landing.
- **Grounding:** the agent must answer only from retrieved snippets; the system
  prompt enforces this and the UI shows sources so answers are auditable.
- **New LlamaIndex service = new dependency + new container.** Adds a Python
  service, image build, and a port to the compose stack (heavier than the earlier
  in-BFF loop). Pin LlamaIndex versions; verify current agent + Weaviate API
  shapes via context7 before coding (the APIs move fast).
- **Local-model tool-calling reliability.** The `:8090` proxy fronts local
  llama.cpp models whose function-calling is less reliable than hosted models.
  The `single-shot` degrade path is the mitigation — the feature must still answer
  even when the model emits no tool call.
- **Embedding-space match is a correctness gate, not a nicety.** With native
  `WeaviateVectorStore`, the LlamaIndex service embeds queries itself, so it
  **must** be pinned to the `nomic-embed-text-v1.5` embeddings service (verify
  768-dim output). A mismatched embed model silently returns irrelevant results —
  this is the single most likely way to ship a broken-but-not-erroring agent, so
  it needs an explicit test (known query → expected file in results).
- **Foreign-class node reconstruction.** `WeaviateVectorStore` reads a class
  code-search created, not one LlamaIndex wrote; if the installed version requires
  a `_node_content` blob, retrieval returns empty. Verify via context7; fall back
  to a thin custom `nearVector` + `codebase_id`-filter retriever if needed.
