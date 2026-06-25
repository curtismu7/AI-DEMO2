# BFF MCP Tool-Invocation Pipeline Extraction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the ~760-line `POST /api/mcp/tool` Express handler in `banking_api_server/server.js` into one pure orchestration module (`runMcpToolPipeline`) that returns a discriminated `Outcome`, leaving the route as a thin shell that only renders the outcome and owns SSE/flow-trace lifecycle.

**Architecture:** Strict zero-behavior-change extraction per [ADR-0004](../../adr/0004-bff-mcp-tool-invocation-pipeline-seam.md). The pipeline is pure (no Express, no direct `require` of collaborators — all injected as `deps`). The Authorize gate stays *inside* the pipeline (injected) so its "runs on every call before the remote call" ordering (ADR-0003/T-2, REGRESSION_PLAN §1 row 56) is test-assertable. All three local-fallback hatches and `callToolLocal` move inside. SSE `emit` is an injected sink so per-phase events stay live (not batched — token-visibility-intentional). Verified by characterization tests pinning all exit paths GREEN *before and after* the move, then a live chip gate.

**Tech Stack:** Node.js CommonJS, Express, Jest + supertest (`^7.2.2`), existing jest config at `banking_api_server/jest.config.js` (testMatch `**/src/__tests__/**/*.test.js`).

---

## Pre-flight (regression discipline — do before Task 1)

This path is REGRESSION_PLAN §1 row 56 (the sole authoritative BFF tool gate) and the
single most §4-incident-heavy path in the repo. Before any edit:

- [ ] **Step 0a: Read the regression contract.** Read `REGRESSION_PLAN.md` §0 (no emojis), §1 row 56 (MCP Authorize gate — sole authoritative BFF tool gate), and §4 entries mentioning `/api/mcp/tool` (single-resource scope, `isExchangeScopeError`). Read [ADR-0004](../../adr/0004-bff-mcp-tool-invocation-pipeline-seam.md), ADR-0003, ARCHITECTURE-TRUTHS T-2 and T-7.

- [ ] **Step 0b: State what you will NOT break.** In the implementation thread, write: "This is a pure extraction. I will not: (1) change any of the ~13 `res.*` status codes or bodies; (2) move the Authorize gate outside the pipeline or make it skippable; (3) batch SSE phase emission; (4) alter the `isExchangeScopeError` condition (`httpStatus===400 || code==='token_exchange_failed' || (401 && pingoneError)`); (5) alter the `oauthId || id` effective-user resolution; (6) reorder phases (token → no-bearer → authorize → introspection → remote)."

- [ ] **Step 0c: Confirm branch.** Run: `cd /Users/curtismuir/Development/banking && git branch --show-current`
  Expected: a feature branch (not `main`). If `main`, create one: `git checkout -b feat/mcp-tool-pipeline-extraction`.

- [ ] **Step 0d: Baseline the existing suite.** Run: `cd banking_api_server && npx jest mcpToolAuthorizationService r1LocalAuthzRemoval --silent 2>&1 | tail -5`
  Expected: existing tests PASS. Record the pass count — it must not drop later.

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `banking_api_server/services/mcpToolPipeline.js` | The pure orchestration module. Exports `runMcpToolPipeline(ctx)` returning an `Outcome`. Zero Express. All collaborators arrive via `ctx.deps`. Owns the 6 phases + 3 local-fallback hatches + tokenEvents mutation + injected `emit`. | Create |
| `banking_api_server/server.js:1230-1993` | The `POST /api/mcp/tool` route. After extraction: builds `ctx`, calls `runMcpToolPipeline`, renders the `Outcome` via one `renderOutcome` switch, owns `flowTrace` `finish`/`close` hooks and the HTTP/2 streaming branch. | Modify |
| `banking_api_server/src/__tests__/mcpToolPipeline.characterization.test.js` | Characterization tests pinning every `Outcome` kind/status for the ~13 exit paths, with all `deps` mocked. Written BEFORE extraction against the new module's intended interface; proves the move changed nothing. | Create |

### The `Outcome` contract (locked — used by every task)

```js
// Discriminated union returned by runMcpToolPipeline. The route NEVER inspects
// why a path was taken — it only renders by `kind`.
//   { kind: 'result', httpStatus: 200, body, tokenEvents, stream? }
//       body is the JSON to send. stream:true => route uses HTTP/2 chunked path.
//   { kind: 'block',  httpStatus, body, tokenEvents }
//       authz deny / 428 step-up / 403 scope / 403 missing_exchange_scopes / no-bearer gate
//   { kind: 'error',  httpStatus, body }
//       token_inactive(401), authz-internal(500), mcp_error(502), authz-unavailable(503)
// `body` is always the EXACT object the current code passes to res.json(...).
// tokenEvents is included on result/block (current behavior) — never on the pure
// `error` shapes that today omit it (preserve verbatim).
```

### The `ctx` shape (locked)

```js
// ctx = { tool, params, flowTraceId, startTime, req, deps }
// req is passed for session reads ONLY (req.session.user, req.correlationId,
//   req.session.langchain_config) — the pipeline must NOT call req/res Express
//   response methods. deps wraps every collaborator so tests inject fakes:
// deps = {
//   resolveMcpAccessTokenWithEvents,   // async (req, tool) -> { token, tokenEvents, userSub }
//   evaluateMcpFirstToolGate,          // async ({req,tool,agentToken,userSub,userAcr,toolParams}) -> gate result
//   introspectToken,                   // async (token) -> { active, sub, scope, exp, aud, client_id }
//   callToolLocal,                     // async (tool, params, userId, req) -> result
//   mcpCallTool, callToolViaGateway, http2Bridge,  // remote transports
//   buildTokenEvent,                   // (id,label,status,tokenObj,desc,meta) -> event
//   mcpNoBearerResponse,               // (req, tokenEvents) -> { status, body }
//   stdioAdapter,                      // pingone admin path
//   recordMcpToolCall, publishMcpResultToSse, publishTokenEventsToSse,
//   emit,                              // (payload) -> void  (injected SSE sink)
//   config: { introspectionConfigured, useGateway, gatewayHttpUrl, mcpUrl,
//             useHttp2, pingoneAdminEnabled, pingoneAdminTools }
// }
```

---

### Task 1: Characterization test scaffold + first pinned path (PingOne admin early-exit)

**Files:**
- Create: `banking_api_server/src/__tests__/mcpToolPipeline.characterization.test.js`
- (Module `services/mcpToolPipeline.js` does not exist yet — test must fail on import first.)

- [ ] **Step 1: Write the failing test (scaffold + admin early-exit path)**

