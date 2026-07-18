# Token Chain Full Coverage & Dynamic Steps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Token Chain panel show every step of a real agent turn — including MCP tool discovery (`tools/list`) and every PingOne network call made during that turn — and make steps appear live as they happen instead of arriving as one batch after the turn finishes.

**Architecture:** Three independent phases, each shippable and testable alone. Phase 1 fixes a dead/mis-shaped `tools/list` event so it becomes a real Token Chain step. Phase 2 builds the live-push pipe (server pushes each `buildTokenEvent`-shaped event through the SSE hub the instant it's created; the client appends instead of replacing). Phase 3 adds the remaining PingOne-call steps (Authorize-decision normalization, PingOne Admin/Management API calls) using the now-dynamic pipe.

**Tech Stack:** Node/Express (`demo_api_server`), React (`demo_api_ui`), server-sent events via `mcpFlowSseHub`.

## Global Constraints

- Work happens in an isolated git worktree per repo convention; never edit the main checkout directly.
- `REGRESSION_PLAN.md` §0/§1 govern the BFF session layer and banking UI — this plan touches `demo_api_ui/src/context/TokenChainContext.js`, `demo_api_ui/src/components/TokenChainDisplay.js`-adjacent files, and several `demo_api_server/services/*.js` files. Run `.claude/skills/regression-guard/` before Phase 2/3 tasks that touch the UI, and keep diffs minimal.
- Emoji allowlist for any new UI copy: `⚠️` `✅` `❌` `🔐` `✕` `✓` `👤` `🔑` `🪟` `📚` — no others.
- New server-side events MUST use `buildTokenEvent(id, label, status, decoded, explanation, extra)` — this is the stable `{id,label,status,timestamp,claims,explanation,...}` shape `TokenChainDisplay.js`'s generic `EventRow` renderer expects. Do not invent a new event shape.
- No new step needs a bespoke `TokenChainDisplay.js` "EduBox" component to be visible — `EventRow` (demo_api_ui/src/components/TokenChainDisplay.js:2892) already renders `event.label`/`event.status`/`event.explanation`/`event.claims` generically for any id. Specialized EduBoxes are optional polish, not required for correctness.

---

## Background — what's already there vs. what's missing

Confirmed by direct code reading (not assumption):

- **Already working today:** RFC 8693 token exchange steps (`exchange-in-progress`/`exchanged-token`), login + session-token introspection (`session-token-introspection`, `demo_api_server/services/mcpToolPipeline.js:497-583`), JWKS verification of exchanged/actor tokens (`pushJwksVerifyEvent`, `demo_api_server/services/agentMcpTokenService.js:433`), and the four gateway-reported steps `gw-mtls`/`gw-introspection`/`gw-authorize`/`gw-mcp-audit` (unpacked from the gateway's `X-Gw-Audit-Trail` response header at `demo_api_server/services/mcpToolPipeline.js:625-696`).
- **`tools/list` is broken, not missing:** `demo_api_server/services/agentGatewayClient.js`'s `getAvailableTools` (called live on every AG-UI turn via `demo_api_server/routes/agentRun.js:294`) DOES call MCP `tools/list` and DOES call `req.recordTokenEvent(...)` on success/failure — but `recordTokenEvent` (`demo_api_server/middleware/agentSessionMiddleware.js:156`) pushes into `req.tokenEvents`, a completely different array than the one `getAvailableTools` actually **returns** (`const tokenEvents = []` declared at `agentGatewayClient.js:53`, only populated from an optional `response.data.result.tokenEvents` field the gateway essentially never sends). The array `agentRun.js` merges into `initialTokenEvents` (`agentRun.js:315`) is therefore always empty. Two bugs, one fix: build a proper `buildTokenEvent` and push it into the array that's actually returned.
- **Delivery is batch, but the live-push primitive already exists:** the server has `publishTokenEventsToSse(flowTraceId, tokenEvents)` (`demo_api_server/server.js:1609`), which loops an array and calls `mcpFlowSseHub.publish(flowTraceId, buildSsePayload('token-event', event))` **per event**. It's called exactly once per tool call, right after token resolution (`mcpToolPipeline.js:153`) — the four `gw-*` steps discovered later in the same call are never pushed live, only returned in the final HTTP response. On the client, `demo_api_ui/src/services/demoAgentService.js` already opens a per-turn SSE connection (`openMcpFlowSse(flowTraceId, ...)`) in **both** `callMcpTool` (~line 221) and `sendAgentMessage` (~line 1037) and both **already receive** `{type:'token-event', ...}` frames — but only `callMcpTool`'s handler does anything with them (forwards to the unrelated API Traffic panel via `appendTokenEvents` from `apiTrafficStore.js`, not Token Chain). `sendAgentMessage` — the function behind every chip click and heuristic-matched action — drops them on the floor entirely. Neither path calls anything on `TokenChainContext`. `TokenChainContext.setTokenEvents` (`demo_api_ui/src/context/TokenChainContext.js:142`) always **replaces** `events` wholesale; there is no append method today.

This means Phase 2 is smaller than it sounds: the transport (SSE connection, per-event server push) already exists end-to-end. What's missing is (a) the server pushing the *later* pipeline stages, not just stage 1, and (b) an append path on the client that both SSE handlers feed into.

---

## File Structure

| File | Responsibility |
|---|---|
| `demo_api_server/services/agentGatewayClient.js` | **Modify** — fix `tools/list` event shape/array (Phase 1) |
| `demo_api_server/services/mcpToolPipeline.js` | **Modify** — push `gw-*` events live as soon as the audit trail arrives; normalize the Authorize step (Phase 2, 3) |
| `demo_api_ui/src/services/tokenChainTrace/tokenChainTraceStore.js` | **Modify** — add `ingestTokenEvent` (singular append) alongside existing `ingestTokenEvents` (Phase 2) |
| `demo_api_ui/src/context/TokenChainContext.js` | **Modify** — add `appendTokenEvent(tool, event)` (dedup-by-id append, does not touch history) (Phase 2) |
| `demo_api_ui/src/services/demoAgentService.js` | **Modify** — both `openMcpFlowSse` handlers accept an `onTokenEvent` callback and invoke it on `{type:'token-event'}` frames (Phase 2) |
| `demo_api_ui/src/components/AIAgent.js` | **Modify** — pass `onTokenEvent: (ev) => tokenChain.appendTokenEvent(actionId, ev)` at the `callMcpTool`/`sendAgentMessage` call sites (Phase 2) |
| `demo_api_server/services/adminAgentService.js` | **Modify** — wrap `executeAdminTool` in a closure that pushes a PingOne Admin API step per tool call (Phase 3) |
| Tests: `demo_api_server/src/__tests__/agentGatewayClient.toolsList.test.js` (new), `demo_api_server/tests/mcpToolPipeline.dynamicPush.test.js` (new), `demo_api_ui/src/context/__tests__/TokenChainContext.appendTokenEvent.test.jsx` (new), `demo_api_ui/src/services/__tests__/demoAgentService.tokenEventCallback.test.js` (new) | New coverage for each change |

---

## Phase 1 — Wire `tools/list` into Token Chain

### Task 1: Fix the `tools/list` event shape and array

**Files:**
- Modify: `demo_api_server/services/agentGatewayClient.js:1-15` (add import), `:53` (local array — unchanged), `:117-123` (success), `:150-156` (gateway error branch), `:162-166` (transport error branch)
- Test: `demo_api_server/src/__tests__/agentGatewayClient.toolsList.test.js` (new)

**Interfaces:**
- Consumes: `buildTokenEvent(id, label, status, decoded, explanation, extra)` from `demo_api_server/services/agentMcpTokenService.js` (already exported — confirmed via existing `mcpToolPipeline.js` usage).
- Produces: `getAvailableTools(req, agentCCToken, options)` now returns `{ tools, tokenEvents }` where `tokenEvents` actually contains a `tools-list` (or `tools-list-failed`) event — consumed unchanged by `demo_api_server/routes/agentRun.js:315` (`initialTokenEvents = [...initialTokenEvents, ...(toolsResult.tokenEvents || [])]`), which already injects this into the AG-UI `STATE_SNAPSHOT` before the run starts (`agentRun.js:445-457`). No changes needed in `agentRun.js`.

- [ ] **Step 1: Write the failing test**

```js
// demo_api_server/src/__tests__/agentGatewayClient.toolsList.test.js
'use strict';
jest.mock('axios');
const axios = require('axios');
const { getAvailableTools } = require('../../services/agentGatewayClient');

describe('getAvailableTools — tools/list Token Chain step', () => {
  test('success response includes a tools-list buildTokenEvent-shaped step', async () => {
    axios.post.mockResolvedValueOnce({
      data: { result: { tools: [{ name: 'get_account_balance' }, { name: 'create_transfer' }] } },
    });
    const result = await getAvailableTools({}, 'cc-token-123');
    expect(result.tokenEvents).toHaveLength(1);
    const ev = result.tokenEvents[0];
    expect(ev.id).toBe('tools-list');
    expect(ev.status).toBe('success');
    expect(ev.label).toMatch(/tools\/list/i);
    expect(ev.toolCount).toBe(2);
    expect(ev.toolNames).toEqual(['get_account_balance', 'create_transfer']);
  });

  test('gateway JSON-RPC error response includes a tools-list-failed step', async () => {
    axios.post.mockResolvedValueOnce({
      data: { error: { code: 'gateway_error', message: 'boom' } },
    });
    await expect(getAvailableTools({}, 'cc-token-123')).rejects.toThrow();
    // The error carries the events so the caller (agentRun.js) can still surface the failure.
    try {
      await getAvailableTools({}, 'cc-token-123');
    } catch (err) {
      expect(err.tokenEvents[0].id).toBe('tools-list-failed');
      expect(err.tokenEvents[0].status).toBe('failed');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && npx jest src/__tests__/agentGatewayClient.toolsList.test.js --testPathIgnorePatterns="/node_modules/"`
Expected: FAIL — `result.tokenEvents` has length 0 (the current bug), or `ev.id` is `undefined`.

- [ ] **Step 3: Add the import**

In `demo_api_server/services/agentGatewayClient.js`, near the top with the other `require`s:

```js
const { buildTokenEvent } = require('./agentMcpTokenService');
```

- [ ] **Step 4: Push a real event on success**

Find (around line 117):

```js
    // Log gateway response events
    if (req?.recordTokenEvent) {
      req.recordTokenEvent('tools_list_success', {
        toolCount: tools.length,
        toolNames: tools.map(t => t.name),
      });
    }
```

Replace with (keep the existing `recordTokenEvent` call — other consumers of `req.tokenEvents` still expect it; just also push the real step):

```js
    // Log gateway response events
    if (req?.recordTokenEvent) {
      req.recordTokenEvent('tools_list_success', {
        toolCount: tools.length,
        toolNames: tools.map(t => t.name),
      });
    }
    tokenEvents.push(buildTokenEvent(
      'tools-list',
      'MCP tools/list — Agent Gateway',
      'success',
      null,
      `Agent Gateway returned ${tools.length} available tool(s) via MCP tools/list.`,
      { rfc: 'MCP 2025-03-26 §Tools', toolCount: tools.length, toolNames: tools.map(t => t.name) },
    ));
```

- [ ] **Step 5: Push a failed event on the JSON-RPC error branch**

Find (around line 150, inside the `if (response.data.error)` block, after the `insufficient_scope` early-throw):

```js
      const err = new Error(`Tools list request failed: ${errorMessage}`);
      err.code = errorCode;
      err.httpStatus = 502;
      err.tokenEvents = tokenEvents;
      throw err;
```

Insert immediately **before** this block (still inside `if (response.data.error)`, after the `insufficient_scope` check has already returned/thrown):

```js
      tokenEvents.push(buildTokenEvent(
        'tools-list-failed',
        'MCP tools/list — Agent Gateway',
        'failed',
        null,
        `MCP tools/list failed: ${errorMessage}`,
        { rfc: 'MCP 2025-03-26 §Tools', errorCode, errorMessage },
      ));
      const err = new Error(`Tools list request failed: ${errorMessage}`);
      err.code = errorCode;
      err.httpStatus = 502;
      err.tokenEvents = tokenEvents;
      throw err;
```

- [ ] **Step 6: Push a failed event on the transport-error (catch) branch**

Find (around line 162, in the outer `catch (error)` block, after the `req.recordTokenEvent('tools_list_error', ...)` call):

```js
    if (req?.recordTokenEvent) {
      req.recordTokenEvent('tools_list_error', {
        error: error.code || 'gateway_request_failed',
        message,
        gatewayUrl,
      });
    }
```

Add immediately after:

```js
    tokenEvents.push(buildTokenEvent(
      'tools-list-failed',
      'MCP tools/list — Agent Gateway',
      'failed',
      null,
      `MCP tools/list transport error: ${message}`,
      { rfc: 'MCP 2025-03-26 §Tools', error: error.code || 'gateway_request_failed', gatewayUrl },
    ));
```

- [ ] **Step 7: Run test to verify it passes**

Run: `cd demo_api_server && npx jest src/__tests__/agentGatewayClient.toolsList.test.js --testPathIgnorePatterns="/node_modules/"`
Expected: PASS (2/2)

- [ ] **Step 8: Manual verification against a live turn**

With the stack running (`./run-docker.sh` or equivalent), open the UI in an LLM mode (any mode with `ff_agui_enabled=true`, the default), send a chat message, open the Token Chain panel, and confirm a `tools-list` card appears as the first step (before the exchange steps). If it doesn't appear, check `demo_api_server` logs for `[agentRun] Tool resolution error` — that branch (`agentRun.js:316-319`) swallows failures silently by design; a thrown error there means `getAvailableTools` itself failed, not this change.

- [ ] **Step 9: Commit**

```bash
git add demo_api_server/services/agentGatewayClient.js demo_api_server/src/__tests__/agentGatewayClient.toolsList.test.js
git commit -m "fix(token-chain): wire tools/list into a real Token Chain step

getAvailableTools already called MCP tools/list on every AG-UI turn and
already called req.recordTokenEvent() — but that pushes into req.tokenEvents,
a different array than the one this function actually returns to
agentRun.js. The returned tokenEvents array stayed empty forever, so the
step never appeared. Push a properly-shaped buildTokenEvent into the
array that's actually returned."
```

---

## Phase 2 — Make Token Chain steps dynamic (appear as they happen)

The per-turn SSE connection and the server's per-event publish primitive already exist (see Background). This phase (a) makes the server push the *later* pipeline stages live, not just the first, and (b) gives the client a real append path that both `openMcpFlowSse` handlers feed into.

### Task 2: Add an append method to `tokenChainTraceStore`

**Files:**
- Modify: `demo_api_ui/src/services/tokenChainTrace/tokenChainTraceStore.js:69-74`
- Test: `demo_api_ui/src/services/tokenChainTrace/__tests__/tokenChainTraceStore.appendTokenEvent.test.js` (new)

**Interfaces:**
- Consumes: nothing new.
- Produces: `tokenChainTraceStore.ingestTokenEvent(event)` — appends one event to `trace.tokenEvents`, deduping by `event.id` (an event with the same id replaces the earlier one in place, so a status transition like `waiting` → `active` for the same id updates rather than duplicates). Used by Task 3.

- [ ] **Step 1: Write the failing test**

```js
// demo_api_ui/src/services/tokenChainTrace/__tests__/tokenChainTraceStore.appendTokenEvent.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { tokenChainTraceStore } from '../tokenChainTraceStore';

describe('tokenChainTraceStore.ingestTokenEvent', () => {
  beforeEach(() => {
    tokenChainTraceStore.reset?.();
  });

  it('appends a new event without touching existing ones', () => {
    tokenChainTraceStore.ingestTokenEvents([{ id: 'user-token', status: 'active' }]);
    tokenChainTraceStore.ingestTokenEvent({ id: 'tools-list', status: 'success' });
    const trace = tokenChainTraceStore.getTrace();
    expect(trace.tokenEvents.map((e) => e.id)).toEqual(['user-token', 'tools-list']);
  });

  it('replaces an existing event with the same id in place (status transition)', () => {
    tokenChainTraceStore.ingestTokenEvents([{ id: 'gw-authorize', status: 'waiting' }]);
    tokenChainTraceStore.ingestTokenEvent({ id: 'gw-authorize', status: 'permit' });
    const trace = tokenChainTraceStore.getTrace();
    expect(trace.tokenEvents).toHaveLength(1);
    expect(trace.tokenEvents[0].status).toBe('permit');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && CI=true node_modules/.bin/vitest run src/services/tokenChainTrace/__tests__/tokenChainTraceStore.appendTokenEvent.test.js`
Expected: FAIL — `ingestTokenEvent is not a function` (and `reset`/`getTrace` may need confirming against the real module's existing API; adjust the test to whatever accessor the module already exposes for reading `trace` — check the file's existing exports before finalizing this test).

- [ ] **Step 3: Implement `ingestTokenEvent`**

In `demo_api_ui/src/services/tokenChainTrace/tokenChainTraceStore.js`, immediately after the existing `ingestTokenEvents` method (line 74):

```js
  ingestTokenEvent(event) {
    if (!event || !event.id) return;
    ensureTrace();
    const idx = trace.tokenEvents.findIndex((e) => e.id === event.id);
    if (idx >= 0) {
      trace.tokenEvents = [
        ...trace.tokenEvents.slice(0, idx),
        event,
        ...trace.tokenEvents.slice(idx + 1),
      ];
    } else {
      trace.tokenEvents = [...trace.tokenEvents, event];
    }
    emit();
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_ui && CI=true node_modules/.bin/vitest run src/services/tokenChainTrace/__tests__/tokenChainTraceStore.appendTokenEvent.test.js`
Expected: PASS (2/2)

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/services/tokenChainTrace/tokenChainTraceStore.js demo_api_ui/src/services/tokenChainTrace/__tests__/tokenChainTraceStore.appendTokenEvent.test.js
git commit -m "feat(token-chain): add ingestTokenEvent append method to tokenChainTraceStore"
```

### Task 3: Add `appendTokenEvent` to `TokenChainContext`

**Files:**
- Modify: `demo_api_ui/src/context/TokenChainContext.js:142` (near `setTokenEvents`)
- Test: `demo_api_ui/src/context/__tests__/TokenChainContext.appendTokenEvent.test.jsx` (new)

**Interfaces:**
- Consumes: `tokenChainTraceStore.ingestTokenEvent(event)` from Task 2.
- Produces: `appendTokenEvent(tool, event)` on the context value — appends to live `events` state (dedup by `id`, same semantics as Task 2), does **not** touch `history` (history stays a per-turn batch entry, written by the existing `setTokenEvents` call each caller already makes once the turn completes). Consumed by Task 5.

- [ ] **Step 1: Write the failing test**

```jsx
// demo_api_ui/src/context/__tests__/TokenChainContext.appendTokenEvent.test.jsx
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { TokenChainProvider, useTokenChain } from '../TokenChainContext';

function wrapper({ children }) {
  return <TokenChainProvider>{children}</TokenChainProvider>;
}

describe('TokenChainContext.appendTokenEvent', () => {
  it('appends a new event to live events', () => {
    const { result } = renderHook(() => useTokenChain(), { wrapper });
    act(() => result.current.setTokenEvents('tool1', [{ id: 'user-token', status: 'active' }]));
    act(() => result.current.appendTokenEvent('tool1', { id: 'tools-list', status: 'success' }));
    expect(result.current.events.map((e) => e.id)).toEqual(['user-token', 'tools-list']);
  });

  it('replaces an event with the same id in place', () => {
    const { result } = renderHook(() => useTokenChain(), { wrapper });
    act(() => result.current.setTokenEvents('tool1', [{ id: 'gw-authorize', status: 'waiting' }]));
    act(() => result.current.appendTokenEvent('tool1', { id: 'gw-authorize', status: 'permit' }));
    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0].status).toBe('permit');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && CI=true node_modules/.bin/vitest run src/context/__tests__/TokenChainContext.appendTokenEvent.test.jsx`
Expected: FAIL — `result.current.appendTokenEvent is not a function`

- [ ] **Step 3: Implement `appendTokenEvent`**

In `demo_api_ui/src/context/TokenChainContext.js`, immediately after the `setTokenEvents` `useCallback` block (after its closing `[]),`):

```js
  /**
   * Called by demoAgentService's per-turn SSE handler as each token-event
   * frame arrives, so the panel updates live instead of waiting for the
   * whole turn to finish. Does not touch history — setTokenEvents still
   * owns the once-per-turn history write when the call resolves.
   */
  const appendTokenEvent = useCallback((tool, event) => {
    if (!event || !event.id) return;
    tokenChainTraceStore.ingestTokenEvent(event);
    setEvents((prev) => {
      const idx = prev.findIndex((e) => e.id === event.id);
      if (idx >= 0) {
        return [...prev.slice(0, idx), event, ...prev.slice(idx + 1)];
      }
      return [...prev, event];
    });
  }, []);
```

Then find the context value object (the `useMemo`/return object exposing `setTokenEvents`) and add `appendTokenEvent` alongside it — e.g. if the value is built like:

```js
const value = useMemo(() => ({
  events,
  setTokenEvents,
  // ...
}), [events, setTokenEvents, /* ... */]);
```

change to:

```js
const value = useMemo(() => ({
  events,
  setTokenEvents,
  appendTokenEvent,
  // ...
}), [events, setTokenEvents, appendTokenEvent, /* ... */]);
```

(Locate the exact `useMemo`/value-object shape in the file before editing — this plan shows the pattern; match it to what's actually there rather than assuming a specific line number, since the value object's other fields aren't reproduced above.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_ui && CI=true node_modules/.bin/vitest run src/context/__tests__/TokenChainContext.appendTokenEvent.test.jsx`
Expected: PASS (2/2)

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/context/TokenChainContext.js demo_api_ui/src/context/__tests__/TokenChainContext.appendTokenEvent.test.jsx
git commit -m "feat(token-chain): add appendTokenEvent to TokenChainContext for live updates"
```

### Task 4: Wire `demoAgentService.js`'s SSE handlers to accept an `onTokenEvent` callback

**Files:**
- Modify: `demo_api_ui/src/services/demoAgentService.js:163` (`callMcpTool` signature + its `openMcpFlowSse` handler ~line 221), `:993` (`sendAgentMessage` signature + its `openMcpFlowSse` handler ~line 1037)
- Test: `demo_api_ui/src/services/__tests__/demoAgentService.tokenEventCallback.test.js` (new)

**Interfaces:**
- Consumes: nothing new (plain callback parameter).
- Produces: both `callMcpTool(tool, params, { signal, useCaseId, vertical, onTokenEvent })` and `sendAgentMessage(message, consentId, { signal, forceHeuristic, vertical, consentGiven, hitlChallengeId, useCaseId, onTokenEvent })` now accept an optional `onTokenEvent(event)` callback, called synchronously whenever a `{type:'token-event'}` SSE frame arrives, in addition to (not instead of) the existing `appendTokenEvents`/`agentFlowDiagram.applyServerEvent` forwarding. Consumed by Task 5.

- [ ] **Step 1: Write the failing test**

```js
// demo_api_ui/src/services/__tests__/demoAgentService.tokenEventCallback.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./mcpFlowSseClient', () => ({
  openMcpFlowSse: vi.fn((flowTraceId, onEvent) => {
    // Simulate one token-event frame arriving asynchronously.
    setTimeout(() => onEvent({ type: 'token-event', id: 'tools-list', status: 'success' }), 0);
    return () => {};
  }),
}));
vi.mock('./apiTrafficStore', () => ({
  appendTokenEvents: vi.fn(),
  setCurrentTurn: vi.fn(),
  clearCurrentTurn: vi.fn(),
}));
vi.mock('./apiClient', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

import { callMcpTool } from '../demoAgentService';

describe('callMcpTool onTokenEvent callback', () => {
  beforeEach(() => vi.clearAllMocks());

  it('invokes onTokenEvent for each token-event SSE frame', async () => {
    const onTokenEvent = vi.fn();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ result: {}, tokenEvents: [] }),
    });
    await callMcpTool('get_account_balance', {}, { onTokenEvent }).catch(() => {});
    await new Promise((r) => setTimeout(r, 10));
    expect(onTokenEvent).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'tools-list', status: 'success' }),
    );
  });
});
```

(This test's exact mock shape depends on `callMcpTool`'s real fetch/response handling — adjust the `fetch` mock's response body to match what the function expects if it fails for reasons unrelated to `onTokenEvent`; the assertion under test is only the `onTokenEvent` call.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && CI=true node_modules/.bin/vitest run src/services/__tests__/demoAgentService.tokenEventCallback.test.js`
Expected: FAIL — `onTokenEvent` never called (option is accepted but ignored).

