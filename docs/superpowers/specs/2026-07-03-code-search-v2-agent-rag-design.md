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

- `demo_api_server/services/llamacppLlmService.js` — already calls
  `${LLAMACPP_BASE_URL}/v1/chat/completions` (the `:8090` llm-proxy). Agent chat
  (C) reuses it; no new LLM client.
- `demo_api_server/routes/codeSearch.js` `POST /index` already accepts **multiple
  files** (multer `upload.array('file')`). Folder ingest (B) reuses it.
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

## Feature C — Agent chat over the index (RAG)

### Backend — new route `POST /api/code-search/ask`
- Request `{ question, codebase_id, limit? }`.
- Steps:
  1. `getClient().search({ query: question, codebase_id, limit: limit || 8 })`.
  2. Build messages:
     - **system:** "You are a code-search assistant. Answer **only** from the
       provided snippets. Cite sources as `path:line_start-line_end`. If the
       answer isn't in the snippets, say you couldn't find it — do not invent
       code."
     - **user:** the question + the retrieved snippets formatted with their
       `file` and line range.
  3. Call `llamacppLlmService` chat/completions (`:8090` llm-proxy).
  4. Respond `{ answer, sources: [{ file, line_start, line_end, snippet }] }`
     (sources = the retrieved chunks actually passed to the model).
- Errors: embedder/LLM unreachable → `503` with a clear message (page shows
  "assistant unavailable"); empty retrieval → answer "no relevant code found".

### Frontend (`CodeSearchPage.jsx`)
- Add a **two-tab layout** on the right pane: **Ask** (agent chat) and
  **Search** (the existing raw box, unchanged).
- **Ask** tab: question input, answer area, and a **Sources** list rendering each
  cited chunk (file, line range, snippet) — reuse/extend `SearchResults` styling.
- Single-turn v1 (each question is independent). Note for later: multi-turn
  memory and a tool-calling agent loop are future enhancements, out of scope.

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
- **C:** Asking a question on the **Ask** tab returns a grounded answer with a
  Sources list whose citations match retrieved chunks; an out-of-scope question
  yields "couldn't find it," not a hallucination. The **Search** tab still works.
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
