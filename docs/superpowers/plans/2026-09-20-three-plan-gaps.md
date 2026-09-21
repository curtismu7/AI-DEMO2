# Three Plan Gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the local, testable foundations for SPIFFE/SPIRE workload identity, autonomous-agent PingOne identity provisioning, and Apache Tika-backed Learning Hub document retrieval.

**Architecture:** SPIRE runs only under an opt-in Compose profile and exposes a shared Workload API socket; the BFF reads rotating PEM material through a small adapter and uses it only when the SPIFFE client-auth flag is enabled. Autonomous agent registrations are provisioned by an idempotent dry-run-first Management API script and resolved by the existing scheduler. Tika is a private RAG-profile service; the code-search service gains a separate document extraction/chunking/store path without changing CodeChunk behavior.

**Tech Stack:** Node.js/CommonJS, Express, Jest, Docker Compose, SPIRE 1.15.2, TypeScript, Apache Tika Server, Weaviate, existing embedding service.

**Spec:** `docs/SPIFFE_PLAN.md`, `planning/PLAN-autonomous-vs-worker-agents.md`, `planning/PLAN-learning-hub-document-rag-tika.md`

## Global Constraints

- Do not mutate the live PingOne tenant; provisioning code must support `--dry-run` and be unit-tested with mocked Management API calls.
- SPIFFE/SPIRE is opt-in; the default Compose stack and existing client-secret/private-key paths remain unchanged.
- Do not hand-edit generated topology or schema output; update source and run the owning verification scripts.
- Preserve the BFF-only token custody boundary and the UI emoji allowlist.
- Tika must be private to the RAG network and must not be exposed on a host port by default.

---

### Task 1: SPIFFE workload identity adapter

**Files:**
- Create: `demo_api_server/services/spiffeWorkloadClient.js`
- Modify: `demo_api_server/services/clientAssertionService.js`
- Modify: `demo_api_server/services/configStore.js`
- Test: `demo_api_server/tests/services/spiffeWorkloadClient.test.js`
- Test: `demo_api_server/tests/clientAssertionService.spiffe.test.js`

- [ ] Write tests for PEM/JWT-SVID reads, cache invalidation, and flag-gated client assertions.
- [ ] Run the focused tests and confirm they fail for the missing adapter/integration.
- [ ] Implement the adapter and configuration keys with fail-closed behavior.
- [ ] Run the focused tests and Node syntax checks.

### Task 2: Local SPIRE Compose profile

**Files:**
- Create: `spiffe/docker-compose/spire-server.conf`
- Create: `spiffe/docker-compose/spire-agent.conf`
- Create: `spiffe/docker-compose/entries.sh`
- Modify: `docker-compose.yml`
- Create: `spiffe/README.md`

- [ ] Add pinned SPIRE server/agent services under the `spiffe` profile with a shared socket volume.
- [ ] Add deterministic local registration entries for BFF, agent, gateway, and MCP workloads.
- [ ] Validate Compose interpolation/config without starting the shared stack.

### Task 3: Autonomous-agent PingOne provisioning

**Files:**
- Create: `demo_api_server/scripts/provisionAutonomousAgents.js`
- Modify: `demo_api_server/services/agentIdentity.js`
- Modify: `demo_api_server/package.json`
- Test: `demo_api_server/tests/provisionAutonomousAgents.test.js`
- Test: `demo_api_server/tests/services/agentIdentity.test.js`

- [ ] Write tests for deterministic app definitions, dry-run output, idempotent create/update decisions, and missing own credentials.
- [ ] Run the focused tests and confirm they fail.
- [ ] Implement Management API discovery/create/update using the existing credential and HTTP patterns.
- [ ] Add an npm command that defaults to dry-run and requires `--apply` for mutation.
- [ ] Run the focused tests and syntax checks; do not run `--apply`.

### Task 4: Tika extraction and document chunking

**Files:**
- Create: `demo_mcp_code_search/src/documentExtractor.ts`
- Create: `demo_mcp_code_search/src/documentChunker.ts`
- Create: `demo_mcp_code_search/src/documentExtractor.test.ts`
- Create: `demo_mcp_code_search/src/documentChunker.test.ts`
- Modify: `demo_mcp_code_search/package.json`

- [ ] Write tests for Tika response normalization, limits/timeouts, headings/pages, stable chunk IDs, overlap, and duplicate suppression.
- [ ] Run the focused tests and confirm they fail.
- [ ] Implement the typed extraction client and citation-preserving chunker.
- [ ] Run the focused TypeScript tests/build.

### Task 5: Document Weaviate path and service endpoints

**Files:**
- Modify: `demo_mcp_code_search/src/weaviateStore.ts`
- Modify: `demo_mcp_code_search/src/server.ts`
- Modify: `demo_mcp_code_search/src/index.ts`
- Test: `demo_mcp_code_search/src/server.test.ts`
- Test: `demo_mcp_code_search/src/weaviateStore.test.ts`

- [ ] Write endpoint/store tests for document index, list, search, and citation response shapes.
- [ ] Implement a separate `DocumentChunk` store path and atomic document replacement.
- [ ] Add `/documents`, `/documents/index`, and `/documents/search` routes without changing code-search routes.
- [ ] Run the full code-search test/build commands.

### Task 6: Tika Compose/Kubernetes wiring and Learning Hub integration

**Files:**
- Modify: `docker-compose.yml`
- Modify: `k8s/72-rag-stack.yaml`
- Modify: `demo_api_server/config/runtimeSettings.js`
- Modify: `demo_api_server/routes/health.js`
- Modify: `demo_api_ui/src/components/LearningHub.tsx`
- Modify: `demo_api_ui/src/components/__tests__/LearningHub.vectorrag.test.tsx`

- [ ] Add a pinned private Tika service to the RAG profile and a Kubernetes deployment/service with resource limits.
- [ ] Add health/config visibility for Tika without exposing credentials or raw document content.
- [ ] Add the smallest Learning Hub entry/action that displays document index/search status and citations.
- [ ] Run UI unit tests/build and YAML/config validation.

### Task 7: Cross-service verification and handoff

- [ ] Run focused BFF tests, code-search tests/build, UI tests/build, `npm run topology:verify`, and `npm run hygiene:check` if affected.
- [ ] Review the diff for live-tenant mutation, secrets, localhost OAuth redirects, and non-allowlisted emoji.
- [ ] Update the three source plan documents with accurate shipped/remaining status.
- [ ] Stage only intended files and report remaining plan gaps separately.
