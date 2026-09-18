# Task 2 report — guarded LibreChat MCP recovery UI

## Scope

Updated `librechat/patches/apply-persistent-conversation-starters.mjs` to copy the reviewed recovery controller into the LibreChat image and patch `MessageContent.tsx` with a thin controller-backed recovery control.

## Behavior

- `AGENT_EXPECTED_MCP_TOOLS_UNAVAILABLE` errors display **Clear error & reconnect**.
- The UI supplies the selected MCP servers and the upstream `initializeServer` operation to `createMcpRecoveryController`; reconnect policy, timeout handling, OAuth-required behavior, duplicate-click protection, and deletion gating remain in the controller.
- The message DELETE uses only the fixed `/api/messages/:conversationId/:messageId` route, encodes both identifiers, and sends `credentials: 'include'`.
- The local message is removed only after the DELETE succeeds. A controller result other than `recovered` keeps the error visible and displays a specific retry or authentication message.
- Missing message identifiers cause the deletion callback to fail safely, leaving the error visible.

## Test coverage

The reviewed controller test suite already covers the integration boundary required by this task:

- no selected MCP server does not initialize or delete;
- OAuth-required reconnect keeps the message visible;
- rejected or partially failed reconnects do not delete;
- timeout and duplicate/overlapping recovery attempts remain bounded;
- deletion failures are reported rather than clearing local state.

## Verification

Executed from the `librechat/` Docker build context because `librechat/Dockerfile` copies `patches/` and `client-overrides/` relative to that context.

1. Baseline: `docker build -f Dockerfile -t ai-demo-librechat:recovery-baseline .` — exit 0.
2. Syntax: `node --check librechat/patches/apply-persistent-conversation-starters.mjs` — exit 0.
3. Diff integrity: `git diff --check` — exit 0.
4. Final gate: `docker build --progress=plain -f Dockerfile -t ai-demo-librechat:persistent-starters .` — exit 0.
   - Client tests: 4 suites, 25 tests passed.
   - Production client build completed.
5. Built-image inspection confirmed `MessageContent.tsx` imports and creates `createMcpRecoveryController`, renders the recovery control, and includes `McpRecoveryController.ts`.

## Self-review

- No controller state-machine logic was duplicated in JSX.
- All request inputs are fixed or encoded local identifiers; error text, tokens, and external URLs are excluded.
- Only the required LibreChat patch changed. This report is an execution artifact and is intentionally not staged with the implementation commit.

## Fix round 1 — stable recovery controller across rerenders

### Finding addressed

`ErrorMessage` previously recreated `createMcpRecoveryController` through `useMemo` whenever MCP or message-operation hook references changed. A rerender while recovery was active could therefore discard the controller that held the single-flight guard.

### Fix

- `ErrorMessage` now creates the controller once with `useRef`.
- A second ref holds the current selected server names, initializer, message operations, and message identifiers. The stable controller reads that ref when a recovery begins, so it uses current inputs without being recreated.
- `McpRecoveryController` accepts a server-name supplier, retaining its operation map and in-flight guard across UI rerenders.

### Regression coverage

- Task 1 controller tests are inherited unchanged and continue to cover empty selection, OAuth-required, failures, timeout, and overlap behavior.
- New boundary test: `keeps its single-flight guard when current recovery inputs change during a rerender`. It starts an unresolved recovery, replaces the live initializer to model a rerender, and proves the second recovery is `in-flight` without invoking the replacement initializer.

### Verification

- Red phase: the new boundary test failed before supplier support was implemented.
- Final gate: `docker build --progress=plain -f Dockerfile -t ai-demo-librechat:persistent-starters .` from `librechat/` completed successfully.
  - 4 client suites, 26 tests passed.
  - Production client build completed.
  - `node --check librechat/patches/apply-persistent-conversation-starters.mjs` and `git diff --check` passed.

## Fix round 2 — committed live inputs and message-scoped recovery

### Findings addressed

- MCP connection inputs were written to a ref during render.
- A rerender could replace the message identifiers used by an in-flight recovery before its DELETE.
- Prior coverage did not mount the actual `ErrorMessage` integration.

### Fix

- MCP server selection and initializer references are now written to the latest-input ref in `useLayoutEffect`, so only committed renders update them.
- The stable controller snapshots its complete recovery inputs before the first await. The initializer and server selection from the click-time committed state cannot change mid-attempt.
- `handleRecovery` creates a message-deletion closure that captures the current conversation ID, message ID, and local message operations. The controller receives that closure as the current attempt's deletion operation, so a later rerender cannot redirect the DELETE.
- The recovery deletion ref is set only for an active click and cleared when that attempt resolves; duplicate clicks remain blocked.

### Regression coverage

- Added `McpRecoveryErrorMessage.spec.tsx` in the same upstream LibreChat test environment.
- The test renders `ErrorMessage` for message A, starts recovery, rerenders the same component as message B before initialization settles, and verifies the DELETE still targets A, B's initializer is not invoked, and local state removes only A.
- The red phase reproduced the original defect: the pre-fix UI attempted `DELETE /api/messages/conversation-second/message-second` after rerendering from A to B.

### Verification

- `node --check librechat/patches/apply-persistent-conversation-starters.mjs` — passed.
- `git diff --check` — passed.
- `docker build --progress=plain -f Dockerfile -t ai-demo-librechat:persistent-starters .` from `librechat/` — passed.
  - 5 client suites, 27 tests passed.
  - Production client build and image export completed.

## Fix round 3 — attempt-scoped deletion callback

### Finding addressed

The stable recovery controller received a deletion function that dereferenced
`recoveryDeleteRef.current` when deletion occurred. Although the ref was
guarded, the controller itself did not own an immutable callback for the
specific recovery attempt.

### Fix

- `createMcpRecoveryController` now accepts only live MCP connection inputs.
  Its `recover(deleteMessage)` method receives the click-time deletion closure
  and passes it through the attempt unchanged.
- `ErrorMessage` captures the current conversation/message IDs and local
  message operations in its existing per-click closure, then passes that
  closure directly to `controller.recover(deleteMessage)`.
- Removed `recoveryDeleteRef`; the committed MCP-input ref, message-ID
  snapshot, and stable controller ref remain in place.

### Regression coverage

- Added controller coverage proving recovery invokes the deletion callback
  supplied to that attempt rather than a previously configured callback.
- Extended the mounted `ErrorMessage` rerender test to click the recovery
  control a second time while the first attempt is active. It verifies the
  original initializer runs once and the rerendered server initializer is not
  invoked.

### Verification

- `node --check patches/apply-persistent-conversation-starters.mjs` from
  `librechat/` — exit 0.
- `git diff --check` from `librechat/` — exit 0.
- `docker build --progress=plain -f Dockerfile -t
  ai-demo-librechat:persistent-starters .` from `librechat/` — exit 0.
  The focused client gate passed all 5 suites (28 tests), followed by the
  production client build and image export.