- [ ] **Step 3: Wire the callback into `callMcpTool`'s SSE handler**

In `demo_api_ui/src/services/demoAgentService.js`, `callMcpTool`'s signature (line 163) already destructures an options object — add `onTokenEvent` to it:

```js
export async function callMcpTool(tool, params = {}, { signal, useCaseId, vertical, onTokenEvent } = {}) {
```

Then in the existing `openMcpFlowSse` handler (~line 221):

```js
  const closeSse = openMcpFlowSse(flowTraceId, (data) => {
    // Collect token events from SSE for streaming token chain display
    if (data && data.type === "token-event") {
      const tokenEvent = { ...data };
      delete tokenEvent.type; // Remove our wrapper type field
      tokenEventsFromSse.push(tokenEvent);
      // Immediately append so Token Chain UI updates in real time
      appendTokenEvents(tool, [tokenEvent]);
      onTokenEvent?.(tokenEvent);
    }
```

(Only the added `onTokenEvent?.(tokenEvent);` line is new — everything else in this block is unchanged.)

- [ ] **Step 4: Wire the callback into `sendAgentMessage`'s SSE handler**

`sendAgentMessage`'s signature (line 993) already destructures an options object — add `onTokenEvent`:

```js
export async function sendAgentMessage(message, consentId = null, { signal, forceHeuristic = false, vertical = null, consentGiven = false, hitlChallengeId = null, useCaseId = null, onTokenEvent } = {}) {
```

