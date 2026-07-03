# Weaviate / Vector-Search Education + Demo Guide + Log Fix — Design

**Date:** 2026-07-03
**Branch:** `worktree-weaviate-rag-education`

## Purpose

Weaviate runs in the stack as the vector store behind the RAG **Code Search**
feature, but nothing in the app explains what it is or why it's there — and its
container is spamming `"attempting to join"` logs once per second. This work adds
learner-facing content in the two existing surfaces (Learning Hub + Agent Demo
Guide) and fixes the noisy logs.

## Background — what Weaviate actually does in this repo

- Defined as the `weaviate` service in `docker-compose.yml` (~line 615), image
  `semitechnologies/weaviate:latest` (currently v1.38.2), container
  `ai-demo-weaviate`.
- **Bring-your-own-vectors**: `DEFAULT_VECTORIZER_MODULE: none`, `ENABLE_MODULES: ""`.
  Weaviate stores/searches vectors but does **not** embed anything itself.
- Embeddings come from a separate `embeddings` service — llama.cpp in
  `--embedding` mode serving `nomic-embed-text-v1.5` (OpenAI-compatible
  `/v1/embeddings`).
- The `demo-mcp-code-search` service (`demo_mcp_code_search/`) is the only
  consumer. On `POST /index` it chunks code, embeds each chunk, and writes
  vectors to Weaviate; on `POST /search` it embeds the query and asks Weaviate
  for nearest neighbors (HNSW ANN).
- **Internal-only**: no host port published; reachable only as
  `http://weaviate:8080` on the `ai-demo` compose network. The BFF talks to the
  code-search service, never to Weaviate directly.
- User-facing entry point: the **Code Search** page (`/code-search`, in the admin
  side nav). Flow: upload a codebase → it indexes → select it → type a semantic
  query (e.g. "find authentication logic") → ranked code chunks.
- BFF route: `demo_api_server/routes/codeSearch.js` mounted at `/api/code-search`
  (`POST /index`, `POST /search`), client `mcpCodeSearchClient.js`.

## Scope (approved)

1. **Learning Hub education page** on Weaviate / vector search + RAG.
2. **Agent Demo Guide** multi-step walkthrough scenario for semantic code search.
3. **Fix** the once-per-second `"attempting to join"` logs from the weaviate
   container (config-only).

Out of scope: changing the code-search service, embeddings, or the Code Search
page itself; adding new agent tools; any Weaviate schema changes.

---

## 1. Learning Hub page — "Vector Search & RAG (Weaviate)"

Reuses the established education-panel pattern (EDU id → panel component
registered in `EducationPanelsHost.js`, opened via `openEdu()`), same as
`GleanPanel`.

**Files:**
- `demo_api_ui/src/components/education/educationIds.js` — add
  `VECTOR_RAG: "vector-rag"` to the `EDU` map.
- `demo_api_ui/src/components/education/WeaviateRagPanel.js` — **new** panel using
  the shared `EducationDrawer`, with tabs:
  - **`what`** — "What is a vector database?": embeddings, semantic vs keyword
    search, ANN/HNSW — the concept, provider-neutral.
  - **`here`** — "How it's wired in this demo": the repo-specific architecture
    (`code-search → nomic-embed (llama.cpp) → Weaviate`), bring-your-own-vectors,
    internal-only networking, with an ASCII pipeline diagram.
  - **`flow`** — "Index & search": what `POST /index` and `POST /search` do
    step-by-step (chunk → embed → upsert; embed query → ANN → rank).
  - **`try`** — "Try it": short callout linking to `/code-search`.
- `demo_api_ui/src/components/education/EducationPanelsHost.js` — import
  `WeaviateRagPanel` and register `[EDU.VECTOR_RAG]: WeaviateRagPanel` in the
  registry map.
- `demo_api_ui/src/components/LearningHub.tsx` — add a card under the
  **AI Ecosystem** category:
  - `LEARNING_CATEGORIES` `ai-ecosystem.items`: `{ label: "Vector Search & RAG
    (Weaviate)", description: "How semantic code search stores and finds
    embeddings", icon: "🧬" }`.
  - `categoryActionMap["ai-ecosystem"]`: `"Vector Search & RAG (Weaviate)": () =>
    openEdu(EDU.VECTOR_RAG, "what")`.

