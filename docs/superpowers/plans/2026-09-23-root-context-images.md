# Root Context Image Build Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce Docker context scanning and transfer for the remaining images that build with the repository root as context.

**Architecture:** Keep the existing Compose contexts and Dockerfiles. Add a Dockerfile-specific ignore file beside each root-context Dockerfile so each build only exposes the paths its existing `COPY` instructions require. Explicitly exclude credentials, certificates, encrypted test fixtures, dependency trees, caches, and runtime data from any re-included trees.

**Tech Stack:** Docker BuildKit, Docker Compose, Node.js, Python.

**Spec:** User-approved chat design, 2026-09-23: optimize BFF, MCP gateway, authz server, LangChain agent, and NotebookLM root-context images with per-Dockerfile allowlists; preserve all current build inputs; benchmark the effective context from the isolated worktree.

## Global Constraints

- Keep `docker-compose.yml` build contexts and Dockerfile `COPY` instructions unchanged.
- Preserve every current `COPY` source for each Dockerfile.
- Exclude secrets, certificates, `.git`, `node_modules`, Python virtual environments, logs, and caches from the contexts.
- Use the main checkout only for read-only inspection; make edits in `.worktrees/speed-other-images`.
- Never run Docker Compose from a worktree; use `docker buildx build` for context verification.

---

### Task 1: BFF context allowlist

**Files:**
- Create: `demo_api_server/Dockerfile.dockerignore`

**Interfaces:**
- Consumes: the existing root build context and all paths named by `demo_api_server/Dockerfile` `COPY` instructions.
- Produces: a per-Dockerfile context filter with the existing BFF runtime files and code-search source trees available.

- [x] Include the BFF tree, `scope-topology.json`, `service-topology.json`, `llm-timeouts.json`, `docs/`, `graphify-out/*.kb.json`, the model catalog, the transaction-authorization snapshot, UI `src/`, and each source tree copied under `/repo`.
- [x] Add common exclusions for dependencies, VCS metadata, local env files, certificates, logs, coverage, and build caches. Exclude encrypted `.enc` fixtures from re-included code-search trees.
- [x] Review the resulting allowlist against every `COPY` in `demo_api_server/Dockerfile`.

### Task 2: Gateway and authz contexts

**Files:**
- Create: `demo_mcp_gateway/Dockerfile.dockerignore`
- Create: `demo_authz_server/Dockerfile.dockerignore`

**Interfaces:**
- Consumes: root context files copied by the gateway and authz Dockerfiles.
- Produces: independent allowlists for topology/schema/OpenAPI inputs and authz runtime/snapshot inputs.

- [x] Gateway: include `scope-topology.json`, `mcp-tool-schemas.json`, gateway package metadata and `tsconfig.json`, gateway `src/`, and both sibling OpenAPI directories.
- [x] Authz: include authz package metadata, root-level JavaScript files, `routes/`, `scope-topology.json`, and the three snapshot files copied by its Dockerfile.
- [x] Add the common exclusions and review each allowlist against every `COPY` instruction.

### Task 3: LangChain and NotebookLM contexts

**Files:**
- Create: `langchain_agent/Dockerfile.dockerignore`
- Create: `docker/notebooklm/Dockerfile.dockerignore`

**Interfaces:**
- Consumes: the LangChain runtime inputs and the NotebookLM Dockerfile.
- Produces: a LangChain allowlist for its requirements, runtime trees, indexer, and optional codegraph database; an empty effective NotebookLM context because its Dockerfile has no `COPY` or `ADD` inputs.

- [x] LangChain: include `requirements.txt`, `src/`, `scripts/`, `repo-src/`, `.env.example`, generated `codegraph.db*`, and root `scripts/build-codegraph.py`. The repo-src and database are generated build inputs; this task only filters them when present.
- [x] NotebookLM: exclude the root context with `**`; its Dockerfile installs its package directly and copies no local files.
- [x] Review both rules against every `COPY`/`ADD` instruction. A clean worktree lacks LangChain's generated `repo-src/` and database, so full-image build verification requires the documented staging step; context measurement does not.

### Task 4: Validate and benchmark contexts

**Files:**
- No additional source files.

**Interfaces:**
- Consumes: all five Dockerfile-specific ignore files.
- Produces: Dockerfile-check results plus context byte and elapsed-time measurements for each image.

- [x] Run Docker BuildKit checks for the BFF, gateway, authz, LangChain, and NotebookLM Dockerfiles from the worktree root; distinguish existing Dockerfile warnings from context-rule findings. No `CopyIgnoredFile` issues appeared. `--check` reported existing Dockerfile lints (`UndefinedVar` for `$GIT_SHA`, plus `FromAsCasing`/`$PYTHONPATH` in LangChain); NotebookLM passed cleanly.
- [x] Run builds with `--progress=plain` and record effective contexts. Gateway: 1.14 MB / 0.8s; authz: 781.88 KB / 0.5s; LangChain: 44.57 MB / 1.0s; NotebookLM: no local context transfer because it has no `COPY`/`ADD`; BFF: 189.21 MB / 1.7s on the completed build (an earlier run measured 145.37 MB / 1.2s, reflecting concurrent/generated local content). BFF, gateway, authz, and LangChain image builds completed successfully. The UI optimization previously reduced the observed 213-byte context transfer from a 578.5s context load to a fast transfer; Docker's earlier delay was directory traversal, not payload size.
- [x] Re-check the worktree: only the plan and five Dockerfile-specific ignore files are tracked changes; generated LangChain staging inputs remain ignored. `git diff --check` reported no whitespace errors.

## Benchmark notes

BuildKit contexts vary when generated source or database artifacts change between runs. The stable improvement is that BuildKit now scans/transfers only each image's declared inputs; the BFF is still comparatively large because its Dockerfile intentionally copies several complete source trees into `/repo`.