Then in its `openMcpFlowSse` handler (~line 1037), which today only forwards to `agentFlowDiagram`:

```js
  const closeSse = openMcpFlowSse(flowTraceId, (data) => {
    if (data && data.type === "token-event") {
      const tokenEvent = { ...data };
      delete tokenEvent.type;
      onTokenEvent?.(tokenEvent);
    }
    try {
      agentFlowDiagram.applyServerEvent(data);
    } catch (_) {
      /* never let a flow-diagram update break the agent call */
    }
  });
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd demo_api_ui && CI=true node_modules/.bin/vitest run src/services/__tests__/demoAgentService.tokenEventCallback.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add demo_api_ui/src/services/demoAgentService.js demo_api_ui/src/services/__tests__/demoAgentService.tokenEventCallback.test.js
git commit -m "feat(token-chain): add onTokenEvent callback to callMcpTool and sendAgentMessage

sendAgentMessage already opens a per-turn SSE connection and already
receives token-event frames — it just dropped them (only callMcpTool
forwarded them, and only to the unrelated API Traffic panel). Both now
expose an onTokenEvent callback so callers can push live updates into
Token Chain."
```

### Task 5: Wire `AIAgent.js` call sites to append live events into Token Chain

**Files:**
- Modify: `demo_api_ui/src/components/AIAgent.js` — every `callMcpTool(...)` and `sendAgentMessage(...)` call site that has `tokenChain` in scope (confirmed call sites from this session's earlier reading: `sendAgentMessage` at lines 5612, 6328, 7876, 7930, 7946, 8127; `callMcpTool` call sites — grep `callMcpTool(` in the file to enumerate, following the same pattern)

**Interfaces:**
- Consumes: `onTokenEvent` option from Task 4, `tokenChain.appendTokenEvent(tool, event)` from Task 3.
- Produces: nothing new for later tasks — this is the leaf wiring.

- [ ] **Step 1: Add the callback at each call site**

For each `sendAgentMessage(...)` / `callMcpTool(...)` call in `AIAgent.js` that has an action/tool identifier in scope (e.g. `result.action`, `tool`, `verticalOpts`'s implicit action), add `onTokenEvent` to the options object. Example for the primary dispatch path (around line 5612):

```js
        const response = await sendAgentMessage(agentMessage, null, {
          ...verticalOpts,
          onTokenEvent: (ev) => tokenChain.appendTokenEvent(result.action || "agent", ev),
        });
```

Apply the same pattern — `onTokenEvent: (ev) => tokenChain.appendTokenEvent(<best-available-action-name>, ev)` — at each of the other five `sendAgentMessage` call sites and every `callMcpTool` call site. Use whatever identifier that call site already uses for `tokenChain.setTokenEvents(<id>, ...)` later in the same function, so the live-append id matches the eventual batch id.

- [ ] **Step 2: Manual verification**

With the stack running, open Token Chain, send a chat message that triggers a tool call, and confirm the `user-token`/`exchange-in-progress` cards appear **before** the HTTP response returns (i.e. before the "thinking" indicator clears) rather than all at once at the end. Network tab: the SSE connection for the turn's `flowTraceId` should show individual `token-event` frames arriving over time.

- [ ] **Step 3: Run the existing AIAgent chip test suite to check for regressions**

Run: `cd demo_api_ui && CI=true node_modules/.bin/vitest run src/components/__tests__/AIAgent.chips.test.js`
Expected: same pass/fail baseline as before this change (this task only adds an additional callback option; it must not change any existing assertion about `response.reply`/`response.tokenEvents` batch behavior).

- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/src/components/AIAgent.js
git commit -m "feat(token-chain): live-append token events at every sendAgentMessage/callMcpTool call site"
```

### Task 6: Push the gateway-reported steps (`gw-*`) live, not just in the final response

**Files:**
- Modify: `demo_api_server/services/mcpToolPipeline.js:625-696` (the `if (gwAuditTrail) { ... }` block)
- Test: `demo_api_server/tests/mcpToolPipeline.dynamicPush.test.js` (new)

**Interfaces:**
- Consumes: `deps.publishTokenEventsToSse(flowTraceId, events)` (already exists, `demo_api_server/server.js:1609`, already injected into `deps` — confirmed via the existing call at `mcpToolPipeline.js:153`).
- Produces: nothing new for later tasks.

Note the architectural limit already established: the four `gw-*` events only become known **after** `callToolViaGateway` returns (line 619) — they cannot be pushed any earlier than that, because the BFF has no visibility into the gateway's internal hops until the audit trail comes back on the response. This task makes them arrive as their own live SSE push the moment the gateway call returns, instead of waiting for the whole tool-call HTTP response (including result formatting) to complete — a real improvement, just not per-individual-hop.

- [ ] **Step 1: Write the failing test**

```js
// demo_api_server/tests/mcpToolPipeline.dynamicPush.test.js
'use strict';

describe('runMcpToolPipeline — gw-* events pushed live', () => {
  test('publishTokenEventsToSse is called a second time with only the gw-* events, right after the gateway call returns', async () => {
    const published = [];
    const deps = {
      config: {},
      emit: jest.fn(),
      appEventLog: jest.fn(),
      buildTokenEvent: require('../services/agentMcpTokenService').buildTokenEvent,
      resolveMcpAccessTokenWithEvents: jest.fn().mockResolvedValue({
        token: 'tok', tokenEvents: [{ id: 'user-token', status: 'active' }], userSub: 'u1',
      }),
      publishTokenEventsToSse: jest.fn((flowTraceId, events) => published.push({ flowTraceId, events })),
      callToolViaGateway: jest.fn().mockResolvedValue({
        result: { content: [] },
        gwAuditTrail: {
          introspection: { active: true, sub: 'u1' },
          authorize: { decision: 'PERMIT' },
        },
      }),
      evaluateMcpFirstToolGate: jest.fn().mockResolvedValue({ allowed: true }),
    };
    const { runMcpToolPipeline } = require('../services/mcpToolPipeline');
    await runMcpToolPipeline({
      tool: 'get_account_balance',
      params: {},
      req: { correlationId: 'c1', session: {} },
      deps,
      flowTraceId: 'ft-1',
      startTime: Date.now(),
    });

    // First push: the stage-1 exchange events. Second push: the gw-* events,
    // published as soon as the gateway call returns — not folded into a
    // single end-of-call publish.
    expect(published.length).toBeGreaterThanOrEqual(2);
    const gwPush = published.find((p) => p.events.some((e) => e.id === 'gw-authorize'));
    expect(gwPush).toBeDefined();
    expect(gwPush.events.some((e) => e.id === 'gw-introspection')).toBe(true);
    // The gw-* push must NOT re-send the stage-1 user-token event.
    expect(gwPush.events.some((e) => e.id === 'user-token')).toBe(false);
  });
});
```

(This test stubs enough of `deps` to exercise the gateway branch — check `mcpToolPipeline.js`'s full `deps` contract for any additional required stub functions your test run reports as missing, and add minimal `jest.fn()` stubs for those rather than changing the assertions above.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && npx jest tests/mcpToolPipeline.dynamicPush.test.js --testPathIgnorePatterns="/node_modules/"`
Expected: FAIL — only one `publishTokenEventsToSse` call recorded (or the second call includes all events, not just the new `gw-*` ones).

- [ ] **Step 3: Collect the gw-* events into a local array and push them after the block**

In `demo_api_server/services/mcpToolPipeline.js`, find the start of the audit-trail block (~line 625):

```js
        // Build token events from gateway audit trail if present (Phase 259)
        if (gwAuditTrail) {
```

Change to:

```js
        // Build token events from gateway audit trail if present (Phase 259)
        const gwEvents = [];
        if (gwAuditTrail) {
```

Then change each of the four `tokenEvents.push(deps.buildTokenEvent(...))` calls inside this block (for `gw-introspection`, `gw-authorize`, `gw-mcp-audit`, `gw-mtls`) to push into **both** arrays — e.g. the introspection one becomes:

```js
                const gwIntrospectionEvent = deps.buildTokenEvent(
                    'gw-introspection',
                    'PingGateway — Token Introspection (RFC 7662)',
                    status,
                    null,
                    desc,
                    {
                        rfc: 'RFC 7662',
                        sub: introspRes.sub,
                        exp: introspRes.exp,
                        scope: introspRes.scope,
                        iss: introspRes.iss,
                        client_id: introspRes.client_id,
                        active: introspRes.active,
                        skipped: introspRes.skipped,
                        rawResponse: introspRes,
                    }
                );
                tokenEvents.push(gwIntrospectionEvent);
                gwEvents.push(gwIntrospectionEvent);
```

Apply the identical `const gwXEvent = deps.buildTokenEvent(...); tokenEvents.push(gwXEvent); gwEvents.push(gwXEvent);` restructuring to the `gw-authorize`, `gw-mcp-audit`, and `gw-mtls` pushes in the same block.

Immediately after the closing `}` of the `if (gwAuditTrail) { ... }` block, add:

```js
        if (gwEvents.length > 0) {
            deps.publishTokenEventsToSse(flowTraceId, gwEvents);
        }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && npx jest tests/mcpToolPipeline.dynamicPush.test.js --testPathIgnorePatterns="/node_modules/"`
Expected: PASS

- [ ] **Step 5: Run the full existing mcpToolPipeline test suite to check for regressions**

Run: `cd demo_api_server && npx jest tests/mcpToolPipeline --testPathIgnorePatterns="/node_modules/"`
Expected: same pass count as before this change — the restructuring must not alter what ends up in the final `tokenEvents` array returned to the HTTP caller, only add an intermediate SSE push.

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/services/mcpToolPipeline.js demo_api_server/tests/mcpToolPipeline.dynamicPush.test.js
git commit -m "feat(token-chain): push gw-* gateway steps live as soon as the audit trail arrives

Previously the four gateway-reported steps (gw-mtls/gw-introspection/
gw-authorize/gw-mcp-audit) were only ever included in the final HTTP
response — publishTokenEventsToSse was called once, right after stage-1
token resolution, and never again. They arrive as their own live SSE
push the moment callToolViaGateway returns, instead of waiting for the
whole tool call (including result formatting) to finish."
```

---

## Phase 3 — Full PingOne-call step coverage

### Task 7: Normalize the PingOne Authorize step across the real-gateway and BFF-simulated paths

**Files:**
- Read first: `demo_api_server/services/mcpToolPipeline.js` — locate the BFF-simulated authorize path (`mcpAuthorizeEvaluation`, referenced in the confused-deputy/`ff_authorize_simulated` handling seen elsewhere this session) and confirm its event id/shape differs from `gw-authorize`.
- Modify: whichever function builds the BFF-simulated authorize event, so it uses the **same** event id (`gw-authorize`) and the same `status` vocabulary (`permit`/`deny`/`indeterminate`) as the real-gateway path, regardless of `ff_authorize_simulated`.
- Test: extend the existing authorize-related test file for `mcpToolPipeline.js` (find via `grep -rl "gw-authorize\|mcpAuthorizeEvaluation" demo_api_server/tests demo_api_server/src/__tests__`) with a case asserting both paths produce an event with `id === 'gw-authorize'`.

**Interfaces:**
- Consumes: nothing new.
- Produces: a single, path-independent `gw-authorize` event contract that `TokenChainDisplay.js`'s existing `AuthorizeDecisionEduBox`/`GwAuthorizeEduBox` components (already keyed on `event.id === 'gw-authorize'`, confirmed at `TokenChainDisplay.js:1745`) render correctly regardless of which backend actually decided.

- [ ] **Step 1: Locate the exact divergence**

Run: `grep -n "mcpAuthorizeEvaluation\|authorize-decision" demo_api_server/services/mcpToolPipeline.js`

Read the surrounding ~30 lines at each match to see the current event id/shape used for the BFF-simulated path (this plan cannot cite an exact line number for code not yet located — do this read before writing the fix).

- [ ] **Step 2: Write a test asserting both paths converge on one id**

Once the simulated-path function is identified (e.g. `buildSimulatedAuthorizeEvent` or similar), write:

```js
// Add to the existing authorize test file found above
test('BFF-simulated authorize path produces the same gw-authorize id as the real gateway path', () => {
  const { buildTokenEvent } = require('../services/agentMcpTokenService');
  // Call whatever function builds the simulated-path event with a representative
  // PERMIT decision, matching the real signature found in Step 1.
  const simulatedEvent = /* call the located function */;
  expect(simulatedEvent.id).toBe('gw-authorize');
  expect(['permit', 'deny', 'indeterminate']).toContain(simulatedEvent.status);
});
```

- [ ] **Step 3: Run test to verify it fails**

Expected: FAIL — simulated path currently uses a different id (confirm the actual current id from Step 1's read and note it here before implementing).

- [ ] **Step 4: Change the simulated-path event id/status to match**

Edit the located function so its `buildTokenEvent(...)` call uses `'gw-authorize'` as the id and the same three-value status vocabulary as the real-gateway path (see Task 6's `gw-authorize` push for the exact status mapping: `decision === 'PERMIT' ? 'permit' : (decision === 'INDETERMINATE' ? 'indeterminate' : 'deny')`).

- [ ] **Step 5: Run test to verify it passes; run the full authorize test file for regressions**

Run: `cd demo_api_server && npx jest <the test file from Step 1> --testPathIgnorePatterns="/node_modules/"`
Expected: all pass, including pre-existing tests in that file.

- [ ] **Step 6: Commit**

```bash
git commit -m "fix(token-chain): normalize PingOne Authorize step id across real and simulated gateway paths"
```

### Task 8: Add a Token Chain step for every PingOne Admin/Management API call made during an admin-agent turn

**Files:**
- Modify: `demo_api_server/services/adminAgentService.js:35` (`processAdminMessage` signature and its `executeTool` wiring, ~line 100)
- Test: `demo_api_server/tests/adminAgentService.tokenChainStep.test.js` (new)

**Interfaces:**
- Consumes: `buildTokenEvent` (already imported in this file — confirmed via existing usage at `adminAgentService.js:75`).
- Produces: one `pingone-admin-api` event per admin tool invocation, pushed into the same `tokenEvents` array this function already threads through and returns (`processAdminMessage`'s `tokenEvents` parameter, already returned as `tokenEvents: tokenEvents || []` in every response branch — confirmed at lines 65/125/145/175).

Design choice: emit one step **per admin tool call**, not one per raw HTTP request inside `pingoneManagementService.js`. `pingoneManagementService.js` has 15 direct `axios.*` call sites across unrelated exported functions with no shared request wrapper (confirmed) — instrumenting each individually is high blast-radius for low value. `executeAdminTool` is the single choke point every admin tool call already passes through (`adminAgentService.js:5,100`), and a tool call is the same granularity as every other Token Chain step (one card per meaningful action, not per raw network hop) — the same principle already applied to the gateway steps in Task 6.

- [ ] **Step 1: Write the failing test**

```js
// demo_api_server/tests/adminAgentService.tokenChainStep.test.js
'use strict';
jest.mock('../config/admin/tools', () => ({
  buildAdminToolSchemas: jest.fn().mockReturnValue([]),
  executeAdminTool: jest.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] }),
}));
jest.mock('../services/agentReasoningClient', () => ({
  runReasonLoop: jest.fn().mockImplementation(async ({ executeTool }) => {
    // Simulate the LLM calling one admin tool mid-loop.
    await executeTool('list_populations', {});
    return { ok: true, answer: 'Done.', inputTokens: 10, outputTokens: 5 };
  }),
}));

