# OAuth Teaching P4 (DEMONSTRATE) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three real `demonstrate_*` tools to the `oauth-teaching` vertical that drive the genuine banking pipeline so learners see real RFC 8693 token exchange, real least-privilege scope denial, and real human-in-the-loop consent.

**Architecture:** Each `demonstrate_*` tool is a local tool (`isLocalTool` true) — the outer action skips the authz pre-flight — but its body calls an existing banking MCP tool through `executeBffTool` (RFC 8693 → gateway → authorize → MCP → backend). `demonstrate_hitl` additionally translates the pipeline's `mcp_hitl_required` 428 into the UI's `hitl_required`/`hitlChallengeId` shape, and the shared local-bypass branch is extended to forward that HITL envelope and thread the approved challenge id back on retry.

**Tech Stack:** Node.js (demo_api_server), CommonJS, Jest 29.7.0. No new dependencies. No UI changes.

## Global Constraints

- Work only in the worktree `/Users/curtismuir/Development/AI-Demo/.claude/worktrees/loose-ends-tokenchain-hitl` on branch `worktree-loose-ends-tokenchain-hitl`. Verify `git branch --show-current` before every commit. Stage files explicitly (`git add <files>`), never `git add -A`.
- No emojis in source/comments (REGRESSION_PLAN §0). The existing dispatch envelope uses a `❌` prefix in reply *strings* — match the surrounding code only where it already does so; do not introduce new emojis elsewhere.
- Run server unit tests from the worktree with the worktree-exclusion override: `cd demo_api_server && npx jest --testPathIgnorePatterns=/node_modules/ --testPathPattern '<substr>' --forceExit`.
- `node_modules` for `demo_api_server` is symlinked from the main checkout; if absent, recreate the symlink (see handoff).
- The transfer amount is a hardcoded `$300` constant (≥ confirm `$250`, < step-up `$500`) — never read the amount from tool params.
- Run `/simplify` before each code commit (a hook enforces this).
- Spec: `docs/superpowers/specs/2026-06-19-oauth-teaching-p4-design.md`. Plugin file: `demo_api_server/config/verticals/oauth-teaching/index.js`.

---

## File Structure

- **Modify** `demo_api_server/config/verticals/oauth-teaching/index.js` — add `executeBffTool` require, the `DEMO_TRANSFER_AMOUNT` / `SCOPE_DENIAL_TOOL` constants, the `runBankingTool` helper, three `demonstrate*` functions, register the three tool names (+ `demonstrate` alias) in `LOCAL_TOOLS` / `TOOLS` / `HEURISTICS`, and route them in `executeTool`.
- **Modify** `demo_api_server/services/demoAgentLangGraphService.js` — the local-bypass branch (lines ~733-764): pass `hitlChallengeId` into the `ctx` given to `executeTool`, and emit the proven vertical-HITL envelope when the tool returns `result.error === 'hitl_required'`. REGRESSION-tracked.
- **Create** `demo_api_server/src/__tests__/oauth-teaching-demonstrate.test.js` — unit tests for the three tools (mock `executeBffTool`).
- **Create** `demo_api_server/src/__tests__/oauth-teaching-dispatch-hitl.test.js` — unit test for the dispatch local-bypass HITL extension (mock `verticalDispatch.resolvePlugin`).
- **Create** `demo_api_server/tests/real/shared/oauth-teaching-demonstrate.real.test.js` — gated real-call suite.
- **Modify** `CHANGELOG.md` and `REGRESSION_LOG.md` — one line each.

---

## Task 1: Register the three demonstrate tools + shared helper + sign-in guards

**Files:**
- Modify: `demo_api_server/config/verticals/oauth-teaching/index.js`
- Test: `demo_api_server/src/__tests__/oauth-teaching-demonstrate.test.js` (create)

**Interfaces:**
- Consumes: `executeBffTool({ name, args, userId, userToken, req, tokenEvents, sessionId })` from `demo_api_server/services/bffMcpToolExecutor.js` (returns a JSON string).
- Produces (used by later tasks): `runBankingTool(ctx, name, args) -> Promise<object>` (parses the JSON string; returns `{ error, ... }` shapes verbatim). Three async functions `demonstrateTokenExchange(params, ctx)`, `demonstrateScopeDenial(params, ctx)`, `demonstrateHitl(params, ctx)`, each returning `{ result: { text, ... }, render: 'text' }`. Constants `DEMO_TRANSFER_AMOUNT = 300`, `SCOPE_DENIAL_TOOL = 'get_investment_balance'`. Tool names: `demonstrate_token_exchange`, `demonstrate_scope_denial`, `demonstrate_hitl` (+ alias `demonstrate` → token exchange).

- [ ] **Step 1: Write the failing test**

Create `demo_api_server/src/__tests__/oauth-teaching-demonstrate.test.js`:

