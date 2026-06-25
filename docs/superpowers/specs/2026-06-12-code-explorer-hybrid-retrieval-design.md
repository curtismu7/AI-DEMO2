# Code Explorer — Hybrid Retrieval Design

- **Date:** 2026-06-12
- **Status:** Approved design (pre-implementation)
- **Owner:** Curtis
- **Topic:** Make the public "Code Explorer" code-Q&A tool answer from *actual source* via a hybrid (grep + codegraph) ReAct agent, and make its graph reliably fresh on startup and on a fresh install.

---

## 1. Problem & motivation

The repo ships a public **Code Explorer** page (`/code-explorer`): users ask natural-language questions ("explain the OAuth login flow", "tell me about the authorization server rules") and get streamed, code-grounded answers. It is backed by **codegraph** (`scripts/build-codegraph.py` → `.codegraph/codegraph.db`) queried by a LangChain ReAct agent (`langchain_agent`).

Three problems surfaced:

1. **The production agent never sees real code.** `build-codegraph.py` stores **metadata only** (`file_path, start_line, end_line, signature, docstring` + call edges) — no source bodies. The agent's tools (`langchain_agent/src/codegraph/db.py`: `explore/search/callers/callees`) return that metadata only. The langchain_agent Docker image copies its own `src/` + the `.db` but **not the AI-Demo source tree**. So in production the agent answers from signatures + docstrings + the call graph — it cannot read implementation. (The full-source results seen during evaluation came from the *local* `@colbymchenry` codegraph MCP daemon, which reads files off disk — a different, rosier path than what ships.)

2. **Retrieval quality is mediocre, and the wrong engine is implied.** A 6-question bake-off (codegraph vs graphify vs lexical/grep, scored against ground-truth files) found:

   | Question | codegraph | graphify | lexical (grep) |
   |---|---|---|---|
   | OAuth login | 2 | 1 | 3 |
   | Authz server rules | 1 | 1 | 5 |
   | Tool authorization | 3 | 1 | 3 |
   | RFC 8693 token chain | 2 | 1 | 5 |
   | HITL consent | 4 | 1 | 2 |
   | Family delegation | 3 | 2 | 4 |
   | **Average** | **2.5** | **1.2** | **3.7** |

   - **graphify is unusable** for code Q&A here (BFS anchors on common English words → glossary/config/package.json noise).
   - **Plain grep wins** when question vocabulary matches identifier names; its weakness is the vocabulary gap (e.g. "human-in-the-loop" → code says `hitl`/`AgentConsentModal`).
   - **codegraph is complementary** — weak at cross-package *service* retrieval, but uniquely traces callers/callees and is decent on the UI/structural layer.
   - Caveat: the bake-off measured single-shot retrieval; a ReAct agent that iterates does better — but the current agent has **only** codegraph tools, so it cannot fall back to grep (the strongest single retriever).

3. **The graph drifts and isn't guaranteed on a fresh install.** `build-codegraph.py` is **not** run by any startup script; the DB is built ad-hoc and baked into the image. `npm run setup:fresh` does build it (`setupFresh.js` → `buildCodeGraph()`), but the `SETUP.md` / `pingone:bootstrap` path does not, and the page gives no "how fresh / how to regenerate" affordance.

**Conclusion:** the lever is not "which graph engine" — it's giving the existing ReAct agent the **right tools over real source**: grep (locate, by-name), read_file (bodies), codegraph (structure). graphify is dropped. RAG/embeddings (which would close the vocabulary gap) is deferred to a future phase.

## 2. Goals

- The production Code Explorer agent can **read actual source** and **grep** it, not just metadata.
- Retrieval quality on the 6-question bake-off measurably improves over the current codegraph-only agent.
- The codegraph DB is **fresh**: rebuilt on local startup (~1s) and built at image/setup time, consistent with the shipped source.
- A **fresh clone → documented setup → working Code Explorer**, verified by a smoke test.
- The page tells users how fresh the graph is and how to regenerate it.
- The two dev-only graphs (`graphify-out/`, `.planning/graphs/`) are clearly demarcated as dev tools, not the app graph.

## 3. Non-goals

