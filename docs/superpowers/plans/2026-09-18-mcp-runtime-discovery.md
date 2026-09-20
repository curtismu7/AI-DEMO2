# MCP Runtime Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a no-auth MCP runtime discovery agent and expose its operational and security inventory in the authenticated dashboard.

**Architecture:** A host-side standalone Node agent gathers local process, listener, Compose, client-config, and explicit remote-URL candidates. It safely probes only HTTP-like MCP endpoints with discovery/initialize and `tools/list`, runs the existing scanner, persists normalized records, and exposes a read-only API. The BFF proxies that API to an admin-only React page; the browser never receives host discovery privileges and cannot invoke tools from the inventory surface.

**Tech Stack:** Node.js >=22, ESM standalone agent with `node:test`, Express/CommonJS BFF with Jest/Supertest, React 19/Vite/Vitest UI, existing MCP Inspector transport patterns, existing `mcp-scanner` heuristics.

**Spec:** `docs/superpowers/specs/2026-09-18-mcp-runtime-discovery-design.md`

## Global Constraints

- No discovery request accepts or emits credentials, cookies, authorization headers, or secrets.
- Discovery never emits `tools/call`, `prompts/get`, `resources/read`, or other side-effecting MCP calls.
- Explicit remote URL probes are bounded by SSRF-safe target policy; local adapters may inspect local loopback/private targets only as local-scope candidates.
- Stdio processes are candidate/unprobed unless launched under an explicitly supported inspection channel.
- BFF remains the browser-token custodian; the browser talks only to the BFF.
- New UI uses existing theme tokens, allowed emoji only, `apiClient`, and `DraggableModal` if a modal is needed.
- API route errors use `{ error }`, and upstream failures are normalized without leaking request data.
- UI verification requires `npm run test:unit` and `npm run build` in `demo_api_ui`.
- Work only in this isolated worktree; stage only intended paths.

---

### Task 1: Create the standalone agent package and domain contracts

**Files:**
- Create: `standalone/mcp-discovery-agent/package.json`
- Create: `standalone/mcp-discovery-agent/README.md`
- Create: `standalone/mcp-discovery-agent/src/inventory.mjs`
- Create: `standalone/mcp-discovery-agent/src/policy.mjs`
- Create: `standalone/mcp-discovery-agent/src/redaction.mjs`
- Test: `standalone/mcp-discovery-agent/test/inventory.test.mjs`
- Test: `standalone/mcp-discovery-agent/test/policy.test.mjs`

**Interfaces:**
- `normalizeCandidate(input) -> Candidate` returns `{ id, displayName, source, confidence, location, transport, endpoint, process, container }`.
- `createInventoryRecord(candidate) -> InventoryRecord` returns the normalized record from the approved spec with `status: "candidate"` and empty probe/security fields.
- `evaluateTarget(target, context) -> { allowed, reason, normalizedUrl }` distinguishes local-adapter targets from remote URL targets.
- `redactRecord(record) -> Record` removes credentials, query secrets, environment values, and unsafe command arguments.

- [ ] **Step 1: Write failing schema and normalization tests.**

Test a Compose candidate, a host-process stdio candidate, a remote URL candidate, stable IDs, and default status values. Assert that missing optional fields become `null` or empty arrays rather than being omitted.

- [ ] **Step 2: Run the focused tests and verify they fail.**

Run: `cd standalone/mcp-discovery-agent && node --test test/inventory.test.mjs`

Expected: FAIL because the package and domain modules do not exist.

- [ ] **Step 3: Write failing target-policy and redaction tests.**

Cover allowed explicit HTTPS, rejected remote loopback/private/link-local/cloud-metadata destinations, allowed local adapter loopback, bounded redirect policy input, and removal of `Authorization`, cookies, query credentials, environment values, and command-line secret-looking arguments.

- [ ] **Step 4: Implement the package metadata, contracts, policy, and redaction helpers.**

