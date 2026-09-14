# AIAgentFull — Privilege-Capable Agent Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second chat widget, `AIAgentFull` (full duplicate of the existing `BankingAgent` component in `AIAgent.js`), selectable per route, that additionally routes MCP tool calls through the PingOne Privilege AI Gateway when the demo operator picks "Via Privilege Gateway" — without touching `AIAgent.js` or the protected `mcpToolPipeline.js`.

**Architecture:** A new `useMcpToolTransport(transport)` hook returns a `callMcpTool`-signature-compatible dispatcher that calls either the existing direct path (`demoAgentService.callMcpTool`) or a new standalone Privilege path (`privilegeMcpService.callMcpToolViaPrivilege`, hitting the already-working `/api/privilege-mcp-simple/tools/call`). `AIAgentFull.js` is a byte-for-byte duplicate of `AIAgent.js` (renamed) with three additions: transport state, one line invoking the hook (which shadows the module-level `callMcpTool` import for the rest of the component body via normal JS lexical scoping — no other line in the ~12.7k-line body changes), and two small UI controls (transport picker + a disabled "Privilege A2A — coming later" stub). A route allowlist in `embeddedAgentFabVisibility.js` plus a 3-line change in `App.js` pick which component mounts.

**Tech Stack:** React 19.2, Vite 8, Vitest 3.2 (`globals: true`), `@testing-library/react` 16 (`renderHook`), `apiClient` (axios wrapper) for HTTP.

**Spec:** `docs/superpowers/specs/2026-09-14-aiagentfull-privilege-design.md`

## Global Constraints