```js
/**
 * @file mcpToolPipeline.characterization.test.js
 *
 * Characterization tests for runMcpToolPipeline (ADR-0004). These pin the
 * EXACT Outcome kind/httpStatus/body for every exit path of the former
 * POST /api/mcp/tool handler. They are written BEFORE the extraction and must
 * stay GREEN after it — that is the proof the move changed no behavior.
 * Do NOT "improve" an assertion to match new code; a diff here is a regression.
 */
'use strict';

const { runMcpToolPipeline } = require('../../services/mcpToolPipeline');

// Minimal dep factory — every collaborator is a jest.fn() the test overrides.
function makeDeps(over = {}) {
  return {
    resolveMcpAccessTokenWithEvents: jest.fn(async () => ({ token: 't', tokenEvents: [], userSub: 'u1' })),
    evaluateMcpFirstToolGate: jest.fn(async () => ({ ran: true, permit: true, evaluation: { decision: 'PERMIT' } })),
    introspectToken: jest.fn(async () => ({ active: true, sub: 'u1', scope: 'banking:read', exp: 9999999999 })),
    callToolLocal: jest.fn(async () => ({ content: [{ text: 'local-ok' }] })),
    mcpCallTool: jest.fn(async () => ({ content: [{ text: 'remote-ok' }] })),
    callToolViaGateway: jest.fn(async () => ({ result: { content: [{ text: 'gw-ok' }] }, gwAuditTrail: null })),
    http2Bridge: { createHttp2Session: jest.fn(() => ({})), forwardToolCall: jest.fn(async () => ({ content: [] })) },
    buildTokenEvent: jest.fn((id, label, status) => ({ id, label, status })),
    mcpNoBearerResponse: jest.fn(() => ({ status: 401, body: { error: 'no_bearer' } })),
    stdioAdapter: { callToolViaStdio: jest.fn(async () => ({ content: [{ text: 'p1-ok' }] })) },
    recordMcpToolCall: jest.fn(),
    publishMcpResultToSse: jest.fn(),
    publishTokenEventsToSse: jest.fn(),
    emit: jest.fn(),
    config: {
      introspectionConfigured: false,
      useGateway: false,
      gatewayHttpUrl: '',
      mcpUrl: 'ws://localhost:8080',
      useHttp2: false,
      pingoneAdminEnabled: false,
      pingoneAdminTools: new Set(['list_applications']),
    },
    ...over,
  };
}

function makeCtx(over = {}) {
  return {
    tool: 'get_my_accounts',
    params: {},
    flowTraceId: '',
    startTime: Date.now(),
    req: { session: { user: { id: '1', oauthId: 'u1' } }, correlationId: 'c1' },
    deps: makeDeps(over.deps || {}),
    ...over,
  };
}

describe('runMcpToolPipeline — characterization (ADR-0004, zero behavior change)', () => {
  test('PingOne admin tool early-exit returns result with empty tokenEvents (no token exchange)', async () => {
    const deps = makeDeps({ config: { ...makeDeps().config, pingoneAdminEnabled: true } });
    const ctx = makeCtx({ tool: 'list_applications', deps });

    const outcome = await runMcpToolPipeline(ctx);

    expect(outcome.kind).toBe('result');
    expect(outcome.httpStatus).toBe(200);
    expect(outcome.body).toEqual({ result: { content: [{ text: 'p1-ok' }] }, tokenEvents: [] });
    expect(deps.stdioAdapter.callToolViaStdio).toHaveBeenCalledWith('list_applications', {}, '', 'u1', 'c1');
    expect(deps.resolveMcpAccessTokenWithEvents).not.toHaveBeenCalled(); // bypasses exchange
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd banking_api_server && npx jest mcpToolPipeline.characterization --silent 2>&1 | tail -8`
Expected: FAIL — `Cannot find module '../../services/mcpToolPipeline'`.

- [ ] **Step 3: Create a minimal module stub that satisfies only this path**

Create `banking_api_server/services/mcpToolPipeline.js`:

```js
'use strict';

/**
 * runMcpToolPipeline — pure orchestration of a BFF MCP tool call (ADR-0004).
 * Returns a discriminated Outcome; never touches Express res/req response APIs.
 * Built up path-by-path under characterization tests.
 * @param {object} ctx { tool, params, flowTraceId, startTime, req, deps }
 * @returns {Promise<object>} Outcome { kind:'result'|'block'|'error', httpStatus, body, tokenEvents? }
 */
async function runMcpToolPipeline(ctx) {
  const { tool, params, req, deps } = ctx;
  const { config } = deps;

  // ── PingOne admin tool early-exit ──────────────────────────────────────────
  if (config.pingoneAdminEnabled && config.pingoneAdminTools.has(tool)) {
    deps.emit({ phase: 'mcp_pingone_admin_tool' });
    try {
      const p1UserSub = (req.session?.user?.oauthId || req.session?.user?.id) || null;
      const result = await deps.stdioAdapter.callToolViaStdio(tool, params || {}, '', p1UserSub, req.correlationId);
      deps.emit({ phase: 'mcp_remote_done' });
      return { kind: 'result', httpStatus: 200, body: { result, tokenEvents: [] }, tokenEvents: [] };
    } catch (err) {
      deps.emit({ phase: 'mcp_remote_error' });
      console.error('[PingOne MCP] %s failed: %s', tool, err.message);
      return { kind: 'error', httpStatus: 502, body: { error: 'pingone_mcp_error', message: err.message } };
    }
  }

  throw new Error('runMcpToolPipeline: path not yet implemented');
}

module.exports = { runMcpToolPipeline };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd banking_api_server && npx jest mcpToolPipeline.characterization --silent 2>&1 | tail -5`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
cd /Users/curtismuir/Development/banking
git add banking_api_server/services/mcpToolPipeline.js banking_api_server/src/__tests__/mcpToolPipeline.characterization.test.js
git commit -m "test(mcp-pipeline): characterization scaffold + pin PingOne admin early-exit path