const { processAdminMessage } = require('../services/adminAgentService');

test('processAdminMessage adds a pingone-admin-api Token Chain step for each admin tool call', async () => {
  const response = await processAdminMessage({
    message: 'list populations', userId: 'u1', sessionId: 's1', tokenEvents: [],
  });
  const step = response.tokenEvents.find((e) => e.id === 'pingone-admin-api:list_populations');
  expect(step).toBeDefined();
  expect(step.status).toBe('success');
});
```

(Adjust the `runReasonLoop`/`executeAdminTool` mock shape if `processAdminMessage`'s actual call signature to `runReasonLoop` differs from what's assumed here — verify against the real code read in Task 8's implementation step before finalizing.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && npx jest tests/adminAgentService.tokenChainStep.test.js --testPathIgnorePatterns="/node_modules/"`
Expected: FAIL — no `pingone-admin-api:*` step present.

- [ ] **Step 3: Wrap `executeAdminTool` in a closure that records a step per call**

In `demo_api_server/services/adminAgentService.js`, find (around line 100):

```js
    const loopResult = await runReasonLoop({
      messages: [{ role: 'user', content: message }],
      tools: toolSchemas,
      provider: llmProvider,
      model: llmModel,
      systemPrompt,
      helixConfig: _extractHelixConfig(langchainConfig),
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
      maxIterations: MAX_TOOL_ITERATIONS,
      executeTool: executeAdminTool,
    });
```