```js
'use strict';

jest.mock('../../services/bffMcpToolExecutor', () => ({ executeBffTool: jest.fn() }));
const { executeBffTool } = require('../../services/bffMcpToolExecutor');
const plugin = require('../../config/verticals/oauth-teaching');

beforeEach(() => executeBffTool.mockReset());

describe('oauth-teaching P4 — registration', () => {
  it('marks the three demonstrate tools (and the demonstrate alias) as local', () => {
    ['demonstrate_token_exchange', 'demonstrate_scope_denial', 'demonstrate_hitl', 'demonstrate']
      .forEach((n) => expect(plugin.isLocalTool(n)).toBe(true));
  });

  it('advertises the three tools with an inputSchema', () => {
    const names = plugin.getTools().map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(
      ['demonstrate_token_exchange', 'demonstrate_scope_denial', 'demonstrate_hitl']));
    plugin.getTools()
      .filter((t) => t.name.startsWith('demonstrate_'))
      .forEach((t) => expect(t.inputSchema).toBeDefined());
  });

  it('routes demonstrate phrases to the right tool', () => {
    const hs = plugin.getHeuristics();
    const route = (msg) => { const h = hs.find((x) => x.re.test(msg)); return h && h.action; };
    expect(route('demonstrate a real token exchange')).toBe('demonstrate_token_exchange');
    expect(route('demonstrate a scope denial')).toBe('demonstrate_scope_denial');
    expect(route('demonstrate hitl with a real transfer')).toBe('demonstrate_hitl');
  });
});

describe('oauth-teaching P4 — not signed in', () => {
  it.each([
    ['demonstrate_token_exchange'],
    ['demonstrate_scope_denial'],
    ['demonstrate_hitl'],
  ])('%s returns a sign-in prompt and never calls the pipeline', async (tool) => {
    const out = await plugin.executeTool(tool, {}, { userToken: null });
    expect(out.render).toBe('text');
    expect(out.result.text).toMatch(/sign\s*in/i);
    expect(executeBffTool).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd demo_api_server && npx jest --testPathIgnorePatterns=/node_modules/ --testPathPattern oauth-teaching-demonstrate --forceExit`
Expected: FAIL — `isLocalTool('demonstrate_token_exchange')` is false / tools missing / heuristics don't match.

- [ ] **Step 3: Implement registration, helper, and sign-in guards**

In `demo_api_server/config/verticals/oauth-teaching/index.js`:

Add the require near the top (after the existing requires):

```js
const { executeBffTool } = require('../../../services/bffMcpToolExecutor');
```

Add constants near the other module constants (after `LOCAL_TOOLS`):

```js
// P4 DEMONSTRATE — real-pipeline teaching tools.
// $300 sits in the plain-consent HITL band on the MCP authz path (>= confirm $250, < step-up $500).
const DEMO_TRANSFER_AMOUNT = 300;
// A regular demo user's token does not carry invest:read, so this tool reliably denies.
const SCOPE_DENIAL_TOOL = 'get_investment_balance';
```

Extend `LOCAL_TOOLS` to include the new names and the legacy alias:

```js
const LOCAL_TOOLS = new Set([
  'explain_concept', 'open_education_panel', 'show_flow_diagram', 'inspect_token',
  'demonstrate_token_exchange', 'demonstrate_scope_denial', 'demonstrate_hitl', 'demonstrate',
]);
```

Add the three tool schemas to the `TOOLS` array:

```js
  { name: 'demonstrate_token_exchange', description: 'Run a real RFC 8693 token exchange against the banking pipeline and narrate every hop',
    inputSchema: { type: 'object', properties: {}, required: [] } },
  { name: 'demonstrate_scope_denial', description: 'Attempt a banking call the delegated token is not scoped for and show the real denial',
    inputSchema: { type: 'object', properties: {}, required: [] } },
  { name: 'demonstrate_hitl', description: 'Run a real over-threshold transfer to trigger human-in-the-loop approval',
    inputSchema: { type: 'object', properties: {}, required: [] } },
```

Prepend three heuristics to the `HEURISTICS` array (before the existing entries so they take precedence):

```js
const HEURISTICS = [
  { re: /\bdemo(nstrate)?\b.*\b(hitl|human|approval|consent|transfer)\b/i, action: 'demonstrate_hitl' },
  { re: /\bdemo(nstrate)?\b.*\b(deny|denial|denied|scope|least.?privilege|forbidden|insufficient)\b/i, action: 'demonstrate_scope_denial' },
  { re: /\bdemo(nstrate)?\b.*\b(exchange|rfc\s*8693|real\s+token|token\s+exchange)\b/i, action: 'demonstrate_token_exchange' },
  // --- existing entries below ---
  { re: /\b(inspect|decode|show\s+me|view)\b.*\btoken(s)?\b/i, action: 'inspect_token' },
  { re: /\b(show|draw|diagram|visuali[sz]e)\b.*\b(flow|auth(orization)?\s*code|pkce|exchange|chain)\b/i, action: 'show_flow_diagram' },
  { re: /\b(what\s+is|explain|how\s+does|tell\s+me\s+about)\b/i, action: 'explain_concept' },
];
```