Refs ADR-0004. Pure-extraction harness; module built path-by-path under
pinned tests so the later server.js swap is provably zero-behavior-change."
```

---

### Task 2: Pin + implement token-resolution phase (success + 5 error exits)

**Files:**
- Modify: `banking_api_server/src/__tests__/mcpToolPipeline.characterization.test.js`
- Modify: `banking_api_server/services/mcpToolPipeline.js`

These five exits are the §4 hot spots. Code is copied **verbatim** from `server.js:1346-1532`.

- [ ] **Step 1: Append the failing tests for token-resolution exits**

Add inside the `describe` block:

```js
  test('token resolve success → proceeds (no early Outcome from this phase)', async () => {
    const deps = makeDeps();
    deps.evaluateMcpFirstToolGate = jest.fn(async () => ({ ran: false, reason: 'no_token' }));
    deps.mcpCallTool = jest.fn(async () => ({ content: [{ text: 'remote-ok' }] }));
    const outcome = await runMcpToolPipeline(makeCtx({ deps }));
    expect(outcome.kind).toBe('result');
    expect(deps.resolveMcpAccessTokenWithEvents).toHaveBeenCalled();
  });

  test('missing_exchange_scopes → block 403 with structured config-fix body', async () => {
    const err = Object.assign(new Error('need write'), {
      code: 'missing_exchange_scopes', missingScopes: ['banking:write'],
      userScopes: 'banking:read', requiredScopes: 'banking:write', tokenEvents: [{ id: 'x' }],
    });
    const deps = makeDeps({ resolveMcpAccessTokenWithEvents: jest.fn(async () => { throw err; }) });
    const outcome = await runMcpToolPipeline(makeCtx({ deps }));
    expect(outcome).toMatchObject({
      kind: 'block', httpStatus: 403,
      body: { error: 'missing_exchange_scopes', message: 'need write',
              missingScopes: ['banking:write'], userScopes: 'banking:read',
              requiredScopes: 'banking:write', tokenEvents: [{ id: 'x' }] },
    });
  });

  test('exchange-scope-error (httpStatus 400) + session user → local fallback result, flags set', async () => {
    const err = Object.assign(new Error('At least one scope must be granted'), { httpStatus: 400 });
    const deps = makeDeps({
      resolveMcpAccessTokenWithEvents: jest.fn(async () => { throw err; }),
      callToolLocal: jest.fn(async () => ({ content: [{ text: 'local' }] })),
    });
    const outcome = await runMcpToolPipeline(makeCtx({ deps }));
    expect(outcome.kind).toBe('result');
    expect(outcome.httpStatus).toBe(200);
    expect(outcome.body._localFallback).toBe(true);
    expect(outcome.body._exchangeFailed).toBe(true);
    expect(deps.callToolLocal).toHaveBeenCalledWith('get_my_accounts', {}, 'u1', expect.any(Object));
  });

  test('pingoneError 401 IS an exchange-scope error (local fallback), session-guard 401 is NOT', async () => {
    const pingoneErr = Object.assign(new Error('Unsupported authentication method'), { httpStatus: 401, pingoneError: 'invalid_client' });
    const depsP = makeDeps({ resolveMcpAccessTokenWithEvents: jest.fn(async () => { throw pingoneErr; }) });
    const outP = await runMcpToolPipeline(makeCtx({ deps: depsP }));
    expect(outP.kind).toBe('result');
    expect(outP.body._localFallback).toBe(true);

    const guardErr = Object.assign(new Error('no session'), { httpStatus: 401 }); // no .pingoneError
    const depsG = makeDeps({ resolveMcpAccessTokenWithEvents: jest.fn(async () => { throw guardErr; }) });
    const outG = await runMcpToolPipeline(makeCtx({ deps: depsG }));
    expect(outG.kind).toBe('error');
    expect(outG.httpStatus).toBe(401);
    expect(depsG.callToolLocal).not.toHaveBeenCalled();
  });

  test('TOKEN_INACTIVE → error 401 need_auth, no local fallback', async () => {
    const err = Object.assign(new Error('inactive'), { code: 'TOKEN_INACTIVE', tokenEvents: [{ id: 'e' }] });
    const deps = makeDeps({ resolveMcpAccessTokenWithEvents: jest.fn(async () => { throw err; }) });
    const outcome = await runMcpToolPipeline(makeCtx({ deps }));
    expect(outcome).toMatchObject({
      kind: 'error', httpStatus: 401,
      body: { error: 'Session expired', need_auth: true, agentInitRequired: true, tokenEvents: [{ id: 'e' }] },
    });
  });

  test('generic exchange failure → error with err.httpStatus||502 and errCode mapping', async () => {
    const err = Object.assign(new Error('actor token invalid'), { httpStatus: 502, code: 'actor_token_invalid', tokenEvents: [] });
    const deps = makeDeps({ resolveMcpAccessTokenWithEvents: jest.fn(async () => { throw err; }) });
    const outcome = await runMcpToolPipeline(makeCtx({ deps }));
    expect(outcome).toMatchObject({
      kind: 'error', httpStatus: 502,
      body: { error: 'actor_token_invalid', message: 'actor token invalid', tokenEvents: [] },
    });
  });

  test('no bearer token + session user → local fallback result _localFallback', async () => {
    const deps = makeDeps({ resolveMcpAccessTokenWithEvents: jest.fn(async () => ({ token: null, tokenEvents: [], userSub: null })) });
    const outcome = await runMcpToolPipeline(makeCtx({ deps }));
    expect(outcome.kind).toBe('result');
    expect(outcome.body._localFallback).toBe(true);
  });

  test('no bearer token + NO session user → block from mcpNoBearerResponse', async () => {
    const deps = makeDeps({
      resolveMcpAccessTokenWithEvents: jest.fn(async () => ({ token: null, tokenEvents: [], userSub: null })),
      mcpNoBearerResponse: jest.fn(() => ({ status: 401, body: { error: 'no_bearer' } })),
    });
    const ctx = makeCtx({ deps, req: { session: { user: null }, correlationId: 'c1' } });
    const outcome = await runMcpToolPipeline(ctx);
    expect(outcome).toMatchObject({ kind: 'block', httpStatus: 401, body: { error: 'no_bearer' } });
  });
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `cd banking_api_server && npx jest mcpToolPipeline.characterization --silent 2>&1 | tail -10`
Expected: FAIL — `runMcpToolPipeline: path not yet implemented`.

- [ ] **Step 3: Implement the token-resolution phase verbatim from server.js:1346-1532**

In `services/mcpToolPipeline.js`, replace the final `throw new Error(...)` line with the block below. Copy the logic exactly from `server.js` lines 1346-1532; `res.json(x)` becomes `return {kind:'result',httpStatus:200,body:x,tokenEvents}`, `res.status(n).json(x)` becomes `return {kind:'block'|'error',httpStatus:n,body:x, ...}` (block for 403/428/no-bearer-gate, error for 401/500/502/503), and `emit(...)` / `publishTokenEventsToSse(...)` become `deps.emit(...)` / `deps.publishTokenEventsToSse(...)`:

```js
  let mcpAccessToken;
  let userSub = null;
  let tokenEvents = [];
  const startTime = ctx.startTime;
  const flowTraceId = ctx.flowTraceId;
  try {
    deps.emit({ phase: 'resolving_access_token' });
    const resolved = await deps.resolveMcpAccessTokenWithEvents(req, tool);
    mcpAccessToken = resolved.token;
    tokenEvents = resolved.tokenEvents;
    userSub = resolved.userSub || null;
    deps.publishTokenEventsToSse(flowTraceId, tokenEvents);
    const evs = tokenEvents || [];
    deps.emit({
      phase: 'access_token_ready',
      hasUserToken: evs.some((e) => e && e.id === 'user-token'),
      exchanged: evs.some((e) => e && e.id === 'exchanged-token'),
      exchangeRequired: evs.some((e) => e && e.id === 'exchange-required'),
    });
  } catch (err) {
    console.error(`[MCP Proxy] Token resolution failed for tool ${tool}:`, err.message);
    deps.emit({ phase: 'access_token_error', code: err.code || 'token_exchange_failed' });

    if (err.code === 'missing_exchange_scopes') {
      const events = err.tokenEvents && err.tokenEvents.length ? err.tokenEvents : [];
      deps.publishTokenEventsToSse(flowTraceId, events);
      return { kind: 'block', httpStatus: 403, tokenEvents: events, body: {
        error: 'missing_exchange_scopes', message: err.message,
        missingScopes: err.missingScopes || [], userScopes: err.userScopes || '',
        requiredScopes: err.requiredScopes || '', tokenEvents: events } };
    }

    const sessionUser = req.session?.user;
    const isExchangeScopeError =
      err.httpStatus === 400 ||
      err.code === 'token_exchange_failed' ||
      (err.httpStatus === 401 && Boolean(err.pingoneError));
    if (sessionUser?.id && isExchangeScopeError) {
      const fallbackEvents = err.tokenEvents && err.tokenEvents.length ? err.tokenEvents : [];
      deps.publishTokenEventsToSse(flowTraceId, fallbackEvents);
      const effectiveUserId = sessionUser.oauthId || sessionUser.id;
      try {
        deps.emit({ phase: 'local_tool_start', path: 'exchange_failed_fallback' });
        const result = await deps.callToolLocal(tool, params || {}, effectiveUserId, req);
        deps.emit({ phase: 'local_tool_done', path: 'exchange_failed_fallback' });
        const _efDuration = Date.now() - startTime;
        deps.publishMcpResultToSse(flowTraceId, { tool, result, durationMs: _efDuration, isDelegated: false, userId: effectiveUserId });
        deps.recordMcpToolCall({ userId: effectiveUserId, toolName: tool, success: !result?.error, duration: _efDuration, resultSummary: result?.error ? `${tool} failed` : `${tool} completed` });
        return { kind: 'result', httpStatus: 200, tokenEvents: fallbackEvents, body: {
          result, tokenEvents: fallbackEvents, _localFallback: true, _exchangeFailed: true } };
      } catch (localErr) {
        console.error('[MCP Local] %s — callToolLocal THREW after exchange failure: %s', tool, localErr.message);
        // fall through to original error response
      }
    }

    if (err.code === 'TOKEN_INACTIVE') {
      const events = err.tokenEvents && err.tokenEvents.length ? err.tokenEvents : [];
      deps.publishTokenEventsToSse(flowTraceId, events);
      return { kind: 'error', httpStatus: 401, body: {
        error: 'Session expired', need_auth: true, agentInitRequired: true, tokenEvents: events } };
    }

    const status = err.httpStatus || 502;
    const events = err.tokenEvents && err.tokenEvents.length ? err.tokenEvents : [];
    deps.publishTokenEventsToSse(flowTraceId, events);
    const errCode = err.error || err.code;
    return { kind: 'error', httpStatus: status, body: {
      error: errCode || 'token_exchange_failed', message: err.message, tokenEvents: events } };
  }

  if (!mcpAccessToken) {
    deps.emit({ phase: 'no_bearer_token_branch' });
    const sessionUser = req.session?.user;
    if (sessionUser?.id) {
      try {
        deps.emit({ phase: 'local_tool_start', path: 'no_bearer' });
        const effectiveUserId = sessionUser.oauthId || sessionUser.id;
        const result = await deps.callToolLocal(tool, params || {}, effectiveUserId, req);
        deps.emit({ phase: 'local_tool_done', path: 'no_bearer' });
        deps.publishTokenEventsToSse(flowTraceId, tokenEvents);
        return { kind: 'result', httpStatus: 200, tokenEvents, body: { result, tokenEvents, _localFallback: true } };
      } catch (localErr) {
        console.error(`[MCP Local] Error calling ${tool}:`, localErr.message);
        deps.emit({ phase: 'local_tool_error', path: 'no_bearer' });
        deps.publishTokenEventsToSse(flowTraceId, tokenEvents);
        return { kind: 'error', httpStatus: 502, body: { error: 'mcp_error', message: localErr.message, tokenEvents } };
      }
    }
    deps.emit({ phase: 'no_bearer_no_user' });
    const r = deps.mcpNoBearerResponse(req, tokenEvents);
    deps.publishTokenEventsToSse(flowTraceId, tokenEvents);
    return { kind: 'block', httpStatus: r.status, body: r.body };
  }

  // ctx carry-forward for subsequent phases (Task 3+)
  ctx._mcpAccessToken = mcpAccessToken;
  ctx._userSub = userSub;
  ctx._tokenEvents = tokenEvents;
  throw new Error('runMcpToolPipeline: authorize phase not yet implemented');
```

- [ ] **Step 4: Run to verify all token-phase tests pass**