- Building a RAG / embedding retrieval layer (future phase; noted, not built).
- Changing the Code Explorer UX beyond a freshness/regenerate affordance.
- Touching the `@colbymchenry` codegraph MCP daemon (a developer's local tool) beyond avoiding a DB-path collision.
- Re-pointing graphify or `.planning/graphs` at the app.

## 4. Background — the three graph systems (for clarity)

| System | Build | Output | Consumer | Verdict |
|---|---|---|---|---|
| **codegraph** | `python3 scripts/build-codegraph.py` (stdlib only, ~1s) | `.codegraph/codegraph.db` | **The Code Explorer app** (page → BFF `codegraphProxy.js` → langchain_agent) | **Keep — the app graph** |
| **graphify** | `graphify update .` | `graphify-out/` (~24 MB) | AI-assistant/dev only | Dev tool; not app-wired; gitignored |
| **gsd-graphify** | GSD framework | `.planning/graphs/` (~24 MB) | GSD SDLC automation | Dev tool; gitignored |

Local-dev note: the `@colbymchenry/codegraph` MCP daemon (v0.9.9) also writes `.codegraph/codegraph.db` with a richer schema and a file-watcher. It and `build-codegraph.py` clobber each other on that path. A fresh-install user has no daemon, so the product is unaffected — but local dev needs the app DB isolated from the daemon's (see §6 Risks).

## 5. Design

### 5.1 Target architecture

Keep the LangChain ReAct agent. Change (a) what it can see and (b) the tools it has.

```
CodeExplorerPage.jsx
  → POST /api/codegraph/query  (BFF: codegraphProxy.js)
    → langchain_agent: codegraph_handler.py (SSE)
      → ReAct agent (codegraph_agent.py)
          tools:
            grep(pattern, globs?)        ← NEW  (strongest single retriever; pure-Python, no rg dep)
            read_file(path, start, end)  ← NEW  (actual source bodies)
            codegraph_search(term)              (locate symbols)
            codegraph_callers(symbol)           (who calls X — structural)
            codegraph_callees(symbol)           (what X calls — structural)
          over:
            REPO_SRC_ROOT  ← repo source subset (shipped into image; live tree locally)
            CODEGRAPH_DB_PATH ← .codegraph/codegraph.db (structure/call graph)
```

Agent prompt strategy: **grep-first** to locate relevant files by keyword; **read_file** to pull the actual implementation for the answer; **codegraph_callers/callees** to trace structure ("what calls X", "trace the flow"); always cite `file:line`. graphify is not referenced.

### 5.2 Components & changes (by area)

**A. Source access (the enabler)**
- `langchain_agent/Dockerfile`: add a build stage/step that places the indexed source subset (the same `.py/.js/.ts` files `build-codegraph.py` walks) under a stable path (e.g. `/app/repo-src`), and set `ENV REPO_SRC_ROOT=/app/repo-src`. Ship the DB and the source from the **same commit** so they're consistent.
- Local dev: `REPO_SRC_ROOT` defaults to the repo root (live files); no copy needed.
- `k8s/02-configmap.yaml`: add `REPO_SRC_ROOT` if it differs from the image default.

**B. Hybrid tools** (`langchain_agent/src/codegraph/`)
- New `grep` tool: pure-Python recursive search over `REPO_SRC_ROOT` (regex + optional glob filter, sized result cap). No system `ripgrep` dependency (the image is python-slim).
- New `read_file` tool: read a `path` (+ optional `start`/`end` line window) under `REPO_SRC_ROOT`, with path-traversal guard (must resolve inside the root).
- Keep `codegraph_search/callers/callees`. (Optionally retire or de-emphasize `explore` in favor of grep+read; decide in planning.)
- `agent.py` (or `codegraph_agent.py`): register the new tools; rewrite the system prompt for the grep-first → read_file → codegraph-structure strategy with `file:line` citations.

**C. Freshness / startup**
- `run.sh` (repo root): add a guarded codegraph build before/at startup (`python3 scripts/build-codegraph.py`, ~1s; skip with a warning if `python3` missing). Optionally only when stale (DB `built_at_commit` ≠ `git rev-parse HEAD`).
- `package.json`: add a friendly `codegraph:build` script aliasing `python3 scripts/build-codegraph.py` (discoverable; used by the page's "regenerate" hint and docs).
- `build-codegraph.py`: store `built_at_commit` (current HEAD) and `node_count` in a `project_metadata` table (for the staleness/affordance in E).

**D. Fresh install**
- Confirm `setup:fresh` (`setupFresh.js` → `buildCodeGraph()`) is on the documented install path; add the codegraph build to the `SETUP.md` / `pingone:bootstrap` path (or document that Code Explorer requires `npm run codegraph:build`).
- `README.md` / `docs/user-guide/SETUP.md`: mention Code Explorer and the one command to (re)build its graph.
- **Fresh-clone smoke test:** a script (and/or CI job) that clones clean, runs the documented setup, starts the agent, POSTs a question to `/api/codegraph/query`, and asserts a grounded, non-empty answer.

**E. Page affordance** (`demo_api_ui/src/components/CodeExplorerPage.jsx`)
- Add a footer: "Graph built from commit `abc1234` · N files · regenerate: `npm run codegraph:build`", with an optional "stale vs current HEAD" hint.
- Backend: small `GET /api/codegraph/meta` returning `{ built_at_commit, node_count, built_at }` from `project_metadata` (BFF proxy + langchain_agent or a direct read). Display-only.

**F. Dev graphs demarcation**
- `graphify-out/` + `.planning/graphs/` remain gitignored (already done). Add a one-line README note: these are dev-only AI-assistant graphs, **not** the Code Explorer graph (which is `.codegraph/codegraph.db`).

### 5.3 Phasing

- **P1 — Hybrid agent over real source** (the quality win): A (source access) + B (grep/read tools + prompt). Acceptance: re-run the 6-question bake-off against the new agent; scores beat the current codegraph-only path and the grep-only baseline (target avg ≥ 4).
- **P2 — Freshness & fresh install**: C + D. Acceptance: `run.sh` yields a current graph; fresh-clone smoke test passes in CI.
- **P3 — Page affordance & docs**: E + F. Acceptance: page shows build commit + regenerate command; README demarcates the three graphs.
- **Future (out of scope)** — RAG/embedding tool to close the vocabulary-gap questions (e.g. HITL). Re-run the bake-off to justify before building.

## 6. Risks & mitigations

- **Image size / source shipping** — only the indexed `.py/.js/.ts` subset (a few MB), not `node_modules`/build output. Acceptable; measure in P1.
- **DB ↔ source drift** — build the DB and copy the source in the same image step / same commit; the page shows `built_at_commit` so drift is visible.
- **`grep` in a python-slim image** — implement grep in pure Python (no system `ripgrep` dependency).
- **Path traversal via `read_file`/`grep`** — resolve every path under `REPO_SRC_ROOT` and reject escapes.
- **Local DB collision (daemon vs build-codegraph.py)** — point the app at a distinct DB path (e.g. `CODEGRAPH_DB_PATH=.codegraph/app-codegraph.db`) so the `@colbymchenry` daemon's `.codegraph/codegraph.db` and the app DB don't clobber each other. Decide the exact path in planning.
- **Public endpoint abuse** (grep/read over source on a no-auth page) — source is already public (open-source demo); still, cap result sizes and confine to `REPO_SRC_ROOT`; no writes.

## 7. Testing strategy

- **Retrieval bake-off (regression):** the 6 questions in §1, scored against the same ground-truth files, run against the **new** agent. Gate P1 on improvement.
- **Tool unit tests:** `grep` (matches, caps, glob filter), `read_file` (window, traversal guard) in `langchain_agent/tests/`.
- **Fresh-clone smoke test:** clean clone → documented setup → query → grounded answer (CI).
- **Page:** `/api/codegraph/meta` returns real commit/count; footer renders.

## 8. Open questions (resolve in planning)

1. Exact app DB path to avoid the daemon collision (`.codegraph/app-codegraph.db` vs a separate dir).
2. Whether to ship source via image COPY vs a K8s volume mount (COPY favored for parity with the baked DB).
3. Keep or retire the metadata-only `codegraph_explore` tool once grep+read exist.
4. `run.sh` rebuild: unconditional (~1s) vs stale-only (HEAD compare).