Add the shared helper and the three functions (with only the sign-in guard for now) above `executeTool`:

```js
// Run a banking tool through the REAL pipeline and return the parsed result object.
// executeBffTool returns a JSON string; errors are encoded in-band as { error, ... }.
async function runBankingTool(ctx, name, args) {
  const raw = await executeBffTool({
    name,
    args: args || {},
    userId: ctx.userId,
    userToken: ctx.userToken,
    req: ctx.req,
    tokenEvents: ctx.tokenEvents,
    sessionId: ctx.sessionId,
  });
  try { return typeof raw === 'string' ? JSON.parse(raw) : raw; }
  catch (_) { return { error: 'unparseable_result' }; }
}

async function demonstrateTokenExchange(params, ctx) {
  if (!ctx || !ctx.userToken) {
    return { result: { text: 'Please sign in first — then I can run a real token exchange and show every hop.' }, render: 'text' };
  }
  return { result: { text: '' }, render: 'text' }; // Task 2
}

async function demonstrateScopeDenial(params, ctx) {
  if (!ctx || !ctx.userToken) {
    return { result: { text: 'Please sign in first — then I can attempt a call your token is not scoped for and show the real denial.' }, render: 'text' };
  }
  return { result: { text: '' }, render: 'text' }; // Task 3
}

async function demonstrateHitl(params, ctx) {
  if (!ctx || !ctx.userToken) {
    return { result: { text: 'Please sign in first — then I can run a real over-threshold transfer and trigger human-in-the-loop approval.' }, render: 'text' };
  }
  return { result: { text: '' }, render: 'text' }; // Task 4
}
```

Add the routing cases to `executeTool`'s switch (before `default`):

```js
    case 'demonstrate_token_exchange':
    case 'demonstrate':
      return demonstrateTokenExchange(params, ctx);
    case 'demonstrate_scope_denial': return demonstrateScopeDenial(params, ctx);
    case 'demonstrate_hitl': return demonstrateHitl(params, ctx);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd demo_api_server && npx jest --testPathIgnorePatterns=/node_modules/ --testPathPattern oauth-teaching-demonstrate --forceExit`
Expected: PASS (registration + not-signed-in describe blocks). The later signed-in tests do not exist yet.

- [ ] **Step 5: Run `/simplify`, then commit**

```bash
git add demo_api_server/config/verticals/oauth-teaching/index.js demo_api_server/src/__tests__/oauth-teaching-demonstrate.test.js
git commit -m "feat(oauth-teaching): register P4 demonstrate tools + sign-in guards"
```

---

## Task 2: `demonstrate_token_exchange` — real exchange + narration

**Files:**
- Modify: `demo_api_server/config/verticals/oauth-teaching/index.js` (`demonstrateTokenExchange` body)
- Test: `demo_api_server/src/__tests__/oauth-teaching-demonstrate.test.js` (append)

**Interfaces:**
- Consumes: `runBankingTool(ctx, 'get_my_accounts', {})` (Task 1).
- Produces: narration `{ result: { text }, render: 'text' }`; pushes real exchange events onto `ctx.tokenEvents` (via `executeBffTool`).

- [ ] **Step 1: Write the failing test** — append to the test file:

```js
describe('demonstrate_token_exchange — signed in', () => {
  it('calls get_my_accounts, narrates the exchange, and preserves token events', async () => {
    executeBffTool.mockImplementation(async ({ name, tokenEvents }) => {
      expect(name).toBe('get_my_accounts');
      tokenEvents.push({ id: 'user-token', label: 'T1' });
      tokenEvents.push({ id: 'mcp-exchange', label: 'T2' });
      return JSON.stringify({ accounts: [{ id: 'a1' }, { id: 'a2' }] });
    });
    const tokenEvents = [];
    const out = await plugin.executeTool('demonstrate_token_exchange', {},
      { userToken: 't1', userId: 'u1', req: {}, tokenEvents, sessionId: 's1' });
    expect(out.render).toBe('text');
    expect(out.result.text).toMatch(/RFC 8693/);
    expect(executeBffTool).toHaveBeenCalledTimes(1);
    expect(tokenEvents).toHaveLength(2);
  });

  it('surfaces an error honestly when the exchange fails', async () => {
    executeBffTool.mockResolvedValue(JSON.stringify({ error: 'mcp_error', message: 'boom' }));
    const out = await plugin.executeTool('demonstrate_token_exchange', {},
      { userToken: 't1', userId: 'u1', req: {}, tokenEvents: [], sessionId: 's1' });
    expect(out.result.text).toMatch(/error/i);
    expect(out.result.text).toMatch(/mcp_error/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd demo_api_server && npx jest --testPathIgnorePatterns=/node_modules/ --testPathPattern oauth-teaching-demonstrate --forceExit`