Run: `cd banking_api_server && npx jest mcpToolPipeline.characterization --silent 2>&1 | tail -6`
Expected: PASS for all `missing_exchange_scopes`, exchange-scope-error, pingoneError, TOKEN_INACTIVE, generic, no-bearer tests. (The two non-token tests `token resolve success` and the admin one still pass; tests that reach later phases will still error — that's expected until Task 3.)

- [ ] **Step 5: Commit**

```bash
cd /Users/curtismuir/Development/banking
git add banking_api_server/services/mcpToolPipeline.js banking_api_server/src/__tests__/mcpToolPipeline.characterization.test.js
git commit -m "test(mcp-pipeline): pin token-resolution phase + 5 error exits (verbatim from server.js)

The isExchangeScopeError classification + oauthId||id resolution are the
exact REGRESSION_PLAN §4 hot spots; copied byte-for-byte. Refs ADR-0004."
```

---

### Task 3: Pin + implement Authorize gate phase (inside the pipeline, injected)

**Files:**
- Modify: `banking_api_server/src/__tests__/mcpToolPipeline.characterization.test.js`
- Modify: `banking_api_server/services/mcpToolPipeline.js`

This is the ADR-0003/T-2 invariant. The gate stays inside; the test asserts it
runs before the remote call.

- [ ] **Step 1: Append failing tests**

```js
  test('Authorize gate runs BEFORE the remote call on the permit path (ADR-0003/T-2)', async () => {
    const order = [];
    const deps = makeDeps();
    deps.evaluateMcpFirstToolGate = jest.fn(async () => { order.push('gate'); return { ran: true, permit: true, evaluation: { decision: 'PERMIT' } }; });
    deps.mcpCallTool = jest.fn(async () => { order.push('remote'); return { content: [{ text: 'ok' }] }; });
    await runMcpToolPipeline(makeCtx({ deps }));
    expect(order).toEqual(['gate', 'remote']);
  });

  test('gate block 403 deny → block Outcome with tokenEvents + mcpAuthorizeEvaluation', async () => {
    const deps = makeDeps();
    deps.evaluateMcpFirstToolGate = jest.fn(async () => ({ ran: true, block: { status: 403, body: { error: 'mcp_authorization_denied', decisionId: 'd1', decisionContext: { x: 1 } } } }));
    const outcome = await runMcpToolPipeline(makeCtx({ deps }));
    expect(outcome.kind).toBe('block');
    expect(outcome.httpStatus).toBe(403);
    expect(outcome.body.error).toBe('mcp_authorization_denied');
    expect(outcome.body.mcpAuthorizeEvaluation).toEqual({ decisionContext: { x: 1 }, decisionId: 'd1' });
  });

  test('gate block 428 mcp_hitl_required → block + pending decision created, taskId in body', async () => {
    const deps = makeDeps();
    deps.createPendingDecision = jest.fn(() => ({ taskId: 'task-9' }));
    deps.evaluateMcpFirstToolGate = jest.fn(async () => ({ ran: true, block: { status: 428, body: { error: 'mcp_hitl_required', decisionId: 'd2', decisionContext: { c: 2 }, error_description: 'needs human' } } }));
    const outcome = await runMcpToolPipeline(makeCtx({ deps }));
    expect(outcome.httpStatus).toBe(428);
    expect(deps.createPendingDecision).toHaveBeenCalledWith('u1', expect.objectContaining({ tool: 'get_my_accounts', decisionId: 'd2' }));
    expect(outcome.body.taskId).toBe('task-9');
  });

  test('gate simulatedError → error 500 mcp_authorize_error', async () => {
    const deps = makeDeps();
    deps.evaluateMcpFirstToolGate = jest.fn(async () => ({ ran: true, simulatedError: new Error('sim boom') }));
    const outcome = await runMcpToolPipeline(makeCtx({ deps }));
    expect(outcome).toMatchObject({ kind: 'error', httpStatus: 500, body: { error: 'mcp_authorize_error' } });
  });

  test('gate pingoneError → error 503 mcp_authorize_unavailable (fail closed)', async () => {
    const deps = makeDeps();
    deps.evaluateMcpFirstToolGate = jest.fn(async () => ({ ran: true, pingoneError: new Error('p1 down') }));
    const outcome = await runMcpToolPipeline(makeCtx({ deps }));
    expect(outcome).toMatchObject({ kind: 'error', httpStatus: 503, body: { error: 'mcp_authorize_unavailable' } });
  });

  test('gate internal throw → error 500 mcp_authorize_internal', async () => {
    const deps = makeDeps();
    deps.evaluateMcpFirstToolGate = jest.fn(async () => { throw new Error('gate exploded'); });
    const outcome = await runMcpToolPipeline(makeCtx({ deps }));
    expect(outcome).toMatchObject({ kind: 'error', httpStatus: 500, body: { error: 'mcp_authorize_internal' } });
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `cd banking_api_server && npx jest mcpToolPipeline.characterization -t "Authorize|gate" --silent 2>&1 | tail -8`
Expected: FAIL — `authorize phase not yet implemented`.

- [ ] **Step 3: Add `createPendingDecision` to the dep contract + implement the gate phase verbatim from server.js:1534-1627**

Add `createPendingDecision: jest.fn(() => ({ taskId: 't' }))` to `makeDeps()` defaults (alongside `recordMcpToolCall`). Then replace the `throw new Error('runMcpToolPipeline: authorize phase not yet implemented')` line with the block below — copied exactly from `server.js:1534-1627`, with `res.status(n).json(x)` → `return {kind, httpStatus:n, body:x}` and `require('./routes/mcpDecisionPolling').createPendingDecision` replaced by the injected `deps.createPendingDecision`:

```js
  let mcpAuthorizeEvaluationThisRequest;
  try {
    deps.emit({ phase: 'authorize_gate_begin' });
    const mcpAuthz = await deps.evaluateMcpFirstToolGate({
      req, tool, agentToken: mcpAccessToken, userSub,
      userAcr: req.session?.user?.acr, toolParams: params,
    });
    if (mcpAuthz.ran && mcpAuthz.block) {
      deps.emit({ phase: 'authorize_denied', status: mcpAuthz.block.status });
      let hitlTaskId = null;
      if (mcpAuthz.block.body.error === 'mcp_hitl_required') {
        deps.emit({ phase: 'authorize_denied_hitl', challenge_type: 'hitl' });
        const hitl = deps.createPendingDecision(userSub, {
          tool, decisionId: mcpAuthz.block.body.decisionId,
          decisionContext: mcpAuthz.block.body.decisionContext,
          reason: mcpAuthz.block.body.error_description,
        });
        hitlTaskId = hitl.taskId;
      }
      return { kind: 'block', httpStatus: mcpAuthz.block.status, tokenEvents, body: {
        ...mcpAuthz.block.body,
        ...(hitlTaskId ? { taskId: hitlTaskId } : {}),
        tokenEvents,
        mcpAuthorizeEvaluation: {
          decisionContext: mcpAuthz.block.body.decisionContext,
          decisionId: mcpAuthz.block.body.decisionId,
        },
      } };
    }
    if (mcpAuthz.ran && mcpAuthz.simulatedError) {
      deps.emit({ phase: 'authorize_simulated_error' });
      console.error(`[MCP Authorize][Simulated] unexpected error: ${mcpAuthz.simulatedError.message}`);
      return { kind: 'error', httpStatus: 500, body: {
        error: 'mcp_authorize_error',
        error_description: 'Simulated MCP authorization evaluation failed unexpectedly.',
        tokenEvents } };
    }
    if (mcpAuthz.ran && mcpAuthz.pingoneError) {
      deps.emit({ phase: 'authorize_unavailable' });
      console.error(`[MCP Authorize] PingOne error — failing closed: ${mcpAuthz.pingoneError.message}`);
      return { kind: 'error', httpStatus: 503, body: {
        error: 'mcp_authorize_unavailable',
        error_description: 'PingOne Authorize is unavailable for MCP tool access.',
        tokenEvents } };
    }
    if (mcpAuthz.ran && mcpAuthz.permit) {
      deps.emit({ phase: 'authorize_permitted' });
      mcpAuthorizeEvaluationThisRequest = mcpAuthz.evaluation;
    }
    if (!mcpAuthz.ran) {
      deps.emit({ phase: 'authorize_gate_skipped', reason: mcpAuthz.reason });
    }
  } catch (mcpAuthzErr) {
    deps.emit({ phase: 'authorize_internal_error' });
    console.error('[MCP Authorize] Unexpected error in gate:', mcpAuthzErr.message);
    return { kind: 'error', httpStatus: 500, body: {
      error: 'mcp_authorize_internal', message: mcpAuthzErr.message, tokenEvents } };
  }

  ctx._mcpAuthorizeEvaluation = mcpAuthorizeEvaluationThisRequest;
  throw new Error('runMcpToolPipeline: introspection+remote phase not yet implemented');
```

> NOTE for the implementer: the original `server.js` logs an `appEventService.logEvent` on the `!mcpAuthz.ran` branch. That is advisory audit logging, not response behavior. Add `appEventLog` to the dep contract (default `jest.fn()`) and call `deps.appEventLog('authorize','info', ...)` to preserve it verbatim — do not drop it.

- [ ] **Step 4: Run to verify gate tests pass**

Run: `cd banking_api_server && npx jest mcpToolPipeline.characterization -t "Authorize|gate" --silent 2>&1 | tail -6`
Expected: PASS for all 6 gate tests; the order test shows `['gate','remote']` only once the remote phase exists (Task 4) — until then this specific test still errors. Re-run after Task 4. All earlier-phase tests still PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/curtismuir/Development/banking
git add banking_api_server/services/mcpToolPipeline.js banking_api_server/src/__tests__/mcpToolPipeline.characterization.test.js
git commit -m "test(mcp-pipeline): pin Authorize gate phase inside pipeline (injected)

Gate stays inside the seam per ADR-0003/T-2/T-7; injected so the
'gate before remote, every call' invariant is test-asserted (REGRESSION §1 row 56)."
```

---

### Task 4: Pin + implement introspection + remote-call + gateway-audit-merge + remote fallbacks

**Files:**
- Modify: `banking_api_server/src/__tests__/mcpToolPipeline.characterization.test.js`
- Modify: `banking_api_server/services/mcpToolPipeline.js`

- [ ] **Step 1: Append failing tests (introspection variants + remote success + audit merge + scope/gateway/unreachable exits)**

```js
  test('introspection not configured → skipped event, proceeds to remote success', async () => {
    const deps = makeDeps();
    deps.mcpCallTool = jest.fn(async () => ({ content: [{ text: 'remote-ok' }] }));
    const outcome = await runMcpToolPipeline(makeCtx({ deps }));
    expect(outcome.kind).toBe('result');
    expect(outcome.body.result).toEqual({ content: [{ text: 'remote-ok' }] });
    expect(outcome.body.tokenEvents.some(e => e.id === 'session-token-introspection')).toBe(true);
  });

  test('introspection active=false → error 401 token_inactive', async () => {
    const deps = makeDeps({
      introspectToken: jest.fn(async () => ({ active: false, sub: 'u1' })),
      config: { ...makeDeps().config, introspectionConfigured: true },
    });
    deps.req = undefined;
    const ctx = makeCtx({ deps });
    ctx.deps.getSessionAccessToken = jest.fn(() => 'sess-tok');
    const outcome = await runMcpToolPipeline(ctx);
    expect(outcome).toMatchObject({ kind: 'error', httpStatus: 401, body: { error: 'token_inactive', need_auth: true } });
  });

  test('remote success via gateway with gwAuditTrail → 3 gw token events appended', async () => {
    const deps = makeDeps();
    deps.config = { ...deps.config, useGateway: true, gatewayHttpUrl: 'http://gw' };
    deps.callToolViaGateway = jest.fn(async () => ({
      result: { content: [{ text: 'gw-ok' }] },
      gwAuditTrail: { introspection: { active: true, sub: 'u1' }, authorize: { decision: 'PERMIT' }, exchange: { targetAud: 'mcp-server.ping.demo' } },
    }));
    const outcome = await runMcpToolPipeline(makeCtx({ deps }));
    const ids = outcome.body.tokenEvents.map(e => e.id);
    expect(ids).toEqual(expect.arrayContaining(['gw-introspection', 'gw-authorize', 'gw-exchange']));
  });

  test('mcp_insufficient_scope thrown by remote → block 403 mcp_scope_denied, NO local fallback', async () => {
    const deps = makeDeps();
    deps.mcpCallTool = jest.fn(async () => { throw Object.assign(new Error('scope'), { code: 'mcp_insufficient_scope', mcpErrorData: { missingScopes: ['banking:write'] } }); });
    const outcome = await runMcpToolPipeline(makeCtx({ deps }));
    expect(outcome).toMatchObject({ kind: 'block', httpStatus: 403, body: { error: 'mcp_scope_denied' } });
    expect(deps.callToolLocal).not.toHaveBeenCalled();
  });

  test('gateway_policy_denied hitl_required → block 428 step_up_required', async () => {
    const deps = makeDeps();
    deps.mcpCallTool = jest.fn(async () => { throw Object.assign(new Error('policy'), { code: 'gateway_policy_denied', gatewayErrorCode: 'hitl_required' }); });
    const outcome = await runMcpToolPipeline(makeCtx({ deps }));
    expect(outcome).toMatchObject({ kind: 'block', httpStatus: 428, body: { error: 'step_up_required' } });
  });

  test('connection error + session user → remote_fallback local result', async () => {
    const deps = makeDeps();
    deps.mcpCallTool = jest.fn(async () => { throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }); });
    const outcome = await runMcpToolPipeline(makeCtx({ deps }));
    expect(outcome.kind).toBe('result');
    expect(outcome.body._localFallback).toBe(true);
  });

  test('non-connection remote error → error 502 mcp_error, NO fallback', async () => {
    const deps = makeDeps();
    deps.mcpCallTool = jest.fn(async () => { throw new Error('unexpected boom'); });
    const outcome = await runMcpToolPipeline(makeCtx({ deps }));
    expect(outcome).toMatchObject({ kind: 'error', httpStatus: 502, body: { error: 'mcp_error' } });
    expect(deps.callToolLocal).not.toHaveBeenCalled();
  });

  test('remote success default path → result body has activeModel/activeProvider + mcpAuthorizeEvaluation when set', async () => {
    const deps = makeDeps();
    deps.evaluateMcpFirstToolGate = jest.fn(async () => ({ ran: true, permit: true, evaluation: { decision: 'PERMIT', decisionId: 'dz' } }));
    deps.mcpCallTool = jest.fn(async () => ({ content: [{ text: 'ok' }] }));
    const ctx = makeCtx({ deps });
    ctx.req.session.langchain_config = { provider: 'helix', model: 'gpt-4o-mini' };
    const outcome = await runMcpToolPipeline(ctx);
    expect(outcome.body.activeProvider).toBe('helix');
    expect(outcome.body.activeModel).toBe('gpt-4o-mini');
    expect(outcome.body.mcpAuthorizeEvaluation).toEqual({ decision: 'PERMIT', decisionId: 'dz' });
  });

  test('HTTP/2 transport → result Outcome carries stream:true marker', async () => {
    const deps = makeDeps();
    deps.config = { ...deps.config, useHttp2: true, mcpUrl: 'http://localhost:8080' };
    deps.http2Bridge = { createHttp2Session: jest.fn(() => ({})), forwardToolCall: jest.fn(async () => ({ content: [{ text: 'h2' }] })) };
    const outcome = await runMcpToolPipeline(makeCtx({ deps }));
    expect(outcome.kind).toBe('result');
    expect(outcome.stream).toBe(true);
    expect(outcome.body.result).toEqual({ content: [{ text: 'h2' }] });
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `cd banking_api_server && npx jest mcpToolPipeline.characterization --silent 2>&1 | tail -8`
Expected: FAIL — `introspection+remote phase not yet implemented`.

- [ ] **Step 3: Implement the final phase verbatim from server.js:1629-1989**

Add `getSessionAccessToken` to the dep contract (default `jest.fn(() => 'sess-tok')`). Replace the final `throw` with the introspection + remote + audit-merge + auth-challenge-fallback + HTTP/2 + scope/gateway/unreachable logic copied exactly from `server.js:1629-1989`. Apply the same mechanical rules: `res.json(x)` → `return {kind:'result',httpStatus:200,body:x,tokenEvents}`; the HTTP/2 streaming branch → `return {kind:'result',httpStatus:200,stream:true,body:{result,tokenEvents},tokenEvents}` (the route shell does the actual `res.write`/`res.end`); `res.status(n).json(x)` → block (403/428) or error (502); `emit`/`publishMcpResultToSse`/`recordMcpToolCall`/`introspectToken`/`mcpCallTool`/`callToolViaGateway`/`http2McpBridge`/`callToolLocal`/`mcpNoBearerResponse` all become the `deps.*` equivalents; `getSessionAccessToken(req)` → `deps.getSessionAccessToken(req)`. Use `ctx._mcpAccessToken`, `ctx._userSub`, `ctx._tokenEvents`, `ctx._mcpAuthorizeEvaluation` carried from earlier phases. The `buildTokenEvent` calls for the introspection events and the 3 gateway-audit events must be copied verbatim (id/label/status/desc/meta args unchanged) — these feed the Token Chain teaching UI.

> The full source to transcribe is `server.js` lines 1629 through 1989 inclusive. Do not summarize or "tidy" any branch — every `if (hasAuthChallenge)`, the `isConnErr` predicate, the `mcpNoBearerResponse` on no-user, and the inner try/catch around the unreachable fallback must appear unchanged.

- [ ] **Step 4: Run the FULL characterization suite — every path GREEN**

Run: `cd banking_api_server && npx jest mcpToolPipeline.characterization --silent 2>&1 | tail -6`
Expected: PASS — all tests across Tasks 1-4 (the order test from Task 3 now shows `['gate','remote']`). Zero failures.

- [ ] **Step 5: Commit**

```bash
cd /Users/curtismuir/Development/banking
git add banking_api_server/services/mcpToolPipeline.js banking_api_server/src/__tests__/mcpToolPipeline.characterization.test.js
git commit -m "test(mcp-pipeline): pin introspection+remote+audit-merge+fallback phases

Full Outcome union now characterized end-to-end with all deps injected.
Module is behaviorally complete; server.js swap is next. Refs ADR-0004."
```

---

### Task 5: Swap server.js route to call the pipeline (the actual extraction)

**Files:**
- Modify: `banking_api_server/server.js:1230-1993`

This is the only task that touches the live route. The pipeline already reproduces
every path under green tests; here the 760-line body becomes a thin shell.

- [ ] **Step 1: Add the pipeline import + a `renderOutcome` helper near the existing route helpers (after `publishMcpResultToSse`, ~server.js:1227)**

```js
const { runMcpToolPipeline } = require('./services/mcpToolPipeline');
const { createPendingDecision: _createPendingDecision } = require('./routes/mcpDecisionPolling');

/**
 * Render a pipeline Outcome to the Express response. The ONLY res.* site for
 * the MCP tool route (ADR-0004). HTTP/2 streaming is the one special case.
 */
function renderOutcome(res, outcome, tokenEvents) {
  if (outcome.kind === 'result' && outcome.stream) {
    res.setHeader('Content-Type', 'application/stream+json; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.write(JSON.stringify({ type: 'result', data: outcome.body.result, tokenEvents: outcome.body.tokenEvents }) + '\n');
    res.write(JSON.stringify({ type: 'stream_close', status: 'success' }) + '\n');
    return res.end();
  }
  return res.status(outcome.httpStatus).json(outcome.body);
}
```

- [ ] **Step 2: Replace the route body (server.js:1230-1993) with the thin shell**

Keep the existing body-parse / `tool` validation / `flowTraceId` validation / `res.on('finish'|'close')` lifecycle block exactly as-is (lines ~1230-1326 — these own Express concerns and stay in the route). Replace everything from the `// ── PingOne admin tool early-exit ──` comment (line ~1328) through the route's closing `});` (line 1993) with:

```js
    const emit = (payload) => {
      if (flowTraceId) {
        mcpFlowSseHub.publish(flowTraceId, { ...payload, tool: payload.tool || tool });
      }
    };
    emit({ phase: 'request_accepted' });

    const ctx = {
      tool, params, flowTraceId, startTime: Date.now(), req,
      deps: {
        resolveMcpAccessTokenWithEvents,
        evaluateMcpFirstToolGate: (a) => mcpToolAuthorizationService.evaluateMcpFirstToolGate(a),
        introspectToken,
        getSessionAccessToken,
        callToolLocal,
        mcpCallTool,
        callToolViaGateway: (url, tok, t, p, o) => mcpGatewayClient.callToolViaGateway(url, tok, t, p, o),
        http2Bridge: http2McpBridge,
        stdioAdapter: mcpPingOneStdioAdapter,
        buildTokenEvent,
        mcpNoBearerResponse,
        createPendingDecision: _createPendingDecision,
        recordMcpToolCall,
        publishMcpResultToSse: (id, a) => publishMcpResultToSse(id, a),
        publishTokenEventsToSse: (id, evs) => publishTokenEventsToSse(id, evs),
        appEventLog: (cat, lvl, msg, meta) => appEventService.logEvent(cat, lvl, msg, meta),
        emit,
        config: {
          introspectionConfigured: !!process.env.PINGONE_INTROSPECTION_ENDPOINT,
          useGateway: !!process.env.MCP_GATEWAY_HTTP_URL,
          gatewayHttpUrl: mcpGatewayClient.getMcpGatewayHttpUrl(),
          mcpUrl: getMcpServerUrl(),
          useHttp2: (() => {
            const u = getMcpServerUrl();
            return !process.env.MCP_GATEWAY_HTTP_URL && (u.startsWith('http://') || u.startsWith('https://'));
          })(),
          pingoneAdminEnabled: configStore.get('mcp_use_pingone_server') === 'true',
          pingoneAdminTools: PINGONE_ADMIN_TOOLS,
        },
      },
    };

    const outcome = await runMcpToolPipeline(ctx);
    return renderOutcome(res, outcome);
  } catch (err) {
    next(err);
  }
});
```

> The PingOne-admin early-exit, no-bearer branch, authorize gate, introspection,
> remote call, all 3 local-fallback hatches, and the HTTP/2 marker now live in
> `mcpToolPipeline.js`. Do not leave any duplicated copy in `server.js`.

- [ ] **Step 3: Run the characterization suite + the existing route guards (must all still pass)**

Run: `cd banking_api_server && npx jest mcpToolPipeline.characterization mcpToolAuthorizationService r1LocalAuthzRemoval --silent 2>&1 | tail -6`
Expected: PASS — characterization suite unchanged GREEN; `r1LocalAuthzRemoval` (the ADR-0003 invariant) and `mcpToolAuthorizationService` pass counts equal or exceed the Step 0d baseline.

- [ ] **Step 4: Full BFF suite + lint, no regressions**

Run: `cd /Users/curtismuir/Development/banking && npm run test:api-server 2>&1 | tail -15`
Expected: no NEW failures vs. a pre-change baseline. (Pre-existing unrelated failures, if any, must be identical in count/name — note them explicitly; do not fix unrelated ones.)

- [ ] **Step 5: Commit**

```bash
cd /Users/curtismuir/Development/banking
git add banking_api_server/server.js
git commit -m "refactor(mcp-pipeline): server.js POST /api/mcp/tool is now a thin shell

760-line handler -> ctx build + runMcpToolPipeline + renderOutcome. Pure
extraction; characterization suite GREEN before and after. Refs ADR-0004,
ARCHITECTURE-TRUTHS T-7, ADR-0003 (gate unchanged, still sole authoritative)."
```

---

### Task 6: Live chip verification gate (the real exit criterion)

**Files:** none (verification only). Per skip-proof-pipeline-tests + REGRESSION_PLAN §4: the existing unit suite did NOT catch the prior incidents on this path. A live chip click is the binding evidence.

- [ ] **Step 1: Build the UI (CLAUDE.md non-negotiable #3 — required after any change that the UI exercises)**

Run: `cd /Users/curtismuir/Development/banking/banking_api_ui && npm run build 2>&1 | tail -3`
Expected: exit code 0. (No UI source changed, but this is the mandated gate; record the exit code.)

- [ ] **Step 2: Start the stack**

Run: `cd /Users/curtismuir/Development/banking && ./run-demo.sh status 2>&1 | tail -5` then `./run-demo.sh` if not already up. Wait for BFF :3001 and UI :4000 healthy.

- [ ] **Step 3: Live chip → 200 + non-empty tokenEvents (the gate)**

Sign in as the demo customer at `https://api.ping.demo:4000`, open the agent dock, click the "My Accounts" chip. Then verify in `/tmp/bank-api-server.log`:

Run: `grep -E "\[/api/mcp/tool\]|McpExchangerToken|MCP tool (call|done)" /tmp/bank-api-server.log | tail -20`
Expected: `POST /api/mcp/tool` returns 200; log shows `[McpExchangerToken] ✅ Token obtained` (or the configured exchange path) and `MCP tool done ← get_my_accounts`; NO `May not request scopes for multiple resources`, NO unhandled 502.

- [ ] **Step 4: Token Chain renders (teaching-surface invariant, token-visibility-intentional)**

In the browser, open the Token Chain panel. Confirm the exchange events render progressively (user-token → exchange → gateway events as applicable) — the panel is NOT empty and updates live during the call. If introspection/Authorize/gateway-audit events are configured, confirm they appear as before. A blank or batched-only panel is a regression — stop and revert.

- [ ] **Step 5: One write path (HITL/step-up still gates)**

Click a transfer chip that exceeds the confirm threshold. Confirm the consent modal still appears (428 path) and the flow completes after OTP. This proves the Authorize gate inside the pipeline still fires on every call (ADR-0003/T-2, REGRESSION §1 row 56).

- [ ] **Step 6: Record the §4 Bug Fix Log entry (CLAUDE.md non-negotiable #6 / regression-guard)**

This is a structural refactor of a §1-protected path, not a bug fix, but REGRESSION_PLAN must record it. Append a §4 entry: date `2026-05-17`, title "Refactor: POST /api/mcp/tool extracted to runMcpToolPipeline (ADR-0004)", what was changed (760-line handler → pure pipeline + thin shell), what was NOT changed (every res.* status/body, gate ordering, isExchangeScopeError, SSE liveness), how verified (characterization suite GREEN before+after the swap; live "My Accounts" chip 200 + live Token Chain; transfer step-up still gates). Reference ADR-0004 and commits from Tasks 1-5.

- [ ] **Step 7: Final commit**

```bash
cd /Users/curtismuir/Development/banking
git add REGRESSION_PLAN.md
git commit -m "docs(regression): §4 entry for ADR-0004 MCP tool pipeline extraction

Live chip gate passed: My Accounts 200 + live Token Chain; transfer step-up
gates. Characterization suite GREEN pre/post swap."
```

---

## Self-Review

**1. Spec coverage (ADR-0004 properties):**
- Module returns Outcome, route renders → Tasks 1-5, the `Outcome` contract + `renderOutcome`. ✔
- Authorize gate inside, injected, ordering test-asserted → Task 3 (the `['gate','remote']` order test). ✔
- All 3 local-fallback hatches internal → Task 2 (exchange-scope, no-bearer) + Task 4 (remote-unreachable, auth-challenge). ✔
- SSE emit injected, phases stay live → `deps.emit` throughout; Task 6 Step 4 verifies live (not batched). ✔
- Zero behavior change, char-tests before+after, then live chip → Tasks 1-4 (before), Task 5 Step 3 (after), Task 6 (live). ✔
- ADR-0003 not relitigated → Task 5 keeps `mcpToolAuthorizationService` as the gate; Task 5 Step 3 runs `r1LocalAuthzRemoval`. ✔

**2. Placeholder scan:** No TBD/TODO. Task 4 Step 3 references "transcribe server.js:1629-1989 verbatim" rather than re-pasting 360 lines — this is deliberate (re-pasting verbatim source the implementer must copy exactly is more error-prone than pointing at the canonical lines with explicit mechanical rules); the mechanical transformation rules and the dep names are fully specified, and every resulting Outcome is pinned by a concrete test in Step 1. Acceptable.

**3. Type consistency:** `Outcome` shape (`kind`/`httpStatus`/`body`/`tokenEvents`/`stream`) consistent across Tasks 1-5 and `renderOutcome`. `ctx`/`deps` names (`resolveMcpAccessTokenWithEvents`, `evaluateMcpFirstToolGate`, `createPendingDecision`, `getSessionAccessToken`, `appEventLog`, `emit`, `config.*`) consistent between the contract, the test factory `makeDeps`, and the Task 5 real wiring. `createPendingDecision`/`getSessionAccessToken`/`appEventLog` were added to the dep contract in the same task they are first used (Tasks 3, 4, 3 respectively) — no forward reference.