**Panel content accuracy rules:** state plainly that Weaviate does no embedding
here (BYO vectors), that it's internal-only (no public port), and that
embeddings come from the llama.cpp `nomic-embed-text-v1.5` service — do not imply
a hosted/OpenAI vectorizer.

## 2. Agent Demo Guide — "Semantic Code Search (RAG over Weaviate)" scenario

Add one entry to `DEMO_SCENARIOS` in
`demo_api_ui/src/components/AgentDemoGuide.jsx` (~line 62), same object shape as
existing scenarios (`id`, `title`, `description`, `applicableSteps`, `steps[]`
with `action` / `prompt` / `explanation` / `watch[]`).

- **Honest compliance mapping:** `applicableSteps: ["agent-llm-reasoning"]` only.
  This is a retrieval capability, not the banking authz flow — it must not claim
  token-exchange / HITL / denial steps it never exercises. The `explanation`
  notes the code-search tool is an internal capability requiring no token
  exchange.
- **Multi-step walkthrough** (mirrors the real `/code-search` UX):
  1. **Index** — go to Code Search (nav → "Code Search"), upload a codebase.
     Explanation: each chunk is embedded by the llama.cpp embedder and its vector
     stored in Weaviate. Watch: codebase appears in "Indexed Codebases".
  2. **Search** — select the codebase, enter a *semantic* query (e.g. "find
     authentication logic"). Explanation: the query is embedded and Weaviate
     returns nearest neighbors by cosine similarity — no keyword match required.
     Watch: results appear even when exact words differ.
  3. **Interpret** — read the ranked chunks. Explanation: ordering is vector
     similarity (HNSW ANN), which is why "auth logic" surfaces `login`, `PKCE`,
     `token` code. Watch: relevance ranking, file/line context.
- `id: "code-search-rag"`, `title: "14. Semantic Code Search (RAG over Weaviate)"`.

**Verify before writing steps:** confirm the current highest scenario number and
that `applicableSteps` with a single non-authz step renders cleanly in the
compliance panel (scenario 1 already uses a partial subset, so this is
supported).

## 3. Fix the noisy `"attempting to join"` logs

**Symptom:** `ai-demo-weaviate` logs `{"action":"join", ... "msg":"attempting to
join", "local_address":"…:8300","remote_address":"…:8300"}` every second — it is
trying to join *itself* on the Raft port and never converging.

**Root cause:** the `weaviate` service has no stable cluster/Raft identity, so
v1.38's embedded Raft layer cannot complete single-node bootstrap and retries
continuously.

**Fix (config-only, `docker-compose.yml` `weaviate.environment`):** pin a stable
single-node Raft identity. Candidate vars (v1.38):
- `CLUSTER_HOSTNAME: node1`
- `RAFT_BOOTSTRAP_EXPECT: 1`
- `RAFT_JOIN: node1`

> **Must verify exact var names/values against the Weaviate v1.38 docs before
> committing** (via context7 `resolve-library-id`/`query-docs` for "weaviate", or
> the official docs). Do not guess. Success = container reaches a healthy Raft
> leader state and stops the per-second join logs.

**Persistence caution:** if the running container already has a Raft state dir in
the `weaviate-data` volume under a different node name, changing
`CLUSTER_HOSTNAME` may require clearing that volume. Because the store only holds
re-indexable code-search vectors (users re-upload codebases; nothing
authoritative lives here), a volume reset is acceptable if needed — call it out
in the plan, don't do it silently.

---

## Verification / "done" criteria

- **Learning Hub:** "Vector Search & RAG (Weaviate)" card appears under AI
  Ecosystem; clicking it opens the panel; all four tabs render; search box finds
  it by "weaviate", "vector", "rag".
- **Agent Demo Guide:** new scenario appears in the scenario list; expanding it
  shows the 3 steps; compliance panel renders without error with the single
  `agent-llm-reasoning` step.
- **Logs:** after `docker compose up` (or restart of the weaviate service), the
  per-second `"attempting to join"` lines stop; `/v1/meta` healthcheck stays
  green.
- **Build:** `demo_api_ui` compiles (no TS/lint break from the `.tsx` and `.js`
  edits).
- Content is factually consistent with the repo (BYO vectors, internal-only,
  nomic-embed) — no invented hosted-vectorizer claims.

## Risks / notes

- Weaviate Raft env var names differ across versions — the doc-verification gate
  in §3 is mandatory, not optional.
- The panel is static educational content (like the other education panels); no
  live calls to Weaviate from the panel, so no runtime coupling risk.