Expected: FAIL — `out.result.text` is empty, no `RFC 8693`.

- [ ] **Step 3: Implement the body** — replace the `// Task 2` line:

```js
  const res = await runBankingTool(ctx, 'get_my_accounts', {});
  if (res && res.error) {
    return { result: { text: `The exchange path returned an error (${res.error}). The Token Chain shows how far the request got.` }, render: 'text' };
  }
  return { result: { text: 'Done — I called the real banking tool get_my_accounts as the agent. That drove a genuine RFC 8693 exchange: your session token (T1, audience enduser) was swapped for a downstream-scoped agent token (T2, narrowed audience plus an act claim recording the agent), which the resource server accepted. Open the Token Chain to see each hop.' }, render: 'text' };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd demo_api_server && npx jest --testPathIgnorePatterns=/node_modules/ --testPathPattern oauth-teaching-demonstrate --forceExit`
Expected: PASS.

- [ ] **Step 5: Run `/simplify`, then commit**

```bash
git add demo_api_server/config/verticals/oauth-teaching/index.js demo_api_server/src/__tests__/oauth-teaching-demonstrate.test.js
git commit -m "feat(oauth-teaching): demonstrate_token_exchange runs a real RFC 8693 exchange"
```

---

## Task 3: `demonstrate_scope_denial` — real least-privilege denial

**Files:**
- Modify: `demo_api_server/config/verticals/oauth-teaching/index.js` (`demonstrateScopeDenial` body)
- Test: `demo_api_server/src/__tests__/oauth-teaching-demonstrate.test.js` (append)

**Interfaces:**
- Consumes: `runBankingTool(ctx, SCOPE_DENIAL_TOOL, {})` (Task 1), `SCOPE_DENIAL_TOOL = 'get_investment_balance'`.
- Produces: narration `{ result: { text }, render: 'text' }` — denial narration when the call is refused; an honest "was permitted" message otherwise.

- [ ] **Step 1: Write the failing test** — append:

```js
describe('demonstrate_scope_denial — signed in', () => {
  it('narrates the real denial and the missing scope', async () => {
    executeBffTool.mockImplementation(async ({ name }) => {
      expect(name).toBe('get_investment_balance');
      return JSON.stringify({ error: 'insufficient_scope', required_scopes: ['invest:read'] });
    });
    const out = await plugin.executeTool('demonstrate_scope_denial', {},
      { userToken: 't1', userId: 'u1', req: {}, tokenEvents: [], sessionId: 's1' });
    expect(out.result.text).toMatch(/denied/i);
    expect(out.result.text).toMatch(/invest:read/);
  });

  it('is honest when the call is unexpectedly permitted (no fake denial)', async () => {
    executeBffTool.mockResolvedValue(JSON.stringify({ balance: 1000 }));
    const out = await plugin.executeTool('demonstrate_scope_denial', {},
      { userToken: 't1', userId: 'u1', req: {}, tokenEvents: [], sessionId: 's1' });
    expect(out.result.text).toMatch(/permitted|already carries/i);
    expect(out.result.text).not.toMatch(/denied/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd demo_api_server && npx jest --testPathIgnorePatterns=/node_modules/ --testPathPattern oauth-teaching-demonstrate --forceExit`
Expected: FAIL — empty narration.

- [ ] **Step 3: Implement the body** — replace the `// Task 3` line:

```js
  const res = await runBankingTool(ctx, SCOPE_DENIAL_TOOL, {});
  if (res && res.error) {
    const missing = Array.isArray(res.required_scopes) ? res.required_scopes.join(', ')
      : (Array.isArray(res.missingScopes) ? res.missingScopes.join(', ') : 'invest:read');
    return { result: { text: `Denied — exactly as least privilege intends. I called ${SCOPE_DENIAL_TOOL} as the agent, but the exchanged token does not carry the required scope (${missing}). The resource server refused with "${res.error}". The agent only ever receives the scopes your delegation grants, narrowed by the RFC 8693 exchange.` }, render: 'text' };
  }
  return { result: { text: `Unexpected — ${SCOPE_DENIAL_TOOL} was permitted, which means your token already carries the required scope. There is no denial to show this time; sign in as a user without investment access to see least privilege block the call.` }, render: 'text' };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd demo_api_server && npx jest --testPathIgnorePatterns=/node_modules/ --testPathPattern oauth-teaching-demonstrate --forceExit`
Expected: PASS.

- [ ] **Step 5: Run `/simplify`, then commit**

```bash
git add demo_api_server/config/verticals/oauth-teaching/index.js demo_api_server/src/__tests__/oauth-teaching-demonstrate.test.js
git commit -m "feat(oauth-teaching): demonstrate_scope_denial shows a real least-privilege denial"
```

---

