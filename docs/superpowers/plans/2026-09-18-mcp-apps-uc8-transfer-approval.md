# MCP Apps UC8 Transfer Approval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pilot a server-delivered MCP App for the existing UC8 $300 transfer-consent flow while preserving the current HITL enforcement and structured fallback.

**Architecture:** The BFF serves a same-origin, credential-free transfer-approval App resource with `text/html;profile=mcp-app`. The React host embeds it in the existing transaction-consent modal, sends the server-fetched snapshot into the sandbox, and translates App `tools/call`-shaped messages into the existing local confirm/reject handlers. The backend remains authoritative; no token or direct API access is exposed to the iframe.

**Tech Stack:** Express/CommonJS BFF, React 19/Vite, TypeScript React transaction modal, sandboxed iframe, Vitest, Jest.

**Spec:** UC8 existing HITL flow and `REGRESSION_PLAN.md` §0–§1; the existing transfer consent challenge remains the source of truth.

## Global Constraints

- Do not change `services/transactionConsentChallenge.js` or `routes/transactions.js` enforcement semantics.
- Do not change the `hitl-consent` use-case ID, expected outcome, proof scoring, or retry payload.
- The iframe must have no credentials, API calls, or access to the parent DOM; all actions cross the host `postMessage` bridge.
- Preserve the existing transaction-consent modal as the fallback when the App resource or bridge is unavailable.
- Use only the project emoji allowlist; the new Demo Steps label uses `✦`.
- After UI edits, run `cd demo_api_ui && npm run test:unit && npm run build`.

### Task 1: Add the transfer-approval App resource

**Files:**
- Create: `demo_api_server/public/mcp-apps/transfer-approval.html`
- Create: `demo_api_server/routes/mcpApps.js`
- Modify: `demo_api_server/server.js`
- Test: `demo_api_server/tests/mcpAppsRoute.test.js`

**Interfaces:**
- Produces `GET /api/mcp/apps/transfer-approval` with MIME type `text/html;profile=mcp-app`.
- The App listens for `mcp-app-host-init` containing `{ snapshot, accounts }` and emits `{ method: 'tools/call', params: { name: 'approve_transfer' } }` or `reject_transfer`.
- The App never calls `fetch`, reads cookies, or receives tokens.

- [ ] Write a failing route/resource test asserting the route returns the MCP App MIME type, contains the bridge method names, and contains no `fetch(` or token strings.
- [ ] Run the focused BFF test and confirm it fails because the route does not exist.
- [ ] Add the static App resource and authenticated Express route.
- [ ] Mount the route under `/api/mcp/apps`.
- [ ] Run the focused test and confirm it passes.

### Task 2: Add the React MCP App host bridge

**Files:**
- Create: `demo_api_ui/src/components/McpTransferApprovalFrame.tsx`
- Create: `demo_api_ui/src/components/McpTransferApprovalFrame.css`
- Test: `demo_api_ui/src/components/__tests__/McpTransferApprovalFrame.test.jsx`

**Interfaces:**
- Props: `{ snapshot, accounts, onApprove, onReject, disabled }`.
- Renders a sandboxed iframe with `sandbox="allow-scripts"` and the BFF App resource URL.
- Sends the snapshot only after the iframe sends `mcp-app-ready`.
- Calls `onApprove`/`onReject` only for messages from the iframe's own `contentWindow` and with the expected method/tool names.

- [ ] Write failing tests for sandboxing, initialization, approve dispatch, reject dispatch, and ignoring unrelated messages.
- [ ] Run the focused Vitest test and confirm it fails because the component does not exist.
- [ ] Implement the minimal host bridge and accessible loading/error fallback.
- [ ] Run the focused Vitest test and confirm it passes.

### Task 3: Insert the App into UC8 without changing HITL semantics

**Files:**
- Modify: `demo_api_ui/src/components/TransactionConsentModal.tsx`
- Modify: `demo_api_ui/src/components/AIAgent.js`
- Modify: `demo_api_ui/src/components/AIAgentFull.js`
- Test: `demo_api_ui/src/components/__tests__/TransactionConsentModal.mcpApp.test.jsx`

**Interfaces:**
- `TransactionConsentModal` gains optional `mcpApp?: boolean`; default remains `false`.
- The existing review-step `handleConfirm`, `handleCancelClick`, and `onDeclinedConfirmed` remain the only approval/rejection handlers.
- AIAgent and AIAgentFull set `mcpApp: useCaseId === 'hitl-consent'` on the existing `hitlChallengeId` state object.

- [ ] Add a failing test proving `mcpApp` renders the host frame and that its approve/reject events invoke the existing modal callbacks.
- [ ] Run the focused test and confirm it fails.
- [ ] Add the prop and render the frame only on the initial consent-review step; leave MFA/OTP/device/contact screens unchanged.
- [ ] Thread the UC8 marker through both agent components.
- [ ] Run the focused test plus existing transaction-consent tests and confirm they pass.

### Task 4: Label the existing UC8 Demo Steps chip

**Files:**
- Modify: `demo_api_server/config/useCases.js`
- Modify: `demo_api_ui/src/components/DemoStepsDropdown.jsx`
- Test: `demo_api_ui/src/components/__tests__/DemoStepsDropdown.mcpApp.test.jsx`

**Interfaces:**
- UC8 keeps `title: 'HITL consent'` and gains `demoLabel: '✦ MCP App · transfer approval'`.
- Demo Steps renders `uc.demoLabel || uc.title`, while all other use cases retain current labels.

- [ ] Add a failing test for the UC8 label and fallback behavior.
- [ ] Run the focused test and confirm it fails.
- [ ] Implement the optional label rendering and UC8 metadata.
- [ ] Run the focused test and the full UI unit suite.

### Task 5: Verify the pilot

**Files:**
- No additional production files.

- [ ] Run focused BFF tests for `mcpAppsRoute.test.js`.
- [ ] Run focused UI tests for the App frame, transaction consent, and Demo Steps.
- [ ] Run `cd demo_api_ui && npm run test:unit && npm run build`.
- [ ] Run `git diff --check` and inspect the final diff for protected HITL files.
- [ ] Run `graphify update .` from the worktree root.
