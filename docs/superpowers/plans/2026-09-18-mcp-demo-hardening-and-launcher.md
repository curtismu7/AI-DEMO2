# MCP Demo Hardening and Launcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden MCP error recovery and provide a local operator launcher that starts the supported demo stack, reports readiness, and teaches another operator how to run the demo.

**Architecture:** Keep recovery inside the existing LibreChat client override, but move its lifecycle decisions into a focused, testable controller. Add a loopback-only Node launcher server that serves a static operator page and exposes only fixed start/status operations; the shell launcher remains the authority for Docker and environment handling.

**Tech Stack:** TypeScript/React/Vitest-compatible LibreChat client code, JavaScript/Node test runner, Bash, static HTML/CSS/JavaScript, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-09-18-mcp-demo-hardening-and-launcher-design.md`

## Global Constraints

- Use Node >=22 for Node services.
- The BFF remains the sole browser-token custodian; do not move tokens or secrets into the launcher.
- Use the canonical browser origin `https://local.ping-devops.com:4000`; do not add hardcoded localhost OAuth redirects.
- Keep health checks read-only and restricted to known local services.
- Do not make the browser page execute arbitrary shell commands or accept arbitrary URLs.
- Preserve the project emoji allowlist and existing theme conventions.
- Stage only intended paths and verify the branch before each commit.
- Run focused tests/builds before claiming completion; do not infer success from piped output.

---

## Task 1: Extract a bounded MCP recovery controller

**Files:**
- Create: `librechat/client-overrides/McpRecoveryController.ts`
- Test: `librechat/client-overrides/McpRecoveryController.spec.ts`
- Modify: `librechat/patches/apply-persistent-conversation-starters.mjs`
- Modify: `librechat/client-overrides/McpErrorRecovery.ts`
- Test: `librechat/client-overrides/McpErrorRecovery.spec.ts`
- Modify: `librechat/Dockerfile`

**Interfaces:**
- Consumes: selected MCP server names, an `initializeServer(serverName, force)` callback, a `deleteMessage()` callback, and a timeout duration.
- Produces: `createMcpRecoveryController(options)` returning `recover(): Promise<RecoveryResult>` with explicit result states: `recovered`, `no-server`, `authentication-required`, `reconnect-failed`, `timeout`, and `delete-failed`.

- [ ] **Step 1: Write failing controller tests**

  Define a test factory with fake server initialization and deletion callbacks. Cover:

  ```ts
  expect(await controller.recover()).toEqual({ status: 'no-server' });
  expect(initializeServer).toHaveBeenCalledTimes(0);

  const first = controller.recover();
  const second = controller.recover();
  expect(await second).toEqual({ status: 'in-flight' });
  await first;
  expect(initializeServer).toHaveBeenCalledTimes(1);

  initializeServer.mockResolvedValue({ success: false, oauthRequired: true });
  expect(await controller.recover()).toEqual({ status: 'authentication-required' });
  expect(deleteMessage).not.toHaveBeenCalled();

  initializeServer.mockResolvedValue({ success: true });
  expect(await controller.recover()).toEqual({ status: 'recovered' });
  expect(deleteMessage).toHaveBeenCalledTimes(1);
  ```

  Also test duplicate server names, a rejected initialization, a timeout, partial failure across two servers, and deletion failure. Use fake timers for timeout tests so they do not sleep in CI.

- [ ] **Step 2: Run the focused test and verify it fails**

  Run:

  ```bash
  docker build -f librechat/Dockerfile -t ai-demo-librechat:recovery-red .
  ```

  Expected: FAIL because the controller module and recovery result type do not exist yet.

- [ ] **Step 3: Implement the minimal controller**

  Implement a single-flight guard, server-name normalization, `Promise.all`/result aggregation, and a per-server timeout using `Promise.race`. Ensure the controller calls deletion only after every server returns `{ success: true, oauthRequired: false }`. Reset the in-flight guard in `finally` so a later explicit click can retry.

  Extend `McpErrorRecovery.ts` with the shared `RecoveryResult` type and pure normalization helpers. Do not put React state or network calls in these pure helpers.

  Update `apply-persistent-conversation-starters.mjs` to copy the controller and its tests into `/app/client/src/components/Chat/Messages/Content/` during the image build. Do not wire the controller into the rendered error component yet; that belongs to Task 2.