## Task 4: `demonstrate_hitl` — real over-threshold transfer + challenge translation + retry

**Files:**
- Modify: `demo_api_server/config/verticals/oauth-teaching/index.js` (`demonstrateHitl` body)
- Test: `demo_api_server/src/__tests__/oauth-teaching-demonstrate.test.js` (append)

**Interfaces:**
- Consumes: `runBankingTool(ctx, 'get_my_accounts', {})` then `runBankingTool(ctx, 'create_transfer', args)` (Task 1); `DEMO_TRANSFER_AMOUNT = 300`.
- Produces: on the first pass, `{ result: { text, error:'hitl_required', hitl:{type:'consent'}, hitlChallengeId }, render:'text' }`. The `error:'hitl_required'` + `hitlChallengeId` are read by the dispatch extension (Task 5). On the retry (`ctx.hitlChallengeId` present), passes `_hitl_challenge_id` in the `create_transfer` args and narrates the executed transfer.

- [ ] **Step 1: Write the failing test** — append:

```js
describe('demonstrate_hitl — signed in', () => {
  // get_my_accounts succeeds; create_transfer returns the pipeline 428 body.
  function mockAccountsThenTransfer(transferResult) {
    executeBffTool.mockImplementation(async ({ name, args }) => {
      if (name === 'get_my_accounts') return JSON.stringify({ accounts: [{ id: 'a1' }, { id: 'a2' }] });
      if (name === 'create_transfer') { mockAccountsThenTransfer.lastArgs = args; return JSON.stringify(transferResult); }
      throw new Error(`unexpected tool ${name}`);
    });
  }

  it('translates the pipeline 428 into the UI hitl_required + hitlChallengeId shape', async () => {
    mockAccountsThenTransfer({ error: 'mcp_hitl_required', challengeId: 'chal-9', taskId: 'chal-9' });
    const out = await plugin.executeTool('demonstrate_hitl', {},
      { userToken: 't1', userId: 'u1', req: {}, tokenEvents: [], sessionId: 's1' });
    expect(out.result.error).toBe('hitl_required');
    expect(out.result.hitlChallengeId).toBe('chal-9');
    expect(out.result.hitl).toEqual({ type: 'consent' });
    expect(out.result.text).toMatch(/300/);
    // amount comes from the constant, not params
    expect(mockAccountsThenTransfer.lastArgs.amount).toBe(300);
    expect(mockAccountsThenTransfer.lastArgs.from_account_id).toBe('a1');
    expect(mockAccountsThenTransfer.lastArgs.to_account_id).toBe('a2');
    expect(mockAccountsThenTransfer.lastArgs._hitl_challenge_id).toBeUndefined();
  });

  it('echoes _hitl_challenge_id on the approve-retry and narrates the executed transfer', async () => {
    mockAccountsThenTransfer({ ok: true, transactionId: 'tx-1' });
    const out = await plugin.executeTool('demonstrate_hitl', {},
      { userToken: 't1', userId: 'u1', req: {}, tokenEvents: [], sessionId: 's1', hitlChallengeId: 'chal-9' });
    expect(mockAccountsThenTransfer.lastArgs._hitl_challenge_id).toBe('chal-9');
    expect(out.result.error).toBeUndefined();
    expect(out.result.text).toMatch(/executed|went through|moved/i);
  });

  it('returns an honest message when fewer than two accounts exist', async () => {
    executeBffTool.mockResolvedValue(JSON.stringify({ accounts: [{ id: 'a1' }] }));
    const out = await plugin.executeTool('demonstrate_hitl', {},
      { userToken: 't1', userId: 'u1', req: {}, tokenEvents: [], sessionId: 's1' });
    expect(out.result.text).toMatch(/two of your accounts/i);
    expect(out.result.error).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd demo_api_server && npx jest --testPathIgnorePatterns=/node_modules/ --testPathPattern oauth-teaching-demonstrate --forceExit`
Expected: FAIL — body returns empty text, no `error` field.

- [ ] **Step 3: Implement the body** — replace the `// Task 4` line:

```js
  const acctRes = await runBankingTool(ctx, 'get_my_accounts', {});
  const accounts = (acctRes && (acctRes.accounts || (acctRes.result && acctRes.result.accounts))) || [];
  if (!Array.isArray(accounts) || accounts.length < 2) {
    return { result: { text: 'I could not find two of your accounts to move money between. Reload your dashboard so your demo accounts are seeded, then ask again.' }, render: 'text' };
  }
  const args = {
    from_account_id: accounts[0].id,
    to_account_id: accounts[1].id,
    amount: DEMO_TRANSFER_AMOUNT,
    description: 'OAuth Academy HITL demo',
  };
  // On the approve-retry the dispatch passes the approved challenge id in ctx; echo it
  // so the gateway/pipeline verifies the receipt and PERMITs instead of re-challenging.
  if (ctx.hitlChallengeId) args._hitl_challenge_id = ctx.hitlChallengeId;
  const res = await runBankingTool(ctx, 'create_transfer', args);
  if (res && res.error === 'mcp_hitl_required') {
    return { result: {
      text: `This $${DEMO_TRANSFER_AMOUNT} transfer is over the consent threshold, so PingOne Authorize returned a human-in-the-loop challenge before any money moved. Approve it and I will retry — your approval becomes a receipt the policy verifies (receipt-aware PERMIT).`,
      error: 'hitl_required',
      hitl: { type: 'consent' },
      hitlChallengeId: res.challengeId || res.taskId || null,
    }, render: 'text' };
  }
  if (res && res.error) {
    return { result: { text: `The transfer could not be completed (${res.error}).` }, render: 'text' };
  }
  return { result: { text: `Approved and executed — the $${DEMO_TRANSFER_AMOUNT} transfer went through. The policy verified your approval receipt and PERMITted the retry, so the money actually moved between your own demo accounts. Reset them any time from the dashboard.` }, render: 'text' };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd demo_api_server && npx jest --testPathIgnorePatterns=/node_modules/ --testPathPattern oauth-teaching-demonstrate --forceExit`
Expected: PASS (all demonstrate-tool describe blocks).

- [ ] **Step 5: Run `/simplify`, then commit**

```bash
git add demo_api_server/config/verticals/oauth-teaching/index.js demo_api_server/src/__tests__/oauth-teaching-demonstrate.test.js
git commit -m "feat(oauth-teaching): demonstrate_hitl drives a real over-threshold transfer + consent"
```

---

## Task 5: Extend the local-bypass branch to forward the HITL challenge

**Files:**
- Modify: `demo_api_server/services/demoAgentLangGraphService.js` (local-bypass branch, ~lines 733-764)
- Test: `demo_api_server/src/__tests__/oauth-teaching-dispatch-hitl.test.js` (create)

**Interfaces:**
- Consumes: a plugin whose `executeTool` returns `{ result: { text, error:'hitl_required', hitl, hitlChallengeId }, render:'text' }` (Task 4).
- Produces: the dispatch envelope `{ error:'hitl_required', hitl, reply, success:false, action, requiresConsent:true, hitlChallengeId, toolsCalled, tokensUsed:0, agentConfigured:true, tokenEvents }` (matches the proven vertical-HITL shape at lines 927-939) — consumed by the UI `kind:'vertical'` consent handler. Also passes `hitlChallengeId` into the `ctx` given to `executeTool`.

- [ ] **Step 1: Write the failing test**

Create `demo_api_server/src/__tests__/oauth-teaching-dispatch-hitl.test.js`:

```js
'use strict';

jest.mock('../../services/verticalDispatch', () => ({ resolvePlugin: jest.fn() }));
const verticalDispatch = require('../../services/verticalDispatch');
const { __test } = require('../../services/demoAgentLangGraphService');

describe('dispatchVerticalIntent — local-bypass HITL forwarding', () => {
  it('forwards a HITL envelope and threads hitlChallengeId into ctx', async () => {
    const executeTool = jest.fn().mockResolvedValue({
      result: { text: 'approve please', error: 'hitl_required', hitl: { type: 'consent' }, hitlChallengeId: 'chal-1' },
      render: 'text',
    });
    verticalDispatch.resolvePlugin.mockReturnValue({ isLocalTool: () => true, executeTool });

    const out = await __test.dispatchVerticalIntent(
      { vertical: 'oauth-teaching', action: 'demonstrate_hitl', params: {} },
      { userId: 'u1', userToken: 't1', req: {}, tokenEvents: [], sessionId: 's1', hitlChallengeId: 'chal-1' },
    );

    expect(out.error).toBe('hitl_required');
    expect(out.requiresConsent).toBe(true);
    expect(out.hitlChallengeId).toBe('chal-1');
    expect(out.action).toBe('demonstrate_hitl');
    expect(out.reply).toBe('approve please');
    // ctx given to the tool carries hitlChallengeId for the retry echo
    expect(executeTool).toHaveBeenCalledWith('demonstrate_hitl', {}, expect.objectContaining({ hitlChallengeId: 'chal-1' }));
  });

  it('a normal (non-HITL) local result is unaffected', async () => {
    const executeTool = jest.fn().mockResolvedValue({ result: { text: 'hello' }, render: 'text' });
    verticalDispatch.resolvePlugin.mockReturnValue({ isLocalTool: () => true, executeTool });

    const out = await __test.dispatchVerticalIntent(
      { vertical: 'oauth-teaching', action: 'demonstrate_token_exchange', params: {} },
      { userId: 'u1', userToken: 't1', req: {}, tokenEvents: [], sessionId: 's1' },
    );
    expect(out.error).toBeUndefined();
    expect(out.success).toBe(true);
    expect(out.reply).toBe('hello');
    expect(out.requiresConsent).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd demo_api_server && npx jest --testPathIgnorePatterns=/node_modules/ --testPathPattern oauth-teaching-dispatch-hitl --forceExit`