Use ESM, `node:test`, `crypto.createHash` for stable IDs, and no network or shell access in these pure modules. Keep policy decisions explicit in the returned `reason`.

- [ ] **Step 5: Run the focused tests.**

Run: `cd standalone/mcp-discovery-agent && node --test test/inventory.test.mjs test/policy.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit the package contracts.**

```bash
git add standalone/mcp-discovery-agent/package.json standalone/mcp-discovery-agent/README.md standalone/mcp-discovery-agent/src standalone/mcp-discovery-agent/test
git commit -m "feat: add MCP discovery inventory contracts"
```

### Task 2: Implement candidate sources for host, Compose, config, and remote URLs

**Files:**
- Create: `standalone/mcp-discovery-agent/src/candidates/processes.mjs`
- Create: `standalone/mcp-discovery-agent/src/candidates/listeners.mjs`
- Create: `standalone/mcp-discovery-agent/src/candidates/compose.mjs`
- Create: `standalone/mcp-discovery-agent/src/candidates/clientConfig.mjs`
- Create: `standalone/mcp-discovery-agent/src/candidates/remoteUrls.mjs`
- Create: `standalone/mcp-discovery-agent/src/candidates/index.mjs`
- Test: `standalone/mcp-discovery-agent/test/candidates.test.mjs`

**Interfaces:**
- `discoverProcesses(execFileImpl) -> Promise<Candidate[]>` uses fixed `ps` arguments and marks likely MCP commands as stdio candidates.
- `discoverListeners(execFileImpl) -> Promise<Candidate[]>` uses fixed `lsof`/platform adapter arguments and emits HTTP-like listener candidates without probing yet.
- `discoverCompose(execFileImpl, config) -> Promise<Candidate[]>` consumes `docker ps --format` output or a supplied fixture and never requires the Docker socket in the BFF.
- `discoverClientConfigs(fsImpl, paths) -> Promise<Candidate[]>` reads only configured allowlisted files and redacts values.
- `discoverRemoteUrls(urls) -> Promise<Candidate[]>` creates configured candidates only after URL policy validation.
- `discoverCandidates(options) -> Promise<Candidate[]>` merges by stable identity while retaining all source labels.

- [ ] **Step 1: Add fixture-driven failing tests for each candidate source.**

Use injected `execFile`, filesystem, and platform fixtures. Assert fixed command arguments, no shell interpolation, no secret retention, correct source/confidence values, and deduplication of a Compose service that also appears as a listener.

- [ ] **Step 2: Run candidate tests and verify failure.**

Run: `cd standalone/mcp-discovery-agent && node --test test/candidates.test.mjs`

Expected: FAIL with missing source modules.

- [ ] **Step 3: Implement process and listener adapters.**

Use `execFile` rather than shell commands. On unsupported platforms return an empty source result with a structured source diagnostic. Do not read process environments. Only classify a process as an MCP candidate; do not attach to stdio.

- [ ] **Step 4: Implement Compose, client-config, and remote URL sources.**

Parse JSON lines from Docker output, accept only configured client-config paths, support the repo’s Compose MCP service names, and keep remote URLs explicit. Reject malformed or policy-disallowed URLs as source diagnostics rather than throwing the complete scan.

- [ ] **Step 5: Implement merge and source diagnostics.**

Deduplicate by endpoint when present, otherwise by process/container identity. Preserve `sources[]` and the strongest evidence level without claiming MCP verification.

- [ ] **Step 6: Run candidate tests and commit.**

Run: `cd standalone/mcp-discovery-agent && node --test test/candidates.test.mjs test/inventory.test.mjs test/policy.test.mjs`

```bash
git add standalone/mcp-discovery-agent/src/candidates standalone/mcp-discovery-agent/test/candidates.test.mjs
git commit -m "feat: discover MCP host and remote candidates"
```

### Task 3: Add safe MCP metadata probing and scanner integration

**Files:**
- Create: `standalone/mcp-discovery-agent/src/probe.mjs`
- Create: `standalone/mcp-discovery-agent/src/security.mjs`
- Test: `standalone/mcp-discovery-agent/test/probe.test.mjs`
- Test: `standalone/mcp-discovery-agent/test/security.test.mjs`
- Modify: `standalone/mcp-scanner/scanner.mjs` only if a pure reusable export is required; preserve existing CLI behavior.

**Interfaces:**
- `probeHttpCandidate(candidate, options) -> Promise<ProbeResult>` performs reachability, `server/discover` or legacy `initialize`, and `tools/list` only.
- `probeCandidate(candidate, options) -> Promise<InventoryRecord>` leaves stdio as `candidate/unprobed` and routes HTTP-like candidates through the safe probe.
- `analyzeToolMetadata(tools, scanner) -> { findings, toolMetadataHash }` reuses the scanner’s pure `scan()` function.
- `classifyProbeError(error) -> { status, errorCode, message }` returns the bounded status vocabulary.

- [ ] **Step 1: Write failing probe tests with local fixture servers.**

Cover modern discovery, legacy initialize fallback, `tools/list`, auth-required responses without sending auth, malformed JSON, timeout, redirect rejection, response-size limits, and a server that would fail the test if `tools/call` were sent.

- [ ] **Step 2: Run probe tests and verify failure.**

Run: `cd standalone/mcp-discovery-agent && node --test test/probe.test.mjs`

Expected: FAIL because the probe module does not exist.

- [ ] **Step 3: Implement bounded HTTP probing.**

Use `fetch` with `AbortController`, fixed headers that contain no credentials, bounded redirects, target re-validation after redirects, body-size limits, and per-candidate timeouts. Prefer `server/discover`; fall back to legacy `initialize` only for protocol-not-supported behavior.

- [ ] **Step 4: Implement scanner integration and metadata hashing.**

Import the existing scanner as a pure module dependency or use a small adapter that calls its exported `scan()` without duplicating heuristics. Record scanner version, findings, and canonical JSON hash of tool name/description/schema.

- [ ] **Step 5: Run probe/security tests and commit.**

Run: `cd standalone/mcp-discovery-agent && node --test test/probe.test.mjs test/security.test.mjs`

```bash
git add standalone/mcp-discovery-agent/src/probe.mjs standalone/mcp-discovery-agent/src/security.mjs standalone/mcp-discovery-agent/test/probe.test.mjs standalone/mcp-discovery-agent/test/security.test.mjs standalone/mcp-scanner/scanner.mjs
git commit -m "feat: safely probe and scan MCP metadata"
```

### Task 4: Add persistent inventory store, scan loop, and read-only agent API

**Files:**
- Create: `standalone/mcp-discovery-agent/src/store.mjs`
- Create: `standalone/mcp-discovery-agent/src/scanner.mjs`
- Create: `standalone/mcp-discovery-agent/src/server.mjs`
- Create: `standalone/mcp-discovery-agent/index.mjs`
- Create: `standalone/mcp-discovery-agent/test/store.test.mjs`
- Create: `standalone/mcp-discovery-agent/test/server.test.mjs`
- Modify: `standalone/mcp-discovery-agent/package.json`
- Modify: `standalone/mcp-discovery-agent/README.md`

**Interfaces:**
- `createInventoryStore({ filePath, retentionMs })` exposes `list()`, `get(id)`, `replaceScan(records)`, and `snapshot()`.
- `runScan(options) -> Promise<{ scanId, startedAt, completedAt, records, diagnostics }>` discovers, probes, scans, redacts, and persists records.
- HTTP `GET /health`, `GET /api/inventory`, `GET /api/inventory/:id`, and `POST /api/scan` return only normalized records and scan metadata.

- [ ] **Step 1: Write failing persistence tests.**

Assert atomic replacement, retention of last successful observations after failed probes, stale-record retention until the configured period, and safe recovery from a corrupt or missing file.

- [ ] **Step 2: Implement the JSON store.**

Write to a temporary sibling file and rename atomically. Store scan generation and diagnostics separately from records. Never persist raw headers, environment values, or unredacted command lines.

- [ ] **Step 3: Write failing API tests.**

Assert read-only inventory responses, asynchronous scan IDs, no credential fields accepted, no tool invocation route, and useful degraded responses when a scan source fails.

- [ ] **Step 4: Implement the scan coordinator and API.**

Use bounded concurrency, continue after individual candidate failures, and support a configurable interval. Bind to loopback by default. `POST /api/scan` queues one scan and returns `202` with a scan ID.

- [ ] **Step 5: Add CLI scripts and operator documentation.**

Provide `npm test`, `npm start`, and `npm run scan` scripts. Document explicit remote URL configuration, optional network ranges, host permission requirements, no-auth behavior, and the fact that stdio candidates are not attached.

- [ ] **Step 6: Run agent tests and commit.**

Run: `cd standalone/mcp-discovery-agent && npm test`

```bash
git add standalone/mcp-discovery-agent
git commit -m "feat: expose MCP discovery inventory API"
```

### Task 5: Add the authenticated BFF read path

**Files:**
- Create: `demo_api_server/services/mcpDiscoveryClient.js`
- Create: `demo_api_server/routes/mcpDiscovery.js`
- Test: `demo_api_server/tests/mcpDiscovery.test.js`
- Modify: `demo_api_server/server.js` near the existing MCP route mounts.
- Modify: `demo_api_server/.env.example` only if the service URL convention requires documentation.

**Interfaces:**
- `getMcpDiscoveryInventory(options) -> Promise<AgentResponse>` calls the configured agent URL with timeout and normalizes upstream failure.
- `POST /api/admin/mcp-discovery/scan` and `GET /api/admin/mcp-discovery/inventory` are admin-gated BFF endpoints.

- [ ] **Step 1: Write failing route/client tests.**

Test admin authorization, successful proxying, normalized upstream timeout/502, empty-but-valid degraded inventory, and rejection of request bodies containing credentials or tool-call fields.

- [ ] **Step 2: Run focused BFF tests and verify failure.**

Run: `cd demo_api_server && CI=true npx jest tests/mcpDiscovery.test.js --forceExit`

Expected: FAIL because the client, route, and mount do not exist.

- [ ] **Step 3: Implement the client and route.**

Use the repository’s normalized Axios error helper, configured `MCP_DISCOVERY_AGENT_URL`, strict response validation, and existing `authenticateToken`/`requireAdmin` middleware. Keep the browser-facing route under the BFF; do not proxy arbitrary agent paths.

- [ ] **Step 4: Mount the route and document configuration.**

Register the route with the existing admin API route group and add a disabled/degraded default when the agent URL is not configured. Do not add a localhost OAuth redirect or bypass session requirements.

- [ ] **Step 5: Run focused BFF tests and commit.**

Run: `cd demo_api_server && CI=true npx jest tests/mcpDiscovery.test.js --forceExit`

```bash
git add demo_api_server/services/mcpDiscoveryClient.js demo_api_server/routes/mcpDiscovery.js demo_api_server/tests/mcpDiscovery.test.js demo_api_server/server.js demo_api_server/.env.example
git commit -m "feat: proxy MCP discovery inventory through BFF"
```

### Task 6: Add the dashboard operational/security page

**Files:**
- Create: `demo_api_ui/src/pages/McpDiscoveryPage.jsx`
- Create: `demo_api_ui/src/pages/McpDiscoveryPage.css`
- Create: `demo_api_ui/src/services/mcpDiscoveryService.js`
- Test: `demo_api_ui/src/pages/__tests__/McpDiscoveryPage.test.jsx`
- Test: `demo_api_ui/src/services/__tests__/mcpDiscoveryService.test.js`
- Modify: `demo_api_ui/src/App.js`
- Modify: `demo_api_ui/src/routes/sideNavOwner.js` or the existing admin navigation source used by the page.

**Interfaces:**
- `fetchMcpDiscoveryInventory() -> Promise<AgentResponse>` uses `apiClient` and returns normalized inventory.
- `requestMcpDiscoveryScan() -> Promise<{ scanId }>` uses the BFF scan endpoint.
- `McpDiscoveryPage` renders operational and security sections without invoking tools.

- [ ] **Step 1: Read the regression UI contract before editing.**

Read `REGRESSION_PLAN.md` sections 0–1 and the existing page/theme patterns. Preserve the emoji allowlist, admin route guard, theme tokens, and existing navigation ownership.

- [ ] **Step 2: Write failing service and page tests.**

Test API calls through `apiClient`, summary counts, mixed candidate/healthy/offline records, remote/local and transport breakdowns, findings and metadata drift, heuristic disclaimer, empty/degraded agent state, and absence of any “call tool” action.

- [ ] **Step 3: Run focused UI tests and verify failure.**

Run: `cd demo_api_ui && npx vitest run src/services/__tests__/mcpDiscoveryService.test.js src/pages/__tests__/McpDiscoveryPage.test.jsx`

Expected: FAIL because the service and page do not exist.

- [ ] **Step 4: Implement the service and page.**

Use the existing refined dashboard surface, CSS theme tokens, accessible status labels, bounded polling/manual refresh, and a read-only detail view. Keep process command text redacted and display remote URL policy status without rendering secrets.

- [ ] **Step 5: Register an admin-protected route and navigation entry.**

Add `/mcp-discovery` behind the existing admin route guard and declare its auth requirement through the repository’s existing source-of-truth mechanism if the route participates in use-case authorization checks.

- [ ] **Step 6: Run focused UI tests and the required build.**

Run: `cd demo_api_ui && npx vitest run src/services/__tests__/mcpDiscoveryService.test.js src/pages/__tests__/McpDiscoveryPage.test.jsx && npm run build`

```bash
git add demo_api_ui/src/pages/McpDiscoveryPage.jsx demo_api_ui/src/pages/McpDiscoveryPage.css demo_api_ui/src/services/mcpDiscoveryService.js demo_api_ui/src/pages/__tests__/McpDiscoveryPage.test.jsx demo_api_ui/src/services/__tests__/mcpDiscoveryService.test.js demo_api_ui/src/App.js demo_api_ui/src/routes/sideNavOwner.js
git commit -m "feat: add MCP discovery dashboard"
```

### Task 7: Verify integration and hand off

**Files:**
- Modify only if required by verification: `docs/README` or agent/BFF operator docs.

- [ ] **Step 1: Run standalone agent tests.**

Run: `cd standalone/mcp-discovery-agent && npm test`

- [ ] **Step 2: Run focused BFF tests.**

Run: `cd demo_api_server && CI=true npx jest tests/mcpDiscovery.test.js --forceExit`

- [ ] **Step 3: Run focused UI tests and build.**

Run: `cd demo_api_ui && npm run test:unit && npm run build`

- [ ] **Step 4: Run topology and hygiene checks for the new route/configuration.**

Run: `npm run topology:verify && npm run hygiene:check && npm run authz:verify`

- [ ] **Step 5: Perform a no-tool-call integration smoke test.**

Start the standalone agent against a local fixture server and one explicit remote URL. Confirm the inventory contains candidate and verified records, the BFF returns only the normalized inventory, and the fixture records no `tools/call` request.

- [ ] **Step 6: Inspect the final diff and commit any documentation-only correction.**

Run: `git diff --check`, `git status --short --branch`, and `git diff HEAD~7..HEAD --stat`. Confirm only intended paths changed and no secrets or unrelated main-checkout files are present.

