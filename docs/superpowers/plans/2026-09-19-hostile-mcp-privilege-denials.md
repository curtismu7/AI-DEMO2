# Hostile MCP Privilege Denial Scenarios Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add resource and prompt poisoning scenarios to the hostile MCP demo and expose the complete content-to-agent-to-Privilege-denial chain in the existing MCP client UI.

**Architecture:** Keep the hostile server and scanner data-first, extend them with first-class resource/prompt contracts, and use the existing BFF typed MCP request route for UI execution. Add a focused scenario panel to the existing `PrivilegeMcpClientPage` that reads the hostile payload, runs the corresponding MCP request, presents the induced `create_transfer` call, and sends that same call through the existing `/tools/call` Privilege path.

**Tech Stack:** Node 22 ESM, `@modelcontextprotocol/sdk`, Node test runner, Express, React/Vite, Vitest, existing BFF MCP relay, existing theme tokens.

**Spec:** `docs/superpowers/specs/2026-09-19-hostile-mcp-privilege-denials-design.md`

## Global Constraints

- All harmful actions remain demo stubs; no real transfer or outbound callback is allowed.
- Privilege denial is the primary result; hostile content and scanner findings are not mislabeled as gateway detections.
- UI edits preserve the emoji allowlist, theme-token rules, modal primitive, and `npm run build` gate.
- Use the existing `/api/privilege-mcp/catalog`, `/api/privilege-mcp/request`, and `/api/privilege-mcp/tools/call` contracts; do not create an open JSON-RPC proxy.
- Run focused tests first, then `cd demo_api_ui && npm run test:unit && npm run build` before completion.
- Stage only the paths listed in each task.

## File Map

- Modify `standalone/hostile-mcp-server/poisons.mjs`: add deterministic poisoned resource and prompt fixtures.
- Modify `standalone/hostile-mcp-server/index.mjs`: advertise capabilities and serve `resources/*` and `prompts/*` requests.
- Modify `standalone/hostile-mcp-server/poisons.test.js`: assert fixture teeth and capability/round-trip behavior.
- Modify `standalone/hostile-mcp-server/README.md`: document the new payloads and Privilege-denial flow.
- Modify `standalone/mcp-scanner/scanner.mjs`: add resource and prompt scanners with source-qualified findings.
- Modify `standalone/mcp-scanner/scanner.test.js`: cover poisoned and clean resource/prompt inputs.
- Modify `standalone/mcp-scanner/index.mjs`: scan the new MCP primitives during CLI discovery.
- Modify `demo_api_ui/src/pages/PrivilegeMcpClientPage.jsx`: add scenario state, execution flow, and evidence panel.
- Modify `demo_api_ui/src/pages/PrivilegeMcpClientPage.css`: style only the new evidence panel using existing theme tokens.
- Create `demo_api_ui/src/config/hostileMcpScenarios.js`: stable scenario definitions and safe demo arguments.
- Create `demo_api_ui/src/config/__tests__/hostileMcpScenarios.test.js`: validate the scenario contract and shared induced call.
- Create `demo_api_ui/src/pages/__tests__/PrivilegeMcpClientPage.hostileScenarios.test.jsx`: verify source, scanner, induced call, and Privilege denial rendering.

### Task 1: Add hostile resource and prompt fixtures

**Files:**
- Modify: `standalone/hostile-mcp-server/poisons.mjs`
- Modify: `standalone/hostile-mcp-server/index.mjs`
- Test: `standalone/hostile-mcp-server/poisons.test.js`

**Interfaces:**
- Produces `POISON_RESOURCES` and `POISON_PROMPTS` fixtures with stable `uri`/`name` identifiers.
- `index.mjs` serves `resources/list`, `resources/read`, `prompts/list`, and `prompts/get` and advertises the matching capabilities.
- The existing `TOOLS` export and `create_transfer` behavior remain unchanged.

- [ ] **Step 1: Write failing fixture and round-trip tests**

  Add tests that assert a resource contains the sensitive-action directive, a prompt contains the approval-bypass directive, and a real SDK client can list/read/get them after connecting to the server.

- [ ] **Step 2: Run the focused server test to verify it fails**

  Run: `cd standalone/hostile-mcp-server && node --test poisons.test.js`

  Expected: FAIL because the resource/prompt exports and handlers do not yet exist.