Expected: FAIL — the first test fails because the current branch hardcodes `requiresConsent:false` and treats `data.error` as a generic error (`reply` becomes `❌ hitl_required`), and `ctx` lacks `hitlChallengeId`.

(If `require` of the service throws on load, add `jest.mock` for the offending module and re-run; none expected because deps are used at call time, not import time.)

- [ ] **Step 3: Implement the extension**

In `demo_api_server/services/demoAgentLangGraphService.js`, in the local-bypass branch:

(a) Pass `hitlChallengeId` into the tool ctx — change the `executeTool` call:

```js
      local = await plugin.executeTool(action, params || {}, { userId, userToken, req, tokenEvents, sessionId, isAdmin, hitlChallengeId });
```

(b) Insert the HITL-forwarding return immediately after `const render = local?.render || 'text';` and **before** the `const isErr = ...` line:

```js
    // A demonstrate tool may surface a real HITL challenge from the inner pipeline.
    // Forward it in the same envelope the MCP vertical-HITL path uses (lines ~927-939)
    // so the UI consent handler opens AgentConsentModal and the approve-retry threads
    // the challenge id back through ctx.hitlChallengeId.
    if (data && data.error === 'hitl_required') {
      return {
        error: 'hitl_required',
        hitl: data.hitl || { type: 'consent' },
        reply: (typeof data.text === 'string' && data.text) || 'This action requires your approval.',
        success: false,
        action,
        requiresConsent: true,
        hitlChallengeId: data.hitlChallengeId || null,
        toolsCalled: [action],
        tokensUsed: 0,
        agentConfigured: true,
        tokenEvents,
      };
    }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd demo_api_server && npx jest --testPathIgnorePatterns=/node_modules/ --testPathPattern oauth-teaching-dispatch-hitl --forceExit`
Expected: PASS (both tests).

- [ ] **Step 5: Guard against regression — run the existing dispatch/oauth-teaching unit tests**

Run: `cd demo_api_server && npx jest --testPathIgnorePatterns=/node_modules/ --testPathPattern 'oauthTeachingTools|oauth-teaching' --forceExit`
Expected: PASS — the existing P2/P3 tests (`oauthTeachingTools.test.js`) and the new P4 tests all pass (the new branch only fires for `error:'hitl_required'`, so education/text tools are unaffected).

- [ ] **Step 6: Run `/simplify`, then commit**

```bash
git add demo_api_server/services/demoAgentLangGraphService.js demo_api_server/src/__tests__/oauth-teaching-dispatch-hitl.test.js
git commit -m "feat(oauth-teaching): local-bypass forwards demonstrate_hitl consent challenge"
```

---

## Task 6: Gated real-call suite + CHANGELOG/REGRESSION_LOG

**Files:**
- Create: `demo_api_server/tests/real/shared/oauth-teaching-demonstrate.real.test.js`
- Modify: `CHANGELOG.md`, `REGRESSION_LOG.md`

**Interfaces:**
- Consumes the EXACT helpers the P2/P3 real suite uses (verified in `tests/real/shared/oauth-teaching-pipeline.test.js`): `require('../helpers/bffClient')` → `createBffClient('enduser')` (synchronous; throws if no session), `setVertical(client, id)`, `restoreVertical(client)`. The invoke route is `POST /api/agent/invoke` with body `{ prompt, forceHeuristic: true }`. Skip guard: `try { enduser = createBffClient('enduser'); } catch { return; }` in `beforeAll`, then `if (!enduser) return;` at the top of each test.

- [ ] **Step 1: Write the gated real suite**

Create `demo_api_server/tests/real/shared/oauth-teaching-demonstrate.real.test.js`:

```js
// demo_api_server/tests/real/shared/oauth-teaching-demonstrate.real.test.js
// Gated real suite for OAuth Teaching P4 (DEMONSTRATE). Self-skips without a live
// enduser session (createBffClient throws → enduser stays undefined → each test returns).
const { createBffClient, setVertical, restoreVertical } = require('../helpers/bffClient');

describe('OAuth Teaching P4 DEMONSTRATE (oauth-teaching vertical)', () => {
  let enduser;
  beforeAll(async () => {
    try { enduser = createBffClient('enduser'); } catch { return; }
    await setVertical(enduser, 'oauth-teaching');
  });
  afterAll(async () => { if (enduser) await restoreVertical(enduser); });

  const ask = (prompt) =>
    enduser.post('/api/agent/invoke', { prompt, forceHeuristic: true }).then((r) => r.data);

  it('demonstrate_token_exchange records real token-chain events', async () => {
    if (!enduser) return;
    const data = await ask('demonstrate a real token exchange');
    expect(Array.isArray(data.tokenEvents)).toBe(true);
    expect(data.tokenEvents.length).toBeGreaterThan(0);
    expect(String(data.reply)).toMatch(/RFC 8693/);
  });

  it('demonstrate_scope_denial returns a real denial (or honest permitted)', async () => {
    if (!enduser) return;
    const data = await ask('demonstrate a scope denial');
    expect(String(data.reply)).toMatch(/denied|permitted/i);
  });

  it('demonstrate_hitl returns a real consent challenge and does not auto-execute', async () => {
    if (!enduser) return;
    const data = await ask('demonstrate hitl with a real transfer');
    expect(data.error).toBe('hitl_required');
    expect(data.hitlChallengeId).toBeTruthy();
    // No raw JWT leaks anywhere in the response (matches the P2/P3 leakage assertion).
    expect(JSON.stringify(data)).not.toMatch(/ey[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/);
  });
});
```