- [ ] **Step 4: Run controller and helper tests**

  Run:

  ```bash
  docker build -f librechat/Dockerfile -t ai-demo-librechat:recovery-green .
  ```

  Expected: all controller and helper tests pass with zero failures.

- [ ] **Step 5: Commit the controller unit**

  ```bash
  git add librechat/client-overrides/McpRecoveryController.ts librechat/client-overrides/McpRecoveryController.spec.ts librechat/client-overrides/McpErrorRecovery.ts librechat/client-overrides/McpErrorRecovery.spec.ts librechat/Dockerfile
  git commit -m "feat: bound MCP recovery attempts"
  ```

## Task 2: Integrate guarded recovery into the LibreChat error UI

**Files:**
- Modify: `librechat/patches/apply-persistent-conversation-starters.mjs`
- Test: `librechat/client-overrides/McpRecoveryController.spec.ts`

**Interfaces:**
- Consumes: `createMcpRecoveryController`, `useMCPServerManager`, `useMessagesOperations`, and the current conversation/message IDs.
- Produces: a `Clear error & reconnect` control that reports a bounded result and removes the persisted failed message only on `recovered`.

- [ ] **Step 1: Add integration behavior tests at the controller boundary**

  Add cases asserting that an empty `mcpValues` list cannot clear a message, OAuth-required results leave the message visible, and deletion is not attempted after any failed reconnect. Keep the React patch thin; do not duplicate controller logic in the JSX.

- [ ] **Step 2: Run the regression tests before changing the patch**

  Run:

  ```bash
  docker build -f librechat/Dockerfile -t ai-demo-librechat:recovery-baseline .
  ```

- [ ] **Step 3: Patch the upstream MessageContent component**

  Update `apply-persistent-conversation-starters.mjs` so it copies the controller and tests into the LibreChat image and wires the existing `ErrorMessage` override through the controller. The click handler must:

  ```ts
  const result = await controller.recover();
  if (result.status === 'recovered') {
    // DELETE /api/messages/:conversationId/:messageId, then remove local state.
  } else {
    // Keep the error visible and render a specific retry/authentication message.
  }
  ```

  Keep `credentials: 'include'`, encode both path IDs, and do not include error text, access tokens, or arbitrary URLs in the request.

- [ ] **Step 4: Run the LibreChat test/build gate**

  Run:

  ```bash
  node --check librechat/patches/apply-persistent-conversation-starters.mjs
  git diff --check
  docker build -f librechat/Dockerfile -t ai-demo-librechat:persistent-starters .
  ```

  Expected: the Docker build runs the existing client tests plus the new recovery tests, completes the production client build, and exits 0.

- [ ] **Step 5: Commit the integration**

  ```bash
  git add librechat/patches/apply-persistent-conversation-starters.mjs librechat/Dockerfile
  git commit -m "feat: make LibreChat MCP recovery fail safe"
  ```

## Task 3: Add a fixed-scope launcher/status server

