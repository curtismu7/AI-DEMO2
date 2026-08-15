# Delegation-Chain Value Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add UC2.6 (`a2a-generalist-mismatch`) — a new use-case chip that runs a real PERMIT delegation hop, then probes the real PingOne Authorize (mock) decision endpoint with a fabricated, unregistered actor identity to produce a genuine `invalid_a2a_generalist` DENY — and a new dedicated live page that runs UC2 and UC2.6 side by side to narrate RFC 8693's two value claims: accountability (audit trail) and authorization (actor-aware policy).

**Architecture:** UC2.6 reuses the existing `delegateToSpecialist` leg (real token mint + real PERMIT dispatch) unchanged, then adds one new service call (`probeGeneralistMismatch`) that POSTs a hand-built `parameters` object with a bogus `NestedActClientId` directly to the same mock decision endpoint the gateway calls (`POST {authz}/governance/pap/alpha/policy/{workerId}/decision`) — no new PingOne app, no gateway change, no `demo_authz_server` change (its `invalid_a2a_generalist` branch already exists and is exercised as-is). A new vertical-agnostic heuristic/tool pair routes a new chip phrase to this flow. The dedicated page is a thin trigger surface (mirrors `DemoTrackPage`'s `apiClient.post('/api/agent/invoke', ...)` pattern) — it does not render token-chain evidence itself; the existing global `FloatingTokenChainPanel` (mounted in `App.js` inside `TokenChainProvider`) already does that for any route added to `isTokenChainRoute`.

**Tech Stack:** demo_api_server (Node 22, CommonJS, Express, Jest — `CI=true npm test -- --forceExit`), demo_api_ui (React 19.2, Vite 8, Vitest — `npm run test:unit && npm run build`).

## Global Constraints

- Error responses use `{ error }` shape (demo_api_server/CLAUDE.md) — not applicable here (no new HTTP routes), but the service functions must return `{ ...base, error }` matching `delegateToSpecialist`'s existing convention.
- Emoji allowlist only: `⚠️` `✅` `❌` `🔐` `✕` `✓` `👤` `🔑` `🪟` `📚` (root CLAUDE.md §0).
- Use Super Sports (`sporting-goods`) as the default vertical for manual validation (root CLAUDE.md).
- Worktree already active: branch `worktree-delegation-chain-value-demo`. Stage files explicitly (`git add <files>`), never `git add -A`.
- After code edits, run `graphify update .` (per root CLAUDE.md) — skip if graphify is unavailable in this worktree (known: graphify is main-checkout only).
- Generated artifacts (`scopes`, `feature-data`, `vertical-tools`, `use-cases`, scope-topology) are code-generated — do not hand-edit; none of this plan's files are generated outputs.

---

### Task 1: New A2A-overlay tool + heuristic (mismatch probe trigger)

**Files:**
- Modify: `demo_api_server/config/verticals/a2a/index.js`
- Test: `demo_api_server/tests/a2aOverlayMismatchHeuristic.test.js` (create)

**Interfaces:**
- Produces: heuristic `{ re, action: 'a2a_generalist_mismatch' }` merged into every vertical's agent (consumed by Task 3's dispatch wiring, which checks `action === 'a2a_generalist_mismatch'`).
- Produces: tool name constant `'a2a_generalist_mismatch'` (consumed by Task 3's `resolveExecuteTool` branch, which checks `name === 'a2a_generalist_mismatch'`).

- [ ] **Step 1: Write the failing heuristic-match test**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const a2aOverlay = require('../config/verticals/a2a/index');

test('a2a overlay heuristic matches the mismatch-probe trigger phrase', () => {
  const [, mismatchHeuristic] = a2aOverlay.getHeuristics();
  assert.ok(mismatchHeuristic, 'expected a second heuristic entry for the mismatch probe');
  assert.strictEqual(mismatchHeuristic.action, 'a2a_generalist_mismatch');
  assert.ok(mismatchHeuristic.re.test('simulate an agent identity mismatch'));
});

test('a2a overlay heuristic does not match the plain delegate phrase', () => {
  const [, mismatchHeuristic] = a2aOverlay.getHeuristics();
  assert.ok(!mismatchHeuristic.re.test('hand off to a specialist'));
});

test('a2a overlay exposes the mismatch tool', () => {
  const tools = a2aOverlay.getTools();
  assert.ok(tools.some((t) => t.name === 'a2a_generalist_mismatch'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && node --test tests/a2aOverlayMismatchHeuristic.test.js`
Expected: FAIL — `getHeuristics()` returns only one entry, `getTools()` has no `a2a_generalist_mismatch`.

- [ ] **Step 3: Add the tool, heuristic, authz entry, and fallback executeTool branch**

In `demo_api_server/config/verticals/a2a/index.js`, after `DELEGATE_TOOL` (after line 34):

```js
const MISMATCH_TOOL = {
  name: 'a2a_generalist_mismatch',
  description:
    'Simulate what happens when an UNREGISTERED agent tries to act as the generalist in a specialist ' +
    'delegation — sends a fabricated actor identity to the same PingOne Authorize decision the gateway ' +
    'uses and shows the resulting DENY. Teaching/demo only: does not mint a real second agent identity.',
  inputSchema: {
    type: 'object',
    properties: {
      subtask: { type: 'string', description: 'What the specialist would have been asked to do.' },
      tool: { type: 'string', description: 'Optional: the specialist tool to probe (defaults to the vertical specialist’s tool).' },
    },
  },
  scopes: [],
  authz: {},
};
```

Replace the `HEURISTICS` array (lines 38-43) with:

```js
const HEURISTICS = [
  {
    re: /\b(delegate|hand\s*(off|over)|escalate)\b.*\b(specialist|advisor|agent|expert)\b|\b(ask|consult|involve|bring\s+in)\b.{0,20}\b(specialist|advisor|expert)\b|\bsecond\s+agent\b|\bspecialist\s+agent\b/i,
    action: 'delegate_to_specialist',
  },
  {
    re: /\bagent\s+identity\s+mismatch\b|\bagent\s+mismatch\b|\bunregistered\s+agent\b/i,
    action: 'a2a_generalist_mismatch',
  },
];
```

Replace `getTools`, `getAuthz`, and `executeTool` (lines 74, 68-70, 80-88):

```js
  getTools: () => [DELEGATE_TOOL, MISMATCH_TOOL],
```

```js
function getAuthz() {
  return { [DELEGATE_TOOL.name]: DELEGATE_TOOL.authz, [MISMATCH_TOOL.name]: MISMATCH_TOOL.authz };
}
```

```js
  executeTool: async (name) => {
    if (name === DELEGATE_TOOL.name) {
      return {
        result: { error: 'delegate_to_specialist must be handled by the A2A interception (missing req/vertical context).' },
        render: 'text',
      };
    }
    if (name === MISMATCH_TOOL.name) {
      return {
        result: { error: 'a2a_generalist_mismatch must be handled by the A2A interception (missing req/vertical context).' },
        render: 'text',
      };
    }
    return { result: { error: `unknown a2a action: ${name}` }, render: 'text' };
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && node --test tests/a2aOverlayMismatchHeuristic.test.js`
Expected: PASS (all 3 tests)

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/config/verticals/a2a/index.js demo_api_server/tests/a2aOverlayMismatchHeuristic.test.js
git commit -m "feat: add a2a_generalist_mismatch tool + heuristic to A2A overlay"
```

---

### Task 2: `probeGeneralistMismatch` service function

**Files:**
- Modify: `demo_api_server/services/a2aDelegationService.js`
- Test: `demo_api_server/src/__tests__/a2aDelegationService.test.js`

**Interfaces:**
- Consumes: `specialistForVertical`, `deriveSpecialistScopes`, `resolveA2aConfig`, `isA2aEnabled`, `buildA2aEvent` (all already defined in this file).
- Produces: `async function probeGeneralistMismatch(req, opts)` where `opts = { vertical, tool, tokenEvents, deps }`. Returns `{ tokenEvents, decision: 'PERMIT'|'DENY'|null, reason: string|null, simulated: true, error?: string }`. Consumed by Task 3's `executeA2aGeneralistMismatch`.

- [ ] **Step 1: Write the failing unit test**

Add to `demo_api_server/src/__tests__/a2aDelegationService.test.js` (mirror the file's existing dependency-injection style — check the top of the file for its existing `deps` fake shape before adding; use the same `configStore`/`scopeTopology` fakes already defined there for `delegateToSpecialist` tests):

```js
describe('probeGeneralistMismatch', () => {
  it('POSTs a fabricated NestedActClientId to the decision endpoint and records a DENY event', async () => {
    const fakeAxios = {
      post: jest.fn().mockResolvedValue({
        data: { decision: 'DENY', reason: 'invalid_a2a_generalist: nested act.sub "unregistered-simulated-agent" is not the authorized generalist' },
      }),
    };
    const tokenEvents = [];
    const result = await a2aDelegationService.probeGeneralistMismatch(
      { session: { user: { id: 'user-1' } } },
      { vertical: 'investment', tool: 'get_portfolio_summary', tokenEvents, deps: { axios: fakeAxios, configStore: fakeConfigStore, scopeTopology: fakeScopeTopology } },
    );
    expect(result.decision).toBe('DENY');
    expect(result.simulated).toBe(true);
    expect(fakeAxios.post).toHaveBeenCalledWith(
      expect.stringContaining('/governance/pap/alpha/policy/'),
      expect.objectContaining({
        parameters: expect.objectContaining({
          ActChainDepth: '2',
          NestedActClientId: 'unregistered-simulated-agent',
          ToolName: 'get_portfolio_summary',
        }),
      }),
      expect.any(Object),
    );
    expect(tokenEvents).toHaveLength(1);
    expect(tokenEvents[0].id).toBe('a2a-mismatch-probe');
    expect(tokenEvents[0].decision).toBe('DENY');
  });

  it('returns an error when no specialist is configured for the vertical', async () => {
    const result = await a2aDelegationService.probeGeneralistMismatch(
      { session: { user: { id: 'user-1' } } },
      { vertical: 'not-a-real-vertical', tokenEvents: [], deps: { axios: { post: jest.fn() }, configStore: fakeConfigStore, scopeTopology: fakeScopeTopology } },
    );
    expect(result.error).toMatch(/No A2A specialist configured/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/a2aDelegationService.test.js -t probeGeneralistMismatch --forceExit`
Expected: FAIL — `a2aDelegationService.probeGeneralistMismatch is not a function`

- [ ] **Step 3: Implement `probeGeneralistMismatch`**

In `demo_api_server/services/a2aDelegationService.js`, add after `defaultScopeTopology()` (after line ~64-70, alongside the other `default*` helpers):

```js
function defaultAxios() {
  return require('axios');
}

function authzEndpoint() {
  return process.env.PINGAUTHORIZE_ENDPOINT || 'http://localhost:9001';
}
function authzWorkerId() {
  return process.env.PINGAUTHORIZE_WORKER_ID || 'mcp-gateway-policy';
}

/**
 * Deliberately unregistered — any registered PingOne client id would make this
 * a real (not simulated) mismatch, defeating the point of the probe.
 */
const MISMATCH_NESTED_ACT_CLIENT_ID = 'unregistered-simulated-agent';
```

Add after `delegateToSpecialist` (after its closing brace, before `countActDepth`):

```js
/**
 * Probe the same decision endpoint the gateway calls (POST .../decision) with a
 * fabricated, unregistered NestedActClientId — demonstrates the
 * invalid_a2a_generalist DENY (demo_authz_server/routes/decision.js:554-558)
 * without minting a real second agent identity. See docs/superpowers/specs/
 * 2026-08-11-delegation-chain-value-demo-design.md for why this is simulated
 * rather than a full live token mint.
 * @param {object} req - Express request (only req.session.user.id is read)
 * @param {object} opts - { vertical, tool, tokenEvents, deps }
 * @returns {Promise<{tokenEvents: object[], decision: string|null, reason: string|null, simulated: true, error?: string}>}
 */
async function probeGeneralistMismatch(req, opts = {}) {
  const deps = opts.deps || {};
  const cfg = deps.configStore || defaultConfigStore();
  const httpClient = deps.axios || defaultAxios();
  const scopeTopo = deps.scopeTopology || defaultScopeTopology();

  const tokenEvents = opts.tokenEvents || [];
  const vertical = opts.vertical;
  const base = { tokenEvents, decision: null, reason: null, simulated: true };

  if (!isA2aEnabled(cfg)) {
    return { ...base, error: 'a2a_delegation_disabled' };
  }
  const specialist = specialistForVertical(vertical);
  if (!specialist) {
    return { ...base, error: `No A2A specialist configured for vertical "${vertical}"` };
  }
  const tool = opts.tool || (specialist.tools || [])[0] || null;
  if (!tool) {
    return { ...base, error: `No specialist tool available for vertical "${vertical}"` };
  }

  const specialistScopes = deriveSpecialistScopes(specialist, scopeTopo);
  const c = resolveA2aConfig(cfg, specialist, scopeTopo);

  const parameters = {
    DecisionContext: 'McpToolCall',
    McpMethod: 'tools/call',
    ToolName: tool,
    ClientId: req?.session?.user?.id || 'demo-user',
    ActClientId: c.agent2ClientId || '',
    TokenScopes: specialistScopes.join(' '),
    TokenAudience: c.specialistAud || 'mcpgateway.ping.demo',
    TransactionAmount: '',
    TransactionType: tool,
    ToAccountId: '',
    HitlApproved: '',
    ActChainDepth: '2',
    NestedActClientId: MISMATCH_NESTED_ACT_CLIENT_ID,
  };

  const decisionUrl = `${authzEndpoint()}/governance/pap/alpha/policy/${authzWorkerId()}/decision`;

  try {
    const response = await httpClient.post(
      decisionUrl,
      { parameters },
      { timeout: 5000, headers: { 'Content-Type': 'application/json' } },
    );
    const decision = response.data?.decision || null;
    const reason = response.data?.reason || null;
    tokenEvents.push(buildA2aEvent(
      'a2a-mismatch-probe',
      `A2A — Simulated actor-mismatch probe (${specialist.specialistName})`,
      decision === 'DENY' ? 'denied' : 'evaluated',
      null,
      'A fabricated, unregistered NestedActClientId was sent directly to the same decision endpoint the ' +
      'gateway calls (not a full live token mint) — PingOne Authorize DENYs because the nested act.sub is ' +
      'not the registered generalist. This proves the policy evaluates the AGENT identity, not just the user.',
      { a2aRole: 'mismatch-probe', decision, reason, nestedActClientId: MISMATCH_NESTED_ACT_CLIENT_ID, simulated: true, vertical, specialist: specialist.specialistName },
    ));
    return { ...base, decision, reason };
  } catch (err) {
    return { ...base, error: err.message || 'mismatch_probe_failed' };
  }
}
```

Add `probeGeneralistMismatch,` to the `module.exports` block (after `delegateToSpecialist,`).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/a2aDelegationService.test.js -t probeGeneralistMismatch --forceExit`
Expected: PASS (both tests)

- [ ] **Step 5: Run the full file's existing tests to confirm no regression**

Run: `cd demo_api_server && CI=true npx jest src/__tests__/a2aDelegationService.test.js --forceExit`
Expected: PASS (all tests, including pre-existing `delegateToSpecialist` tests)

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/services/a2aDelegationService.js demo_api_server/src/__tests__/a2aDelegationService.test.js
git commit -m "feat: add probeGeneralistMismatch — simulated actor-mismatch DENY probe"
```

---

### Task 3: Wire `executeA2aGeneralistMismatch` into dispatch

**Files:**
- Modify: `demo_api_server/services/demoAgentLangGraphService.js`
- Test: `demo_api_server/tests/agentTool.a2aGeneralistMismatch.test.js` (create — mirror `demo_api_server/tests/agentTool.a2aFastPath.test.js`'s setup/mocking style)

**Interfaces:**
- Consumes: `executeA2aDelegation` (existing, same file), `a2aDelegationService.probeGeneralistMismatch` (Task 2).
- Produces: `async function executeA2aGeneralistMismatch(activeId, args, { req, tokenEvents, sessionId })` returning a JSON string `{ ...leg1Result, mismatchProbe: { decision, reason, error? } }` or `JSON.stringify(leg1Result)` if leg 1 itself errored. Exported for tests via the `__test` block.

- [ ] **Step 1: Write the failing test**

`executeA2aDelegation` and `executeA2aGeneralistMismatch` both call `a2aDelegationService` via a fresh `require('./a2aDelegationService')` inside the function body — that returns the same cached `module.exports` object every call, so mocking `delegateToSpecialist`/`probeGeneralistMismatch` on that shared object (not the internal `executeA2aDelegation` closure reference, which `mock.method` cannot intercept) is what actually takes effect:

```js
'use strict';
const { test, mock } = require('node:test');
const assert = require('node:assert');

test('executeA2aGeneralistMismatch runs leg 1 then probes the mismatch and merges both results', async () => {
  const svc = require('../services/demoAgentLangGraphService');
  const a2a = require('../services/a2aDelegationService');

  mock.method(a2a, 'delegateToSpecialist', async () =>
    ({ token: 'fake-token', tool: 'get_portfolio_summary', userSub: 'user-1', tokenEvents: [] }));
  mock.method(a2a, 'probeGeneralistMismatch', async () =>
    ({ decision: 'DENY', reason: 'invalid_a2a_generalist: ...', simulated: true, tokenEvents: [] }));

  const json = await svc.executeA2aGeneralistMismatch('investment', {}, { req: {}, tokenEvents: [], sessionId: 's1' });
  const parsed = JSON.parse(json);

  assert.strictEqual(parsed.token, 'fake-token');
  assert.strictEqual(parsed.mismatchProbe.decision, 'DENY');

  mock.restoreAll();
});

test('executeA2aGeneralistMismatch skips the probe when leg 1 fails', async () => {
  const svc = require('../services/demoAgentLangGraphService');
  const a2a = require('../services/a2aDelegationService');

  mock.method(a2a, 'delegateToSpecialist', async () => ({ error: 'a2a_delegation_disabled', tokenEvents: [] }));
  mock.method(a2a, 'probeGeneralistMismatch', async () => { throw new Error('must not be called'); });

  const json = await svc.executeA2aGeneralistMismatch('investment', {}, { req: {}, tokenEvents: [], sessionId: 's1' });
  const parsed = JSON.parse(json);

  assert.strictEqual(parsed.error, 'a2a_delegation_disabled');
  assert.strictEqual(parsed.mismatchProbe, undefined);

  mock.restoreAll();
});
```

(Read `demo_api_server/tests/agentTool.a2aFastPath.test.js` first — it mocks the same way, at the `a2aDelegationService` layer — to match its exact fake `req`/session shape.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && node --test tests/agentTool.a2aGeneralistMismatch.test.js`
Expected: FAIL — `executeA2aGeneralistMismatch is not a function`

- [ ] **Step 3: Implement `executeA2aGeneralistMismatch` and wire the two dispatch sites**

In `demo_api_server/services/demoAgentLangGraphService.js`, add after `executeA2aDelegation`'s closing brace (after line ~950, before the `A2A_TOOL_RENDER`/`buildA2aReplyEnvelope` comment block):

```js
/**
 * a2a_generalist_mismatch: runs the real delegateToSpecialist leg (genuine
 * PERMIT), then probes the decision endpoint with a fabricated actor identity
 * to produce a genuine invalid_a2a_generalist DENY. See a2aDelegationService.
 * probeGeneralistMismatch for why this is a probe, not a second live exchange.
 */
async function executeA2aGeneralistMismatch(activeId, args, { req, tokenEvents, sessionId }) {
  const a2a = require('./a2aDelegationService');
  const events = tokenEvents || [];
  const leg1Json = await executeA2aDelegation(activeId, args, { req, tokenEvents: events, sessionId });
  let leg1;
  try { leg1 = JSON.parse(leg1Json); } catch (_) { leg1 = { delegated: false, error: leg1Json }; }
  if (leg1.error || !leg1.token) {
    return JSON.stringify(leg1);
  }
  const mismatch = await a2a.probeGeneralistMismatch(req, {
    vertical: activeId,
    tool: leg1.tool,
    tokenEvents: events,
  });
  return JSON.stringify({
    ...leg1,
    mismatchProbe: { decision: mismatch.decision, reason: mismatch.reason, error: mismatch.error },
  });
}
```

In `resolveExecuteTool` (around line 1023), add a branch immediately before `if (name === 'delegate_to_specialist')`:

```js
    if (name === 'a2a_generalist_mismatch') {
      const json = await executeA2aGeneralistMismatch(activeId, args, { req, tokenEvents, sessionId });
      if (a2aResultRef) {
        try { a2aResultRef.current = JSON.parse(json); } catch (_) { /* leave unset */ }
      }
      return json;
    }
```

In `dispatchVerticalIntent` (around line 1366), add a branch immediately before `if (action === 'delegate_to_specialist')`:

```js
  if (action === 'a2a_generalist_mismatch') {
    const a2aJson = await executeA2aGeneralistMismatch(vertical, params || {}, { req, tokenEvents, sessionId });
    let a2a;
    try { a2a = JSON.parse(a2aJson); } catch (_) { a2a = { delegated: false, error: a2aJson }; }
    return buildA2aReplyEnvelope(a2a, tokenEvents);
  }
```

Also add `action !== 'a2a_generalist_mismatch'` to the fast-path guard at line 1234 (`if (action !== 'delegate_to_specialist')`) so the explicit branch above runs instead of the generic a2aDelegated-tool fast path:

```js
  if (action !== 'delegate_to_specialist' && action !== 'a2a_generalist_mismatch') {
```

Add `executeA2aGeneralistMismatch,` to both the main `module.exports` (alongside `executeA2aDelegation,` near line 2188) and the `__test` block (alongside `executeA2aDelegation` at line 2189).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && node --test tests/agentTool.a2aGeneralistMismatch.test.js`
Expected: PASS (both tests)

- [ ] **Step 5: Run the existing A2A fast-path test to confirm no regression**

Run: `cd demo_api_server && node --test tests/agentTool.a2aFastPath.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/services/demoAgentLangGraphService.js demo_api_server/tests/agentTool.a2aGeneralistMismatch.test.js
git commit -m "feat: wire a2a_generalist_mismatch action into agent dispatch"
```

---

### Task 4: Flag prerequisite mirrors (BFF + UI)

**Files:**
- Modify: `demo_api_server/services/demoStepPrerequisites.js:20-23`
- Modify: `demo_api_ui/src/utils/requiredDemoFlags.js:8-11`
- Test: existing `demo_api_server/tests/demoStepPrerequisites*.test.js` (find via `find demo_api_server/tests -iname '*demoStepPrerequisites*'`) and `demo_api_ui/src/utils/__tests__/requiredDemoFlags.test.js`

**Interfaces:**
- Produces: both `A2A_USE_CASE_IDS` sets now include `'a2a-generalist-mismatch'`, so `requiredFlagsForUseCase({ useCaseId: 'a2a-generalist-mismatch' })` returns `['ff_a2a_delegation']` on both sides (kept in sync per the file's own header comment).

- [ ] **Step 1: Write the failing tests**

Append to `demo_api_ui/src/utils/__tests__/requiredDemoFlags.test.js`:

```js
it('requires ff_a2a_delegation for a2a-generalist-mismatch', () => {
  expect(requiredFlagsForUseCase({ useCaseId: 'a2a-generalist-mismatch', primaryTool: 'sensitive_holdings' }))
    .toContain('ff_a2a_delegation');
});
```

Find the equivalent BFF test file (`find demo_api_server/tests -iname '*demoStepPrerequisites*'`) and append the analogous assertion against `requiredFlagsForUseCase`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd demo_api_ui && npx vitest run src/utils/__tests__/requiredDemoFlags.test.js`
Expected: FAIL — flag not included

Run the equivalent BFF test file with `node --test <path>` or `CI=true npx jest <path> --forceExit` (match whatever runner that file already uses).
Expected: FAIL

- [ ] **Step 3: Add the use-case id to both sets**

`demo_api_server/services/demoStepPrerequisites.js:20-23`:

```js
const A2A_USE_CASE_IDS = new Set([
  'a2a-delegation',
  'a2a-orchestrator-learning',
  'a2a-generalist-mismatch',
]);
```

`demo_api_ui/src/utils/requiredDemoFlags.js:8-11`: identical change.

- [ ] **Step 4: Run tests to verify they pass**

Re-run both commands from Step 2.
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/demoStepPrerequisites.js demo_api_ui/src/utils/requiredDemoFlags.js demo_api_ui/src/utils/__tests__/requiredDemoFlags.test.js demo_api_server/tests/<demoStepPrerequisites test file>
git commit -m "feat: arm ff_a2a_delegation for a2a-generalist-mismatch"
```

---

### Task 5: UC2.6 catalog entry

**Files:**
- Modify: `demo_api_server/config/useCases.js`

**Interfaces:**
- Consumes: `A2A_PRIMARY_TOOL_BY_VERTICAL` (existing, line 238), `A2A_TOOL_RENDER` is NOT reused (that's UC2/UC2.5-specific card rendering, out of scope).
- Produces: catalog entry with `id: 'UC2.6'`, `useCaseId: 'a2a-generalist-mismatch'` — consumed by Task 4 (flag lookup), the offline trigger audit, and Task 6 (UI event labels reference it only via evidence.tokenChain ids, no direct code coupling).

- [ ] **Step 1: Add the per-vertical primaryTool map and the catalog entry**

In `demo_api_server/config/useCases.js`, immediately after `const A2A_PER_VERTICAL = chipOverrides(...)` (line 250), add:

```js
/**
 * UC2.6 reuses the SAME per-vertical specialist tool as UC2 (same delegation
 * leg 1) but keeps ONE neutral trigger phrase across all verticals — the
 * mismatch heuristic is vertical-agnostic (config/verticals/a2a/index.js), so
 * unlike A2A_PER_VERTICAL there is no per-vertical trigger text to override.
 * resolveUseCase falls back to the base `trigger` when an override omits it.
 */
const A2A_MISMATCH_PER_VERTICAL = Object.fromEntries(
  Object.entries(A2A_PRIMARY_TOOL_BY_VERTICAL).map(([v, primaryTool]) => [v, { primaryTool }]),
);
```

Then add the catalog entry immediately after the UC2.5 object (find its closing `},` before whatever UC3 entry follows; insert between them):

```js
  {
    id: 'UC2.6',
    useCaseId: 'a2a-generalist-mismatch',
    track: 'foundations',
    title: 'A2A generalist mismatch',
    buyerStory: 'A resource server must be able to tell WHICH agent is acting on the user\'s behalf, not just that some agent is — the same user with a different, unregistered agent must be denied.',
    pingOneSolution: 'PingOne Authorize evaluates the nested act chain\'s actor identity, not just the subject — an unregistered generalist is denied even though the user and the delegation shape are otherwise valid.',
    trigger: { type: 'chip', text: 'simulate an agent identity mismatch' },
    expectedOutcome: 'PERMIT_THEN_DENY',
    evidence: {
      tokenChain: ['user-token', 'a2a-agent1-actor', 'a2a-exchange1', 'a2a-agent2-actor', 'a2a-exchange2', 'tool-dispatched', 'a2a-mismatch-probe'],
      activity: ['token', 'delegate', 'authorize', 'mcp', 'authorize'],
    },
    codeRefs: [
      'demo_api_server/services/a2aDelegationService.js',
      'demo_api_server/services/demoAgentLangGraphService.js',
      'demo_authz_server/routes/decision.js',
    ],
    maturity: 'flag:ff_a2a_delegation',
    owasp: { threats: ['T9', 'T13'], sections: ['§4.2.3', '§4.3'] },
    whatToSay: 'Same user, same delegation shape — but an unregistered agent identity is denied. Authorization keys on WHO is acting, not just who they act for.',
    advanced: false,
    whatLong: 'Runs the same real, governed delegation as A2A delegation (a genuine PERMIT), then probes the same PingOne Authorize decision the gateway calls with a fabricated, unregistered actor identity in place of the real generalist. The result is a genuine invalid_a2a_generalist DENY from live policy — proof that authorization decisions account for the AGENT\'s identity, not only the user\'s. The probe does not mint a real second agent token; it demonstrates the policy branch directly.',
    businessValue: 'A stolen or rogue agent credential cannot ride on a legitimate user\'s delegation shape — the policy engine denies based on actor identity even when the subject and act-chain depth look correct. This is the authorization half of the delegation-chain value proposition (the audit-trail half is UC2/UC2.5).',
    productRoles: {
      idp:   'Mints the real leg-1 delegated token exactly as UC2; the mismatch probe itself mints no token.',
      gw:    'Not involved in the probe leg — the probe calls the decision endpoint directly, same contract the gateway uses.',
      authz: 'Evaluates ActChainDepth and NestedActClientId; DENYs invalid_a2a_generalist when the actor does not match the registered generalist.',
    },
    primaryTool: 'sensitive_holdings',
    perVertical: A2A_MISMATCH_PER_VERTICAL,
  },
```

(`primaryTool: 'sensitive_holdings'` matches banking/investment's UC2 value — banking has no `perVertical` override so it serves the base entry unchanged, same pattern UC2 itself uses.)

- [ ] **Step 2: Run the offline trigger audit**

Run:
```bash
cd demo_api_server && node -e "
const {parseHeuristic,resolveVerticalCtx}=require('./services/nlIntentParser');
const {USE_CASES,VERTICALS,resolveUseCase}=require('./config/useCases.js');
let f=[];for(const v of VERTICALS){const c=resolveVerticalCtx(v);for(const u of USE_CASES){const t=(resolveUseCase(u.id,v)||u).trigger;if(!t||t.type!=='chip')continue;const r=parseHeuristic(t.text,v,c,{});if(!r||r.kind==='none')f.push(v+' '+u.id+' \"'+t.text+'\"')}}
console.log(f.length?f.join('\n'):'all triggers match');"
```
Expected: `all triggers match`

- [ ] **Step 3: Run the drift-gate tests**

Run: `cd demo_api_server && CI=true npx jest tests/useCases.primaryTool.test.js tests/useCases.scenarioDistinctness.test.js --forceExit`
Expected: PASS. If `useCases.primaryTool.test.js` fails naming a mismatch between declared `primaryTool` and actual routing, read its failure message — it names the exact expected value; adjust the `primaryTool` field (not the test).

- [ ] **Step 4: Commit**

```bash
git add demo_api_server/config/useCases.js
git commit -m "feat: add UC2.6 a2a-generalist-mismatch catalog entry"
```

---

### Task 6: TokenChainDisplay event rendering

**Files:**
- Modify: `demo_api_ui/src/components/TokenChainDisplay.jsx:2831-2839` (order array), `:3008-3016` (label map)
- Test: `demo_api_ui/src/components/__tests__/TokenChainDisplay.a2aProgress.test.jsx`

**Interfaces:**
- Consumes: event shape `{ id: 'a2a-mismatch-probe', decision, reason, ... }` produced by Task 2's `buildA2aEvent` call.
- Produces: nothing new consumed elsewhere — this is leaf UI rendering only.

- [ ] **Step 1: Write the failing test**

Add to `demo_api_ui/src/components/__tests__/TokenChainDisplay.a2aProgress.test.jsx` (new `describe` block, following the existing file's mock setup — add `{ id: 'a2a-mismatch-probe', label: 'Simulated actor-mismatch probe', status: 'denied', decision: 'DENY', reason: 'invalid_a2a_generalist: ...' }` to a local events array reusing the same mocked `useTokenChainOptional`):

```js
describe('A2A mismatch-probe event', () => {
  it('renders a label for the mismatch-probe event id', () => {
    const events = [...EVENTS, { id: 'a2a-mismatch-probe', label: 'Simulated actor-mismatch probe', status: 'denied', decision: 'DENY' }];
    vi.doMock('../../context/TokenChainContext', () => ({
      useTokenChainOptional: () => ({ events, history: [], mcpToolCalls: [], mcpAuthMode: null, nlRoutingEvent: null, clearEvents: vi.fn(), clearMcpToolCalls: vi.fn(), resolvedIdentity: null }),
    }));
    global.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    render(<TokenChainDisplay />);
    expect(screen.getByText(/Actor-Mismatch Probe/i)).toBeInTheDocument();
  });
});
```

(If `vi.doMock` mid-file doesn't override the top-level `vi.mock` cleanly under this file's existing structure, instead add the event directly to the shared `EVENTS` const at the top of the file and assert its label is present in the existing render test — check which approach fits the file's actual mocking mechanics during implementation.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/TokenChainDisplay.a2aProgress.test.jsx`
Expected: FAIL — label text not found (falls back to raw event id or generic label)

- [ ] **Step 3: Add the event id to the order array and label map**

`demo_api_ui/src/components/TokenChainDisplay.jsx`, in the order array (after `"a2a-exchange2",` at line 2835):

```js
  "a2a-exchange2",
  "a2a-mismatch-probe",
```

In the label map (after `"a2a-exchange-failed": "A2A Delegation Failed",` at line 3013):

```js
  "a2a-exchange-failed": "A2A Delegation Failed",
  "a2a-mismatch-probe": "A2A Actor-Mismatch Probe (Simulated)",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/TokenChainDisplay.a2aProgress.test.jsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/TokenChainDisplay.jsx demo_api_ui/src/components/__tests__/TokenChainDisplay.a2aProgress.test.jsx
git commit -m "feat: render the A2A actor-mismatch probe event in TokenChainDisplay"
```

---

### Task 7: Dedicated delegation-chain-value page

**Files:**
- Create: `demo_api_ui/src/pages/DelegationChainValuePage.jsx`
- Create: `demo_api_ui/src/pages/DelegationChainValuePage.css`
- Modify: `demo_api_ui/src/App.js` (route)
- Modify: `demo_api_ui/src/components/AdminSideNav.jsx` (nav entry + path group)
- Modify: `demo_api_ui/src/utils/embeddedAgentFabVisibility.js:61-65` (`isTokenChainRoute` allowlist)
- Test: `demo_api_ui/src/pages/__tests__/DelegationChainValuePage.test.jsx` (create)
- Test: `demo_api_ui/src/utils/__tests__/embeddedAgentFabVisibility.test.js` (extend)

**Interfaces:**
- Consumes: `apiClient` (`demo_api_ui/src/services/apiClient.js`), `requiredFlagsForUseCase` (Task 4), UC2/UC2.6 trigger text (hardcoded — the page does not need the full catalog, only the two trigger strings and vertical).
- Produces: route `/delegation-chain-value`, rendered globally via the existing `TokenChainProvider`/`FloatingTokenChainPanel` (no new context needed).

- [ ] **Step 1: Write the failing route-visibility test**

Add to `demo_api_ui/src/utils/__tests__/embeddedAgentFabVisibility.test.js`:

```js
it('treats /delegation-chain-value as a token-chain route', () => {
  expect(isTokenChainRoute('/delegation-chain-value')).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/utils/__tests__/embeddedAgentFabVisibility.test.js`
Expected: FAIL

- [ ] **Step 3: Add the route to `isTokenChainRoute`**

`demo_api_ui/src/utils/embeddedAgentFabVisibility.js:61-65`:

```js
export function isTokenChainRoute(pathname) {
  if (pathname == null || typeof pathname !== 'string') return false;
  const p = pathname.replace(/\/$/, '') || '/';
  return p === '/' || p === '/dashboard' || p === '/admin' || p === '/agent-flow-inspector' || p === '/delegation-chain-value';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/utils/__tests__/embeddedAgentFabVisibility.test.js`
Expected: PASS

- [ ] **Step 5: Write the page component**

`demo_api_ui/src/pages/DelegationChainValuePage.jsx`:

```jsx
import React, { useCallback, useState } from "react";
import apiClient from "../services/apiClient";
import { requiredFlagsForUseCase } from "../utils/requiredDemoFlags";
import "./DelegationChainValuePage.css";

const VERTICAL = "sporting-goods";

const RUNS = [
  {
    key: "accountability",
    heading: "Accountability — the audit trail",
    body: "Every hop in a multi-agent delegation is recorded as a nested act claim bound to the user. This run delegates to a specialist agent and mints a real, governed token — the full chain (who acted, on whose behalf) is attributable end to end.",
    prompt: "hand off to a specialist",
    primaryTool: "sensitive_holdings",
  },
  {
    key: "authorization",
    heading: "Authorization — the actor-aware decision",
    body: "A resource server can evaluate not just what the user can do, but whether THIS agent may act for them. This run repeats the same governed delegation, then probes the same policy decision with an unregistered agent identity in place of the real one — same user, same shape, denied.",
    prompt: "simulate an agent identity mismatch",
    primaryTool: "sensitive_holdings",
  },
];

export default function DelegationChainValuePage() {
  const [status, setStatus] = useState({});
  const [results, setResults] = useState({});

  const run = useCallback(async (entry) => {
    setStatus((s) => ({ ...s, [entry.key]: "running" }));
    try {
      const flags = requiredFlagsForUseCase({ useCaseId: null, primaryTool: entry.primaryTool, maturity: "flag:ff_a2a_delegation" });
      if (flags.length) {
        const updates = Object.fromEntries(flags.map((f) => [f, true]));
        await apiClient.patch("/api/admin/feature-flags", { updates }).catch(() => {});
      }
      const res = await apiClient.post("/api/agent/invoke", { prompt: entry.prompt, forceHeuristic: true, vertical: VERTICAL });
      setResults((r) => ({ ...r, [entry.key]: { reply: res.data?.reply || "", tools: res.data?.toolsCalled || [] } }));
      setStatus((s) => ({ ...s, [entry.key]: "done" }));
    } catch (err) {
      setStatus((s) => ({ ...s, [entry.key]: "error" }));
      setResults((r) => ({ ...r, [entry.key]: { error: err.message } }));
    }
  }, []);

  return (
    <div className="dcv-page">
      <h1>The value of preserving the delegation chain</h1>
      <p className="dcv-intro">
        Token exchange provides two benefits for agentic systems: an evidential audit trail (accountability),
        and authorization decisions that account for the agent as well as the user. Run each scenario below and
        watch the token chain panel for the evidence.
      </p>
      {RUNS.map((entry) => (
        <section key={entry.key} className="dcv-run">
          <h2>{entry.heading}</h2>
          <p>{entry.body}</p>
          <button type="button" onClick={() => run(entry)} disabled={status[entry.key] === "running"}>
            {status[entry.key] === "running" ? "Running…" : "Run"}
          </button>
          {results[entry.key]?.reply && <p className="dcv-reply">{results[entry.key].reply}</p>}
          {results[entry.key]?.error && <p className="dcv-error">{results[entry.key].error}</p>}
        </section>
      ))}
    </div>
  );
}
```

`demo_api_ui/src/pages/DelegationChainValuePage.css`:

```css
.dcv-page { max-width: 760px; margin: 0 auto; padding: var(--th-space-lg, 24px); }
.dcv-intro { color: var(--th-text-secondary, #555); margin-bottom: var(--th-space-lg, 24px); }
.dcv-run { border: 1px solid var(--th-border, #ddd); border-radius: 8px; padding: var(--th-space-md, 16px); margin-bottom: var(--th-space-md, 16px); }
.dcv-reply { margin-top: var(--th-space-sm, 8px); }
.dcv-error { color: var(--th-error, #c00); margin-top: var(--th-space-sm, 8px); }
```

(Verify the exact `--th-*` token names against an existing page's CSS file, e.g. `ResourceServerJourneyPage.css`, before finalizing — the project's dark-mode contract requires these to resolve in both themes; do not invent literal color fallbacks outside a panel, per the `--th-*` tokens memory.)

- [ ] **Step 6: Register the route**

`demo_api_ui/src/App.js`, add near the `/demo-track` route (after line 1490):

```jsx
                            <Route
                              path="/delegation-chain-value"
                              element={<DelegationChainValuePage />}
                            />
```

Add the import near the top with the other page imports (alongside `import DemoTrackPage from "./pages/DemoTrackPage";` at line 30):

```jsx
import DelegationChainValuePage from "./pages/DelegationChainValuePage";
```

- [ ] **Step 7: Add the nav entry**

`demo_api_ui/src/components/AdminSideNav.jsx`, in the `demos` path group (line 163), add the new path:

```js
  { id: "demos", paths: ["/delegated-commerce", "/use-cases", "/use-cases/live", "/demo-track", "/group-policy", "/demo-config", "/delegation", "/delegation-chain-value"] },
```

In the `Demos` children array (after `{ label: "Guided Demo Track", path: "/demo-track", icon: "demo" },` at line 509):

```js
        { label: "Delegation Chain Value", path: "/delegation-chain-value", icon: "demo" },
```

- [ ] **Step 8: Write a component test**

`demo_api_ui/src/pages/__tests__/DelegationChainValuePage.test.jsx`:

```jsx
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import DelegationChainValuePage from "../DelegationChainValuePage";
import apiClient from "../../services/apiClient";

vi.mock("../../services/apiClient", () => ({
  default: { post: vi.fn(), patch: vi.fn() },
}));

describe("DelegationChainValuePage", () => {
  it("renders both scenario sections", () => {
    render(<DelegationChainValuePage />);
    expect(screen.getByText(/Accountability/i)).toBeInTheDocument();
    expect(screen.getByText(/Authorization/i)).toBeInTheDocument();
  });

  it("invokes the agent with the accountability trigger phrase on Run", async () => {
    apiClient.patch.mockResolvedValue({});
    apiClient.post.mockResolvedValue({ data: { reply: "done", toolsCalled: ["sensitive_holdings"] } });
    render(<DelegationChainValuePage />);
    const [runButton] = screen.getAllByText("Run");
    fireEvent.click(runButton);
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith(
      "/api/agent/invoke",
      expect.objectContaining({ prompt: "hand off to a specialist" }),
    ));
  });
});
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `cd demo_api_ui && npx vitest run src/pages/__tests__/DelegationChainValuePage.test.jsx`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add demo_api_ui/src/pages/DelegationChainValuePage.jsx demo_api_ui/src/pages/DelegationChainValuePage.css demo_api_ui/src/App.js demo_api_ui/src/components/AdminSideNav.jsx demo_api_ui/src/utils/embeddedAgentFabVisibility.js demo_api_ui/src/pages/__tests__/DelegationChainValuePage.test.jsx demo_api_ui/src/utils/__tests__/embeddedAgentFabVisibility.test.js
git commit -m "feat: add dedicated delegation-chain-value page"
```

---

### Task 8: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Full BFF suite**

Run: `cd demo_api_server && CI=true npm test -- --forceExit`
Expected: PASS (paste the result line)

- [ ] **Step 2: Full UI suite + build**

Run: `cd demo_api_ui && npm run test:unit && npm run build`
Expected: PASS, build succeeds

- [ ] **Step 3: Topology verify (main checkout only per demo_api_server/CLAUDE.md — the pre-commit gate silently skips in a worktree)**

Note for the user: run `npm run topology:verify` in the main checkout before merging, not in this worktree.

- [ ] **Step 4: Manual smoke test**

Start the stack (or confirm it's already running), sign in on `local.ping-devops.com:4000`, switch to Super Sports, navigate to `/delegation-chain-value`, click Run on both scenarios, confirm:
- Accountability run shows a reply and the floating token chain panel shows the full `a2a-exchange1`/`a2a-exchange2` chain.
- Authorization run shows the same chain plus the new `a2a-mismatch-probe` event, and that event's decision is DENY.

- [ ] **Step 5: Report status**

State ✅ or ❌ per root CLAUDE.md "Before claiming done" — tests/build green (paste evidence), every changed line traces to the spec, staged explicitly on the worktree branch, emoji allowlist respected.