- [ ] **Step 3: Gate-verify the new file compiles**

Run: `node --check demo_api_server/tests/real/shared/oauth-teaching-demonstrate.real.test.js`
Expected: no output (syntax OK). This is the gating verification for a real-test file (per the handoff).

- [ ] **Step 4: Run the suite (will self-skip without a live session)**

Run: `cd demo_api_server && npx jest --testPathIgnorePatterns=/node_modules/ --testPathPattern oauth-teaching-demonstrate.real --forceExit`
Expected: PASS or SKIPPED (skipped when no live session — that is acceptable; the `node --check` in Step 3 is the real gate).

- [ ] **Step 5: Update CHANGELOG and REGRESSION_LOG**

In `CHANGELOG.md`, add one line under `[Unreleased] → Added`:

```
- OAuth Teaching P4 (DEMONSTRATE): demonstrate_token_exchange / demonstrate_scope_denial / demonstrate_hitl run the real banking pipeline (RFC 8693 exchange, least-privilege denial, HITL consent) from the oauth-teaching vertical.
```

In `REGRESSION_LOG.md`, add one line noting the shared-dispatch change:

```
- demoAgentLangGraphService.dispatchVerticalIntent local-bypass branch now (a) threads hitlChallengeId into the tool ctx and (b) forwards a hitl_required envelope when a local tool returns one. Additive; fires only for result.error === 'hitl_required'; existing text/education local tools unaffected (covered by oauthTeachingTools.test.js + oauth-teaching-dispatch-hitl.test.js).
```

- [ ] **Step 6: Final full oauth-teaching unit run, then commit**

Run: `cd demo_api_server && npx jest --testPathIgnorePatterns=/node_modules/ --testPathPattern 'oauth-teaching|oauthTeachingTools' --forceExit`
Expected: PASS.

```bash
git add demo_api_server/tests/real/shared/oauth-teaching-demonstrate.real.test.js CHANGELOG.md REGRESSION_LOG.md
git commit -m "test(oauth-teaching): gated real suite for P4 demonstrate tools + changelog"
```

---

## Final verification (whole branch)

- [ ] Run all new + existing oauth-teaching unit tests: `cd demo_api_server && npx jest --testPathIgnorePatterns=/node_modules/ --testPathPattern 'oauth-teaching|oauthTeachingTools' --forceExit` — all PASS.
- [ ] `node --check` passes on the real suite file.
- [ ] `git branch --show-current` is `worktree-loose-ends-tokenchain-hitl` and all commits are present.
- [ ] Manual (optional, requires live stack): sign in, switch to OAuth Academy, send "demonstrate hitl with a real transfer" → consent modal opens → approve → transfer executes → Token Chain shows the hops.

---

## Spec coverage self-check

- Architecture (3 local tools calling banking tools via `executeBffTool`): Tasks 1-4. ✓
- `executeBffTool` returns a JSON string parsed in-band: `runBankingTool` (Task 1). ✓
- `ctx` carries everything `executeBffTool` needs: Task 1 helper. ✓
- Real banking accounts in oauth-teaching (banking seed fallback): relied on by `demonstrate_hitl` (Task 4) + real suite (Task 6). ✓
- HITL amount band ($300): `DEMO_TRANSFER_AMOUNT` (Task 1), asserted in Task 4. ✓
- 428 field translation (`mcp_hitl_required`/`challengeId` → `hitl_required`/`hitlChallengeId`): Task 4 + Task 5. ✓
- Scope-denial via `get_investment_balance` with honest "permitted" fallback: Task 3. ✓
- Safety (own accounts, fixed amount not from params, honest failure, sign-in guard, no raw tokens): Tasks 1, 3, 4. ✓
- Testing (unit mock + gated real): Tasks 1-4 (unit), Task 6 (real). ✓
- Dispatch extension REGRESSION-tracked: Task 5 + Task 6 (REGRESSION_LOG). ✓
- Out of scope honored (no `api_key_demo`/`dual_token_demo`, no AIAgent.js refactor, no SSE, no nlIntentParser change, no manifest render change): no task touches them. ✓