**Files:**
- Create: `scripts/demo-launcher-server.mjs`
- Create: `scripts/demo-launcher-server.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `GET /health` or `GET /` for the launcher page, `GET /api/status` for allowlisted local checks, and `POST /api/start` for the fixed local startup command.
- Produces: JSON `{ service, status, detail }` records with no response bodies from dependencies, plus a static page server bound to `127.0.0.1` by default.

- [ ] **Step 1: Write failing server tests**

  Test the request handler without opening a real privileged server:

  ```js
  assert.equal((await request('/api/status')).statusCode, 200);
  assert.deepEqual(Object.keys((await json('/api/status')).services[0]), ['service', 'status', 'detail']);
  assert.equal((await request('/api/start', { method: 'POST' })).statusCode, 202);
  assert.equal((await request('/api/start', { method: 'PUT' })).statusCode, 405);
  assert.equal((await request('/api/proxy?url=http://example.com')).statusCode, 404);
  ```

  Stub the fixed startup callback and health probe so the tests never invoke Docker or arbitrary network access.

- [ ] **Step 2: Run the server tests and verify failure**

  Run:

  ```bash
  node --test scripts/demo-launcher-server.test.mjs
  ```

  Expected: FAIL because the launcher server module does not exist.

- [ ] **Step 3: Implement allowlisted status and start operations**

  Implement exported `createLauncherServer({ startStack, probe })` and `getAllowedServices()`. Bind to `127.0.0.1` unless an explicit loopback host is supplied. `POST /api/start` may call only the fixed `./run-docker.sh` startup path; reject a request body and never interpolate user input into a shell command. Return `202` while startup is in progress and expose its bounded status through `/api/status`.

  Probe only the configured local endpoints for LibreChat, the MCP gateway, authz server, and JWT verifier. Strip response bodies and secrets from all status output. Apply a request timeout and return `503` for a failed readiness probe.

- [ ] **Step 4: Run the server tests**

  ```bash
  node --test scripts/demo-launcher-server.test.mjs
  ```

  Expected: all route, method, loopback, allowlist, timeout, and failure-propagation tests pass.

- [ ] **Step 5: Add a package command**

  Add this exact package script:

  ```json
  "demo:launcher": "node scripts/demo-launcher-server.mjs"
  ```

  Do not add a dependency when Node’s built-in HTTP APIs are sufficient.

- [ ] **Step 6: Commit the launcher server**

  ```bash
  git add scripts/demo-launcher-server.mjs scripts/demo-launcher-server.test.mjs package.json
  git commit -m "feat: add local demo launcher service"
  ```

## Task 4: Build the operator demo page and startup wrapper

**Files:**
- Create: `docs/demo-launcher/index.html`
- Create: `scripts/start-demo-launcher.sh`
- Test: `scripts/demo-launcher-page.test.mjs`
- Modify: `scripts/demo-launcher-server.mjs`

**Interfaces:**
- Consumes: `/api/status`, `/api/start`, the canonical LibreChat URL, and fixed documentation content.
- Produces: an accessible operator page with `Check services`, `Start LibreChat`, and `Open LibreChat` actions, readiness cards, scenarios, prompts, and troubleshooting guidance.

- [ ] **Step 1: Write the page smoke test**

  Read the HTML as text and assert the presence of these exact labels and links:

  ```js
  assert.match(html, /Start LibreChat/);
  assert.match(html, /Check services/);
  assert.match(html, /Open LibreChat/);
  assert.match(html, /local\.ping-devops\.com:4000/);
  assert.match(html, /Policy Guardrails/);
  assert.match(html, /AGENT_EXPECTED_MCP_TOOLS_UNAVAILABLE/);
  assert.doesNotMatch(html, /client_secret|access_token|refresh_token/);
  ```

  Also assert that health requests use only `/api/status` and that external URLs are not accepted from query parameters.

- [ ] **Step 2: Run the page test and verify failure**

  ```bash
  node --test scripts/demo-launcher-page.test.mjs
  ```

  Expected: FAIL because the launcher page and test do not exist.

- [ ] **Step 3: Implement the launcher page**

  Create a static page with semantic sections:

  - `Ready the demo`: startup command, service readiness cards, and status timestamp.
  - `Run the happy path`: sign in with PingOne, choose the Policy Guardrails agent, select the matching MCP server, and run copyable prompts.
  - `Show the controls`: explain server colors, reconnect, MCP tools, and the 503 recovery button.
  - `Teach the guardrails`: document the expected 403 authorization lesson and the expected 503 gateway-outage lesson.
  - `If something fails`: exact commands for `status`, targeted logs, gateway startup, and browser-origin correction.

  Use the project’s existing visual language and allowlisted glyphs only. The page must remain usable without JavaScript for its instructions; JavaScript should enhance status checks and button actions. Do not inline secrets or credentials.

- [ ] **Step 4: Implement the startup wrapper**

  Add `scripts/start-demo-launcher.sh` with `set -euo pipefail`. It will resolve the repository root, invoke the existing supported `run-docker.sh` startup command, start the fixed launcher server, print the launcher URL, and optionally open it using the platform’s existing browser command when available. It must propagate a non-zero startup failure and must not use `docker compose` from an alternate worktree.

- [ ] **Step 5: Add static serving and test the page**

  Serve only `docs/demo-launcher/index.html` and the required static assets. Reject path traversal and unsupported methods. Run:

  ```bash
  node --test scripts/demo-launcher-page.test.mjs scripts/demo-launcher-server.test.mjs
  ```

  Expected: all page content, static serving, status, start, allowlist, and method tests pass.

- [ ] **Step 6: Commit the operator surface**

  ```bash
  git add docs/demo-launcher/index.html scripts/start-demo-launcher.sh scripts/demo-launcher-page.test.mjs scripts/demo-launcher-server.mjs
  git commit -m "feat: add demo operator launcher"
  ```

## Task 5: Full verification and local acceptance

**Files:**
- Modify: none unless verification exposes a defect.
- Test: all focused tests and repository checks below.

**Interfaces:**
- Consumes: the committed recovery, launcher, and page changes.
- Produces: fresh evidence that the local demo starts, reports readiness, opens LibreChat, and recovers from MCP failures without unsafe clearing.

- [ ] **Step 1: Run static and focused checks**

  ```bash
  git diff --check
  node --check scripts/demo-launcher-server.mjs
  bash -n scripts/start-demo-launcher.sh
  node --test scripts/demo-launcher-server.test.mjs scripts/demo-launcher-page.test.mjs
  ```

- [ ] **Step 2: Run project topology and hygiene checks**

  ```bash
  npm run topology:verify
  npm run hygiene:check
  npm run authz:verify
  ```

  Run `authz:verify` only if the launcher links or route changes touch the protected UI/auth surface; otherwise record why it was not needed.

- [ ] **Step 3: Rebuild and recreate the local LibreChat API**

  ```bash
  docker build -f librechat/Dockerfile -t ai-demo-librechat:persistent-starters .
  docker compose -f librechat/docker-compose.yml up -d --force-recreate api
  ```

  Verify the container contains the recovery label and serves HTTP 200. Keep MongoDB data intact.

- [ ] **Step 4: Start the gateway dependency and verify readiness**

  ```bash
  docker compose --profile demo-auth up -d mcp-gateway
  docker ps --format '{{.Names}}\t{{.Status}}'
  curl -fsS http://localhost:3080
  ```

  Check that `mcp-gateway`, `mcp-jwt-verifier`, and `authz-server` are healthy before reporting the demo ready.

- [ ] **Step 5: Perform the manual acceptance flow**

  Open the launcher, click `Check services`, click `Open LibreChat`, sign in through PingOne on the canonical origin, choose Policy Guardrails and its selected MCP server, run a healthy prompt, then simulate/select the unavailable path. Confirm the recovery control reconnects once, only clears after success, and leaves the error visible for OAuth-required or failed reconnect results.

- [ ] **Step 6: Commit the verified integration state**

  ```bash
  git status --short
  git diff --check
  git add librechat/client-overrides/McpRecoveryController.ts librechat/client-overrides/McpRecoveryController.spec.ts librechat/client-overrides/McpErrorRecovery.ts librechat/client-overrides/McpErrorRecovery.spec.ts librechat/patches/apply-persistent-conversation-starters.mjs librechat/Dockerfile scripts/demo-launcher-server.mjs scripts/demo-launcher-server.test.mjs scripts/demo-launcher-page.test.mjs scripts/start-demo-launcher.sh docs/demo-launcher/index.html package.json
  git commit -m "feat: harden MCP demo operations"
  ```

  Before committing, verify `git branch --show-current`, inspect the staged file list, and confirm `.gitignore` or unrelated existing changes are not included.