- Node >= 22. Plain JS/JSX — no TypeScript sources in `demo_api_ui`.
- Vitest, not Jest, for `demo_api_ui`. Run `npm run test:unit` and `npm run build` before calling any task done (per `demo_api_ui/CLAUDE.md`).
- HTTP calls go through `apiClient` (`demo_api_ui/src/services/apiClient.js`), never raw `axios` — the one exception already in the codebase, `demoAgentService.callMcpTool`, uses raw `fetch` for its SSE side-channel and is not touched by this plan.
- `AIAgent.js`, `demoAgentService.js`, `agentModeResolver.js`, `agentModes.js`, and `mcpToolPipeline.js` are **not modified** by this plan (spec Decisions #1, #3, #4).
- Emoji allowlist and other `REGRESSION_PLAN.md` §0 UI rules apply to any new visible text/icons.
- Commit after every task; stage explicitly (no `git add -A`), per root `CLAUDE.md`.

---

## Task 1: `privilegeMcpService.callMcpToolViaPrivilege`

**Files:**
- Create: `demo_api_ui/src/services/privilegeMcpService.js`
- Test: `demo_api_ui/src/services/__tests__/privilegeMcpService.test.js`

**Interfaces:**
- Produces: `callMcpToolViaPrivilege(tool: string, params?: object, opts?: object) => Promise<{result: any, tokenEvents: Array}>` — same return contract as `demoAgentService.callMcpTool`, so later tasks can swap between the two with no shape mismatch.

- [ ] **Step 1: Write the failing test**

```js
// demo_api_ui/src/services/__tests__/privilegeMcpService.test.js
import { describe, test, expect, vi, beforeEach } from 'vitest';
import apiClient from '../apiClient';
import { callMcpToolViaPrivilege } from '../privilegeMcpService';

vi.mock('../apiClient', () => ({ default: { post: vi.fn() } }));

describe('callMcpToolViaPrivilege', () => {
  beforeEach(() => vi.clearAllMocks());

  test('posts name/arguments to the standalone Privilege MCP endpoint and wraps the raw result', async () => {
    const rawMcpResult = { content: [{ type: 'text', text: '{"balance":1200}' }], isError: false };
    apiClient.post.mockResolvedValue({ data: rawMcpResult });

    const outcome = await callMcpToolViaPrivilege('get_my_accounts', { accountId: 'acc-1' });

    expect(apiClient.post).toHaveBeenCalledWith('/api/privilege-mcp-simple/tools/call', {
      name: 'get_my_accounts',
      arguments: { accountId: 'acc-1' },
    });
    expect(outcome).toEqual({ result: rawMcpResult, tokenEvents: [] });
  });

  test('defaults params to an empty object when omitted', async () => {
    apiClient.post.mockResolvedValue({ data: { content: [], isError: false } });

    await callMcpToolViaPrivilege('list_transactions');

    expect(apiClient.post).toHaveBeenCalledWith('/api/privilege-mcp-simple/tools/call', {
      name: 'list_transactions',
      arguments: {},
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/services/__tests__/privilegeMcpService.test.js`
Expected: FAIL — `Cannot find module '../privilegeMcpService'` (file doesn't exist yet).

- [ ] **Step 3: Write the minimal implementation**

```js
// demo_api_ui/src/services/privilegeMcpService.js
import apiClient from './apiClient';

/**
 * Calls an MCP tool through the standalone, machine-callable PingOne
 * Privilege AI Gateway endpoint (client_credentials, no browser session —
 * demo_api_server/routes/privilegeMcpSimple.js) instead of the banking
 * demo's session-scoped /api/mcp/tool pipeline. This path does NOT run the
 * banking consent/HITL/kill-switch layer — only Privilege's own policy
 * applies. Return shape matches demoAgentService.callMcpTool exactly so
 * callers can swap transports with no other code changes.
 * @param {string} tool
 * @param {object} [params]
 * @param {object} [_opts] - accepted for signature parity, currently unused
 * @returns {Promise<{result: any, tokenEvents: Array}>}
 */
export async function callMcpToolViaPrivilege(tool, params = {}, _opts = {}) {
  const { data } = await apiClient.post('/api/privilege-mcp-simple/tools/call', {
    name: tool,
    arguments: params,
  });
  return { result: data, tokenEvents: [] };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/services/__tests__/privilegeMcpService.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/services/privilegeMcpService.js demo_api_ui/src/services/__tests__/privilegeMcpService.test.js
git commit -m "feat(agent): add callMcpToolViaPrivilege for the standalone Privilege MCP gateway"
```

---

## Task 2: `useMcpToolTransport` hook

**Files:**
- Create: `demo_api_ui/src/hooks/useMcpToolTransport.js`
- Test: `demo_api_ui/src/hooks/__tests__/useMcpToolTransport.test.js`

**Interfaces:**
- Consumes: `callMcpTool` from `demo_api_ui/src/services/demoAgentService.js` (existing, unchanged); `callMcpToolViaPrivilege` from Task 1.
- Produces: `useMcpToolTransport(transport: "direct"|"privilege") => (tool, params?, opts?) => Promise<{result, tokenEvents}>` — a stable-identity dispatcher (memoized on `transport`) with the exact call signature of `demoAgentService.callMcpTool`.

- [ ] **Step 1: Write the failing test**

```js
// demo_api_ui/src/hooks/__tests__/useMcpToolTransport.test.js
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMcpToolTransport } from '../useMcpToolTransport';

vi.mock('../../services/demoAgentService', () => ({
  callMcpTool: vi.fn().mockResolvedValue({ result: { via: 'direct' }, tokenEvents: [{ id: 'user-token' }] }),
}));
vi.mock('../../services/privilegeMcpService', () => ({
  callMcpToolViaPrivilege: vi.fn().mockResolvedValue({ result: { via: 'privilege' }, tokenEvents: [] }),
}));

import { callMcpTool as directCallMcpTool } from '../../services/demoAgentService';
import { callMcpToolViaPrivilege } from '../../services/privilegeMcpService';

describe('useMcpToolTransport', () => {
  beforeEach(() => vi.clearAllMocks());

  test('transport "direct" dispatches to demoAgentService.callMcpTool', async () => {
    const { result } = renderHook(() => useMcpToolTransport('direct'));
    const outcome = await result.current('get_my_accounts', { a: 1 }, { useCaseId: 'uc1' });
    expect(directCallMcpTool).toHaveBeenCalledWith('get_my_accounts', { a: 1 }, { useCaseId: 'uc1' });
    expect(callMcpToolViaPrivilege).not.toHaveBeenCalled();
    expect(outcome).toEqual({ result: { via: 'direct' }, tokenEvents: [{ id: 'user-token' }] });
  });

  test('transport "privilege" dispatches to callMcpToolViaPrivilege', async () => {
    const { result } = renderHook(() => useMcpToolTransport('privilege'));
    const outcome = await result.current('get_my_accounts', { a: 1 });
    expect(callMcpToolViaPrivilege).toHaveBeenCalledWith('get_my_accounts', { a: 1 }, {});
    expect(directCallMcpTool).not.toHaveBeenCalled();
    expect(outcome).toEqual({ result: { via: 'privilege' }, tokenEvents: [] });
  });

  test('defaults params/opts when the caller omits them, for either transport', async () => {
    const { result } = renderHook(() => useMcpToolTransport('direct'));
    await result.current('list_transactions');
    expect(directCallMcpTool).toHaveBeenCalledWith('list_transactions', {}, {});
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/hooks/__tests__/useMcpToolTransport.test.js`
Expected: FAIL — `Cannot find module '../useMcpToolTransport'`.

- [ ] **Step 3: Write the minimal implementation**

```js
// demo_api_ui/src/hooks/useMcpToolTransport.js
import { useCallback } from 'react';
import { callMcpTool as callMcpToolDirect } from '../services/demoAgentService';
import { callMcpToolViaPrivilege } from '../services/privilegeMcpService';

/**
 * Returns a callMcpTool-signature-compatible dispatcher that routes through
 * the standalone Privilege AI Gateway instead of the direct BFF pipeline
 * when transport is "privilege". Designed to shadow the module-level
 * `callMcpTool` import inside a component body via a same-named local
 * const, so existing call sites need no changes.
 * @param {"direct"|"privilege"} transport
 * @returns {(tool: string, params?: object, opts?: object) => Promise<{result: any, tokenEvents: Array}>}
 */
export function useMcpToolTransport(transport) {
  return useCallback(
    (tool, params = {}, opts = {}) =>
      transport === 'privilege'
        ? callMcpToolViaPrivilege(tool, params, opts)
        : callMcpToolDirect(tool, params, opts),
    [transport],
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/hooks/__tests__/useMcpToolTransport.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/hooks/useMcpToolTransport.js demo_api_ui/src/hooks/__tests__/useMcpToolTransport.test.js
git commit -m "feat(agent): add useMcpToolTransport dispatcher hook"
```

---

## Task 3: `isFullAgentRoute` route predicate

**Files:**
- Modify: `demo_api_ui/src/utils/embeddedAgentFabVisibility.js`
- Test: `demo_api_ui/src/utils/__tests__/embeddedAgentFabVisibility.test.js`

**Interfaces:**
- Produces: `isFullAgentRoute(pathname: string) => boolean`, and the exported `FULL_AGENT_ROUTES` array consumed by Task 5.

- [ ] **Step 1: Write the failing test**

Add to the existing test file (new `describe` block, alongside the others):

```js
// demo_api_ui/src/utils/__tests__/embeddedAgentFabVisibility.test.js
// add isFullAgentRoute to the import list at the top of the file, then:

describe('isFullAgentRoute', () => {
  it('is false for every route by default (opt-in allowlist starts empty)', () => {
    expect(isFullAgentRoute('/')).toBe(false);
    expect(isFullAgentRoute('/dashboard')).toBe(false);
    expect(isFullAgentRoute('/admin')).toBe(false);
  });

  it('normalizes a trailing slash the same way the other predicates do', () => {
    expect(isFullAgentRoute('/dashboard/')).toBe(isFullAgentRoute('/dashboard'));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/utils/__tests__/embeddedAgentFabVisibility.test.js`
Expected: FAIL — `isFullAgentRoute is not a function` (not exported yet).

- [ ] **Step 3: Write the minimal implementation**

Append to `demo_api_ui/src/utils/embeddedAgentFabVisibility.js`:

```js
/**
 * Routes that mount AIAgentFull (Demo Steps + selectable Privilege MCP
 * transport) instead of the default AIAgent. Starts empty — add a path here
 * per demo, never the other way around, so every existing route keeps
 * today's behavior unchanged.
 * @type {string[]}
 */
export const FULL_AGENT_ROUTES = [];

/**
 * Whether AIAgentFull (not AIAgent) should mount for this route.
 * @param {string} [pathname]
 * @returns {boolean}
 */
export function isFullAgentRoute(pathname) {
  if (pathname == null || typeof pathname !== 'string') return false;
  const p = pathname.replace(/\/$/, '') || '/';
  return FULL_AGENT_ROUTES.includes(p);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/utils/__tests__/embeddedAgentFabVisibility.test.js`
Expected: PASS (all cases in the file, including the 2 new ones).

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/utils/embeddedAgentFabVisibility.js demo_api_ui/src/utils/__tests__/embeddedAgentFabVisibility.test.js
git commit -m "feat(agent): add isFullAgentRoute opt-in allowlist predicate"
```

---

## Task 4: `AIAgentFull.js` — duplicate + transport picker + A2A stub

**Files:**
- Create: `demo_api_ui/src/components/AIAgentFull.js` (duplicate of `demo_api_ui/src/components/AIAgent.js`)
- Test: `demo_api_ui/src/components/__tests__/AIAgentFull.smoke.test.js`

**Interfaces:**
- Consumes: `useMcpToolTransport` (Task 2).
- Produces: `export default function BankingAgentFull(props)` — same prop contract as `BankingAgent` in `AIAgent.js` (see `App.js` mount site props for the exact list `AIAgentFull` must accept, spec §Interfaces).

- [ ] **Step 1: Duplicate the file and rename the component**

```bash
cp demo_api_ui/src/components/AIAgent.js demo_api_ui/src/components/AIAgentFull.js
```

Then in `demo_api_ui/src/components/AIAgentFull.js` only, rename the component (two occurrences — the declaration and nothing else references the name by identifier inside the file, since it's the default export):

```diff
-export default function BankingAgent({
+export default function BankingAgentFull({
```

- [ ] **Step 2: Write the failing smoke test**

```js
// demo_api_ui/src/components/__tests__/AIAgentFull.smoke.test.js
import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AIAgentFull from '../AIAgentFull';

vi.mock('../../services/demoAgentService', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, callMcpTool: vi.fn() };
});
vi.mock('../../services/privilegeMcpService', () => ({ callMcpToolViaPrivilege: vi.fn() }));

describe('AIAgentFull smoke', () => {
  test('renders the MCP transport picker and the disabled Privilege A2A stub', () => {
    render(
      <MemoryRouter>
        <AIAgentFull user={{ id: 'u1', role: 'customer' }} onLogout={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText(/mcp transport/i)).toBeInTheDocument();
    expect(screen.getByText(/privilege a2a/i)).toBeInTheDocument();
    expect(screen.getByText(/coming later/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/AIAgentFull.smoke.test.js`
Expected: FAIL — the transport picker / A2A text do not exist yet (only Step 1's plain duplicate exists so far).

- [ ] **Step 4: Add transport state + hook wiring**

In `demo_api_ui/src/components/AIAgentFull.js`, add the hook import alongside the file's existing imports (the file already imports many hooks/services at the top — add this one near them, e.g. right after the `react` import block):

```diff
 import React, {
   useCallback,
   useEffect,
   useMemo,
   useRef,
   useState,
 } from "react";
+import { useMcpToolTransport } from "../hooks/useMcpToolTransport";
```

Then, immediately after the existing `showDemoSteps` state declaration (the line reading `const [showDemoSteps, setShowDemoSteps] = useState(false);`), add:

```diff
   const [showDemoSteps, setShowDemoSteps] = useState(false);
+  /** "direct" (today's BFF pipeline) or "privilege" (standalone Privilege AI
+   * Gateway — no banking consent/HITL/kill-switch on this path). Shadows the
+   * module-level `callMcpTool` import below for the rest of this component;
+   * every existing call site in this file keeps working unchanged. */
+  const [mcpTransport, setMcpTransport] = useState("direct");
+  const callMcpTool = useMcpToolTransport(mcpTransport);
```

- [ ] **Step 5: Add the transport picker and A2A stub UI**

Immediately after the existing `AgentModeSelector` block (the one gated by `{!pageOwnsAgentChrome && (<AgentModeSelector .../>)}`), add two sibling controls, same gate:

```diff
                 {!pageOwnsAgentChrome && (
                 <AgentModeSelector
                   compact
                   heuristicFallback={heuristicEnabled}
                   onHeuristicFallbackChange={setHeuristicEnabled}
                 />
                 )}
+                {!pageOwnsAgentChrome && (
+                <label>
+                  MCP transport{" "}
+                  <select
+                    value={mcpTransport}
+                    onChange={(e) => setMcpTransport(e.target.value)}
+                  >
+                    <option value="direct">Direct</option>
+                    <option value="privilege">Via Privilege Gateway</option>
+                  </select>
+                </label>
+                )}
+                {!pageOwnsAgentChrome && mcpTransport === "privilege" && (
+                <span role="note" title="Privilege policy applies on this path; the banking demo's consent, HITL, and kill-switch checks do not run here.">
+                  Privilege enforces policy here — banking consent/HITL/kill-switch do not run on this path
+                </span>
+                )}
+                {!pageOwnsAgentChrome && (
+                <span aria-disabled="true" title="Not implemented yet">
+                  Privilege A2A — coming later
+                </span>
+                )}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/AIAgentFull.smoke.test.js`
Expected: PASS.

- [ ] **Step 7: Run the full UI unit suite to confirm nothing else broke**

Run: `cd demo_api_ui && npm run test:unit`
Expected: PASS — in particular, `src/utils/__tests__/embeddedAgentFabVisibility.test.js`, `src/hooks/__tests__/useMcpToolTransport.test.js`, `src/services/__tests__/privilegeMcpService.test.js`, and every pre-existing `AIAgent.js`-related test (untouched, so they must still be green — this is the check that Task 1-4 truly left `AIAgent.js` alone).

- [ ] **Step 8: Commit**

```bash
git add demo_api_ui/src/components/AIAgentFull.js demo_api_ui/src/components/__tests__/AIAgentFull.smoke.test.js
git commit -m "feat(agent): add AIAgentFull with a Privilege MCP transport picker and A2A stub"
```

---

## Task 5: Wire the toggle into `App.js`

**Files:**
- Modify: `demo_api_ui/src/App.js`

**Interfaces:**
- Consumes: `isFullAgentRoute` (Task 3), `AIAgentFull` default export (Task 4).

- [ ] **Step 1: Write the failing test**

```js
// demo_api_ui/src/__tests__/App.fullAgentToggle.test.jsx
import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';

vi.mock('../components/AIAgent', () => ({ default: () => <div data-testid="agent-simple" /> }));
vi.mock('../components/AIAgentFull', () => ({ default: () => <div data-testid="agent-full" /> }));
vi.mock('../utils/embeddedAgentFabVisibility', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, isFullAgentRoute: (p) => p === '/dashboard' };
});

describe('App — agent variant toggle', () => {
  test('mounts AIAgentFull on a route the allowlist opts in, AIAgent everywhere else', () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId('agent-full')).toBeInTheDocument();
    expect(screen.queryByTestId('agent-simple')).not.toBeInTheDocument();
  });
});
```

*(This test asserts the wiring in isolation via mocks; it does not need real auth/session setup because both agent components are mocked to a bare marker div.)*

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/__tests__/App.fullAgentToggle.test.jsx`
Expected: FAIL — `agent-full` testid never renders (App.js always mounts `AIAgent`).

- [ ] **Step 3: Write the minimal implementation**

```diff
 import AIAgent from "./components/AIAgent";
+import AIAgentFull from "./components/AIAgentFull";
```

```diff
 } from "./utils/embeddedAgentFabVisibility";
+import { isFullAgentRoute } from "./utils/embeddedAgentFabVisibility";
```

*(Or, if the existing import at line 246 is already a single destructured `import { ... } from "./utils/embeddedAgentFabVisibility";` block, add `isFullAgentRoute` into that same destructured list instead of a second import statement — match whichever form is already there.)*

Immediately before the `{shouldMountSingleAgent && (...)}` JSX block:

```diff
+  const AgentComponent = isFullAgentRoute(pathname) ? AIAgentFull : AIAgent;
   {shouldMountSingleAgent && (
     <ErrorBoundary>
-      <AIAgent
+      <AgentComponent
         user={user}
         onLogout={logout}
         embeddedFocus={resolveEmbeddedFocus(pathname)}
         distinctFloatingChrome
         surfaceHostEl={surfaceHostEl}
         onStopAgentClick={openAdminStopAgent}
         {...(isPingOneAdminAgentRoute(pathname)
           ? { forceVertical: "pingone-admin" }
           : {})}
         {...singleAgentSurfaceProps}
       />
     </ErrorBoundary>
   )}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/__tests__/App.fullAgentToggle.test.jsx`
Expected: PASS.

- [ ] **Step 5: Run the full UI unit suite + build**

Run: `cd demo_api_ui && npm run test:unit && npm run build`
Expected: both PASS — the build gate matters here since `App.js` is on every route's render path.

- [ ] **Step 6: Commit**

```bash
git add demo_api_ui/src/App.js demo_api_ui/src/__tests__/App.fullAgentToggle.test.jsx
git commit -m "feat(agent): wire isFullAgentRoute to mount AIAgentFull instead of AIAgent"
```

---

## Task 6: Document the deferred scope

**Files:**
- Modify: `TECH_DEBT.md`

- [ ] **Step 1: Add an entry**

Append a `TECH_DEBT.md` entry (matching that file's existing entry format) noting: `AIAgentFull`'s "Via Privilege Gateway" MCP transport calls the standalone `/api/privilege-mcp-simple/tools/call` and does **not** run the banking demo's RFC 8693 exchange, PingOne Authorize gate, HITL, or kill-switch (`mcpToolPipeline.js`) — correct for a policy-comparison demo affordance, not a production-equivalent transport. Real parity would mean adding Privilege as a third dispatch mode inside `mcpToolPipeline.js` alongside `callToolLocal`/`callToolViaGateway`, threaded through the existing Authorize/HITL/kill-switch checks — a separate, larger plan given `REGRESSION_PLAN.md` §1.

- [ ] **Step 2: Commit**

```bash
git add TECH_DEBT.md
git commit -m "docs: track full mcpToolPipeline Privilege integration as follow-up tech debt"
```

---

## Self-Review Notes

- **Spec coverage:** Decision #1 (AIAgent.js untouched) → verified by Task 4 Step 7 running the full pre-existing suite unmodified, and by Task 4/5 creating new files rather than editing `AIAgent.js`. Decision #2 (route toggle) → Task 3 + Task 5. Decision #3 (Demo Steps/LLM lane free) → no task touches `DemoStepsDropdown`/`AgentModeSelector`/`agentModes.js` — inherited by the Task 4 Step 1 duplicate. Decision #4 (additive MCP transport) → Tasks 1, 2, 4; Task 6 records the deferred full-integration path. Decision #5 (A2A stub) → Task 4 Step 5.
- **Type consistency:** `useMcpToolTransport`'s returned dispatcher signature `(tool, params = {}, opts = {})` matches `demoAgentService.callMcpTool`'s signature exactly (both default `params`/`opts`), and both `callMcpTool` (direct) and `callMcpToolViaPrivilege` resolve to `{result, tokenEvents}` — checked in Task 2's tests against both transports.
- **No placeholders:** every task's code is complete and runnable; Task 4's "duplicate the file" step is a real `cp` command (the ~12.7k unchanged lines are correctly not reproduced in the plan — nothing in them is TBD, they are copied verbatim), and every line the plan actually changes is shown in full.