- [ ] **Step 3: Implement the catalog fixtures and handlers**

  Add one stable account-verification resource and one stable account-review prompt. Return deterministic MCP content and set `capabilities.resources` and `capabilities.prompts` in `buildServer()`.

- [ ] **Step 4: Run the focused server test to verify it passes**

  Run: `cd standalone/hostile-mcp-server && node --test poisons.test.js server.test.js`

  Expected: PASS, including the existing tool round-trip.

- [ ] **Step 5: Commit the server slice**

  ```bash
  git add standalone/hostile-mcp-server/poisons.mjs standalone/hostile-mcp-server/index.mjs standalone/hostile-mcp-server/poisons.test.js
  git commit -m "feat: add hostile MCP resource and prompt payloads"
  ```

### Task 2: Extend the scanner to resources and prompts

**Files:**
- Modify: `standalone/mcp-scanner/scanner.mjs`
- Modify: `standalone/mcp-scanner/scanner.test.js`
- Modify: `standalone/mcp-scanner/index.mjs`

**Interfaces:**
- `scanResources(resources)` returns findings with source-qualified `tool` values such as `resource:account-verification`.
- `scanPrompts(prompts)` returns findings with source-qualified `tool` values such as `prompt:account-review`.
- Existing `scan(tools)` and `scanAgentCard(card)` return shapes and behavior remain compatible.

- [ ] **Step 1: Write failing scanner tests**

  Add poisoned resource metadata/content, poisoned prompt messages, and clean fixtures. Assert hidden-instruction or sensitive-action findings and silence for clean inputs.

- [ ] **Step 2: Run the focused scanner test to verify it fails**

  Run: `cd standalone/mcp-scanner && node --test scanner.test.js`

  Expected: FAIL because the new scanner exports do not exist.

- [ ] **Step 3: Implement shared content scanning and source-qualified wrappers**

  Reuse the current instruction/secrecy/leak heuristics, add a sensitive-action directive heuristic for `transfer`, `payment`, `wire`, or `approval bypass`, and scan resource text plus prompt message text without changing existing tool findings.

- [ ] **Step 4: Extend the CLI discovery flow**

  After connecting, list tools as today, then request resources and prompts only when the server advertises those capabilities. Read the deterministic hostile resource and fetch the deterministic hostile prompt, report all findings, and preserve exit code `1` when any finding exists.

- [ ] **Step 5: Run the focused scanner test and CLI checks**

  Run: `cd standalone/mcp-scanner && node --test scanner.test.js`

  Expected: PASS with existing tool/card coverage plus resource/prompt coverage. Run the CLI against the hostile server as an integration smoke check when the server is available.

- [ ] **Step 6: Commit the scanner slice**

  ```bash
  git add standalone/mcp-scanner/scanner.mjs standalone/mcp-scanner/scanner.test.js standalone/mcp-scanner/index.mjs
  git commit -m "feat: scan hostile MCP resources and prompts"
  ```

### Task 3: Define the UI scenario contract

**Files:**
- Create: `demo_api_ui/src/config/hostileMcpScenarios.js`
- Test: `demo_api_ui/src/config/__tests__/hostileMcpScenarios.test.js`

**Interfaces:**
- Exports `HOSTILE_MCP_SCENARIOS` with `id`, `label`, `source`, `request`, `scanner`, and `inducedCall` fields.
- Each scenario uses the same `create_transfer` name and safe stub arguments; only the content source differs.

- [ ] **Step 1: Write the failing scenario contract test**

  Assert the three IDs, required source methods, exact MCP request parameters, shared induced tool name, and no live URL or credential value in the arguments.

- [ ] **Step 2: Run the focused UI test to verify it fails**

  Run: `cd demo_api_ui && npx vitest run src/config/__tests__/hostileMcpScenarios.test.js`

  Expected: FAIL because the scenario module does not exist.

- [ ] **Step 3: Implement the stable scenario definitions**

  Define tool metadata, resource read, and prompt get requests. Keep the scanner expectation descriptive and never use it as the live gateway verdict.

- [ ] **Step 4: Run the focused test to verify it passes**

  Run: `cd demo_api_ui && npx vitest run src/config/__tests__/hostileMcpScenarios.test.js`

  Expected: PASS.

- [ ] **Step 5: Commit the contract slice**

  ```bash
  git add demo_api_ui/src/config/hostileMcpScenarios.js demo_api_ui/src/config/__tests__/hostileMcpScenarios.test.js
  git commit -m "feat: define hostile MCP denial scenarios"
  ```