Change `executeTool: executeAdminTool` to a wrapping closure:

```js
      executeTool: async (name, args) => {
        const startedAt = Date.now();
        try {
          const result = await executeAdminTool(name, args);
          tokenEvents.push(buildTokenEvent(
            `pingone-admin-api:${name}`,
            `PingOne Admin API — ${name}`,
            'success',
            null,
            `Admin agent called PingOne Management API tool "${name}" (${Date.now() - startedAt}ms).`,
            { tool: name, args, durationMs: Date.now() - startedAt },
          ));
          return result;
        } catch (err) {
          tokenEvents.push(buildTokenEvent(
            `pingone-admin-api:${name}`,
            `PingOne Admin API — ${name}`,
            'failed',
            null,
            `Admin agent's PingOne Management API tool "${name}" failed: ${err.message}`,
            { tool: name, args, error: err.message },
          ));
          throw err;
        }
      },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && npx jest tests/adminAgentService.tokenChainStep.test.js --testPathIgnorePatterns="/node_modules/"`
Expected: PASS

- [ ] **Step 5: Run the existing admin-agent test suite for regressions**

Run: `cd demo_api_server && npx jest tests/adminAgentRestrictions.test.js --testPathIgnorePatterns="/node_modules/"`
Expected: same pass count as before (24/24 per this session's earlier baseline).

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/services/adminAgentService.js demo_api_server/tests/adminAgentService.tokenChainStep.test.js
git commit -m "feat(token-chain): add a Token Chain step for every PingOne Admin API tool call

One step per admin tool invocation (executeAdminTool is the single choke
point every admin tool call passes through), not per raw HTTP request —
pingoneManagementService.js has 15 call sites with no shared request
wrapper, so per-request instrumentation there would be high blast-radius
for the same information a per-tool-call step already carries."
```

### Task 9: Verify session-token introspection fires for every tool call (regression guard, not a new feature)

**Files:**
- Test: extend `demo_api_server/tests/mcpToolPipeline.dynamicPush.test.js` (from Task 6) or the nearest existing `mcpToolPipeline` introspection test file (`grep -rl "session-token-introspection" demo_api_server/tests demo_api_server/src/__tests__`)

**Interfaces:**
- Consumes: nothing new — this task adds coverage for an existing feature (`mcpToolPipeline.js:497-583`) so a future regression is caught, since this is the step the user specifically called out as one they expect to always see.

- [ ] **Step 1: Write the test**

```js
test('session-token-introspection step is present for every successful tool call', async () => {
  // Reuse the same deps stub shape as Task 6's test, with
  // resolveMcpAccessTokenWithEvents returning a valid session.
  const { runMcpToolPipeline } = require('../services/mcpToolPipeline');
  const deps = { /* ...same stub shape as Task 6, with a valid session token... */ };
  const result = await runMcpToolPipeline({
    tool: 'get_account_balance', params: {}, req: { correlationId: 'c2', session: { /* valid session */ } },
    deps, flowTraceId: 'ft-2', startTime: Date.now(),
  });
  expect(result.tokenEvents.some((e) => e.id === 'session-token-introspection')).toBe(true);
});
```