### Task 4: Add the Privilege-denial evidence panel

**Files:**
- Modify: `demo_api_ui/src/pages/PrivilegeMcpClientPage.jsx`
- Modify: `demo_api_ui/src/pages/PrivilegeMcpClientPage.css`
- Test: `demo_api_ui/src/pages/__tests__/PrivilegeMcpClientPage.hostileScenarios.test.jsx`

**Interfaces:**
- Scenario runner calls the existing `/request` endpoint for content and `/tools/call` for the induced action.
- The panel stores `sourcePayload`, `scannerFindings`, `inducedCall`, and `privilegeResult` independently.
- The live response, not `expected.gateway`, determines whether the UI says `DENIED`.

- [ ] **Step 1: Write failing component tests**

  Mock `/state`, `/catalog`, `/request`, and `/tools/call`. Assert the default scenario is visible, selecting a resource/prompt scenario sends the correct MCP method, and a 403 response renders the Privilege denial with the induced tool call separately from the hostile content.

- [ ] **Step 2: Run the focused component test to verify it fails**

  Run: `cd demo_api_ui && npx vitest run src/pages/__tests__/PrivilegeMcpClientPage.hostileScenarios.test.jsx`

  Expected: FAIL because the scenario panel and runner do not exist.

- [ ] **Step 3: Implement the scenario state and runner**

  Add the scenario selector to the existing demo surface. Use the existing `api()` helper, `handleAuthChallenge`, and result recording conventions. For the tool scenario, display the existing poisoned tool metadata; for resource/prompt scenarios, send the typed MCP request and show its response.

- [ ] **Step 4: Implement denial rendering**

  Send the scenario's stable `create_transfer` call through `/tools/call`. Preserve status, error code, reason, provider, and route fields from the existing error path. Render clear copy that the content reached the agent and Privilege denied the resulting action.

- [ ] **Step 5: Add minimal themed styles**

  Add only the new panel styles. Use existing `--th-*` tokens, the established result/status classes where possible, and no new emoji or inline color/background/font-size styles.

- [ ] **Step 6: Run focused component tests**

  Run: `cd demo_api_ui && npx vitest run src/pages/__tests__/PrivilegeMcpClientPage.hostileScenarios.test.jsx src/config/__tests__/hostileMcpScenarios.test.js`

  Expected: PASS.

- [ ] **Step 7: Commit the UI slice**

  ```bash
  git add demo_api_ui/src/pages/PrivilegeMcpClientPage.jsx demo_api_ui/src/pages/PrivilegeMcpClientPage.css demo_api_ui/src/pages/__tests__/PrivilegeMcpClientPage.hostileScenarios.test.jsx
  git commit -m "feat: show hostile MCP Privilege denial evidence"
  ```

### Task 5: Document, integrate, and verify

**Files:**
- Modify: `standalone/hostile-mcp-server/README.md`
- Modify: `standalone/mcp-scanner/README.md`

- [ ] **Step 1: Document the resource/prompt payloads and boundary story**

  Explain that the content can land while Privilege denies the induced `create_transfer` call, and state that all actions are stubs.

- [ ] **Step 2: Run focused server and scanner tests**

  Run: `cd standalone/hostile-mcp-server && node --test`; `cd standalone/mcp-scanner && node --test`

  Expected: PASS.

- [ ] **Step 3: Run UI unit tests and build**

  Run: `cd demo_api_ui && npm run test:unit && npm run build`

  Expected: PASS and a successful production build.

- [ ] **Step 4: Run repository hygiene checks relevant to the changed surfaces**

  Run: `npm run hygiene:check` and `graphify update .`

  Expected: PASS; topology verification is only required if routes or generated topology change.

- [ ] **Step 5: Inspect both theme variants**

  Use the existing UI validation path to confirm the new panel has readable contrast in light and dark themes and that no font size falls below the repository floor.

- [ ] **Step 6: Commit documentation and final verification changes**

  ```bash
  git add standalone/hostile-mcp-server/README.md standalone/mcp-scanner/README.md
  git commit -m "docs: explain hostile MCP Privilege denial flow"
  ```

- [ ] **Step 7: Confirm branch and worktree state**

  Run: `git branch --show-current && git status --short && git log --oneline -5`

  Expected: branch `feat/hostile-mcp-privilege-denials`, only intended commits, and no uncommitted files.