- [ ] **Step 2: Run and confirm it passes against current code**

Run: `cd demo_api_server && npx jest tests/mcpToolPipeline.dynamicPush.test.js --testPathIgnorePatterns="/node_modules/"`
Expected: PASS — this is a characterization test for existing behavior, not a bug fix. If it FAILS, that's a real, separate bug (introspection silently not firing under some condition) — stop and investigate before continuing; do not weaken the assertion to make it pass.

- [ ] **Step 3: Commit**

```bash
git add demo_api_server/tests/mcpToolPipeline.dynamicPush.test.js
git commit -m "test(token-chain): lock in session-token-introspection firing on every tool call"
```

---

## Explicitly out of scope — flag for a decision, don't silently implement or skip

Session-lifecycle PingOne calls that happen **outside** an agent turn — the login-time authorization-code exchange (`oauthService.js:228`), token refresh (`oauthService.js`'s refresh method), userinfo (`oauthService.js:949`), and token revocation at logout (`tokenRevocation.js:38`, called from 9 different sites including kill-switch and delegation cleanup) — are not part of any single tool call, so they don't fit the Token Chain's current per-turn model (one chain per agent turn, shown in a floating panel during that turn). Adding them would mean either (a) inventing a persistent "session lifecycle" timeline separate from the per-turn chain, or (b) attaching them to the *next* turn's chain after the fact, which would be misleading (they didn't happen during that turn). Recommend treating this as a separate follow-up decision with the user rather than bundling it into this plan — flag before starting, don't assume either direction.

---

## Self-Review

**Spec coverage:**
1. "wire tools/list into token chain" → Task 1. ✓
2. "make sure token introspection is also a step" → already true today (`session-token-introspection`); Task 9 locks it in with a regression test so it's verified, not just assumed. ✓
3. "any call to P1 should be a step" → Task 7 (Authorize normalization) + Task 8 (Admin/Management API calls) cover the in-turn gaps found by research. Session-lifecycle P1 calls are called out explicitly as a scope question, not silently dropped. ✓
4. "make token chain dynamic ... each step created as it's run" → Tasks 2-6 build the append path end-to-end (store → context → SSE handlers → call sites → server-side second push for gateway steps), with the architectural limit on gateway-hop granularity stated plainly rather than overpromised. ✓

**Placeholder scan:** no TBD/"add error handling"/"similar to above" left unresolved; Task 7's Step 1 and Task 8's mock shapes are explicitly flagged as needing verification against real code during implementation (not vague — they name exactly what to check and why, because the underlying function wasn't located during planning-time research).

**Type consistency:** `buildTokenEvent(id, label, status, decoded, explanation, extra)` used identically across Tasks 1, 6, 7, 8. `appendTokenEvent(tool, event)` name and signature match between Task 3 (definition) and Task 5 (usage). `onTokenEvent` callback name and single-event-argument shape match between Task 4 (definition) and Task 5 (usage).
