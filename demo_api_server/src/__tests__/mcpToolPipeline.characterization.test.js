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
    getSessionAccessToken: jest.fn(() => 'sess-tok'),
    introspectToken: jest.fn(async () => ({ active: true, sub: 'u1', scope: 'read', exp: 9999999999 })),
    callToolLocal: jest.fn(async () => ({ content: [{ text: 'local-ok' }] })),
    mcpCallTool: jest.fn(async () => ({ content: [{ text: 'remote-ok' }] })),
    callToolViaGateway: jest.fn(async () => ({ result: { content: [{ text: 'gw-ok' }] }, gwAuditTrail: null })),
    http2Bridge: { createHttp2Session: jest.fn(() => ({})), forwardToolCall: jest.fn(async () => ({ content: [] })) },
    buildTokenEvent: jest.fn((id, label, status) => ({ id, label, status })),
    mcpNoBearerResponse: jest.fn(() => ({ status: 401, body: { error: 'no_bearer' } })),
    pingoneAdapter: {
      callTool: jest.fn(async () => ({ content: [{ text: 'p1-ok' }] })),
      getWorkerTokenDecoded: jest.fn(async () => ({ claims: { client_id: 'w1' } })),
    },
    recordMcpToolCall: jest.fn(),
    createPendingDecision: jest.fn(() => ({ taskId: 't' })),
    // Canonical HITL service (3009): the pipeline creates the challenge here on a
    // 428 and maps challengeId → taskId in the response body.
    createHitlChallenge: jest.fn(async () => ({ challengeId: 't', expiresAt: '2026-01-01T00:00:00Z' })),
    decodeAgentId: jest.fn(() => 'agent-1'),
    appEventLog: jest.fn(),
    publishMcpResultToSse: jest.fn(),
    publishTokenEventsToSse: jest.fn(),
    emit: jest.fn(),
    config: {
      introspectionConfigured: false,
      useGateway: false,
      gatewayHttpUrl: '',
      mcpUrl: 'ws://localhost:8080',
      mcpServerUrlEnv: undefined,
      useHttp2: false,
      pingoneAdminEnabled: false,
      pingoneAdminTools: new Set(['listApplications']),
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
  // NOTE: The "PingOne admin tool early-exit" block that used to live here was
  // intentionally removed from mcpToolPipeline.js in commit 992aa6875
  // ("feat(admin-agent): isolate admin agent into separate stack") — the admin
  // agent now calls the hosted PingOne MCP server directly via
  // services/adminAgentService.js and never flows through this pipeline. The
  // two characterization tests that pinned that block's behavior were removed
  // along with it; `listApplications` now just falls through the ordinary
  // remote-tool path like any other tool name.

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
      code: 'missing_exchange_scopes', missingScopes: ['write'],
      userScopes: 'read', requiredScopes: 'write', tokenEvents: [{ id: 'x' }],
    });
    const deps = makeDeps({ resolveMcpAccessTokenWithEvents: jest.fn(async () => { throw err; }) });
    const outcome = await runMcpToolPipeline(makeCtx({ deps }));
    expect(outcome).toMatchObject({
      kind: 'block', httpStatus: 403,
      body: { error: 'missing_exchange_scopes', message: 'need write',
              missingScopes: ['write'], userScopes: 'read',
              requiredScopes: 'write', tokenEvents: [{ id: 'x' }] },
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
    expect(outcome.body.mcpAuthorizeEvaluation).toEqual({
      decision: 'DENY',
      engine: null,
      decisionContext: { x: 1 },
      decisionId: 'd1',
      request: null,
      response: null,
    });
  });

  test('gate block 428 mcp_hitl_required → block + 3009 challenge created, taskId in body', async () => {
    const deps = makeDeps();
    deps.createHitlChallenge = jest.fn(async () => ({ challengeId: 'task-9', expiresAt: '2026-01-01T00:00:00Z' }));
    deps.evaluateMcpFirstToolGate = jest.fn(async () => ({ ran: true, block: { status: 428, body: { error: 'mcp_hitl_required', decisionId: 'd2', decisionContext: { c: 2 }, error_description: 'needs human' } } }));
    const outcome = await runMcpToolPipeline(makeCtx({ deps }));
    expect(outcome.httpStatus).toBe(428);
    // Now creates the challenge in the canonical HITL service (3009), not the
    // in-process pending-decision store. challengeId is surfaced as taskId for
    // the existing UI poller contract.
    expect(deps.createHitlChallenge).toHaveBeenCalledWith(
      expect.objectContaining({ tool: 'get_my_accounts', userId: 'u1' }),
      expect.anything(),
    );
    expect(outcome.body.taskId).toBe('task-9');
    expect(outcome.body.challengeId).toBe('task-9');
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
    deps.getSessionAccessToken = jest.fn(() => 'sess-tok');
    const outcome = await runMcpToolPipeline(makeCtx({ deps }));
    expect(outcome).toMatchObject({ kind: 'error', httpStatus: 401, body: { error: 'token_inactive', need_auth: true } });
  });

  test('remote success via gateway with gwAuditTrail → gw-exchange removed', async () => {
    const deps = makeDeps();
    deps.config = { ...deps.config, useGateway: true, gatewayHttpUrl: 'http://gw' };
    deps.callToolViaGateway = jest.fn(async () => ({
      result: { content: [{ text: 'gw-ok' }] },
      gwAuditTrail: { introspection: { active: true, sub: 'u1' }, authorize: { decision: 'PERMIT' }, exchange: { targetAud: 'mcpserver.ping.demo' } },
    }));
    const outcome = await runMcpToolPipeline(makeCtx({ deps }));
    const ids = outcome.body.tokenEvents.map(e => e.id);
    // gw-exchange token event code was removed — gateway still returns exchange in audit trail, but we don't emit it
    expect(ids).not.toContain('gw-exchange');
  });

  test('remote success via gateway with mcpAudit → gw-mcp-audit token event (5W1H)', async () => {
    const deps = makeDeps();
    deps.config = { ...deps.config, useGateway: true, gatewayHttpUrl: 'http://gw' };
    deps.callToolViaGateway = jest.fn(async () => ({
      result: { content: [{ text: 'gw-ok' }] },
      gwAuditTrail: {
        introspection: { active: true, sub: 'u1' },
        authorize: { decision: 'PERMIT', tool: 'get_balance', method: 'tools/call' },
        mcpAudit: {
          eventName: 'PING-GATEWAY-MCP',
          who: { userSub: 'u1', agentSub: 'agent-1' },
          what: { mcpMethod: 'tools/call', tool: 'get_balance' },
          when: 1700000000000,
          where: { resourceId: 'https://gw/mcp', vertical: 'olb' },
          how: { decision: 'PERMIT', backend: 'real', result: 'forwarded' },
        },
      },
    }));
    const outcome = await runMcpToolPipeline(makeCtx({ deps }));
    expect(outcome.body.tokenEvents.some((e) => e.id === 'gw-mcp-audit')).toBe(true);
    const auditCall = deps.buildTokenEvent.mock.calls.find((c) => c[0] === 'gw-mcp-audit');
    expect(auditCall).toBeTruthy();
    expect(auditCall[5]).toEqual(expect.objectContaining({
      who: expect.objectContaining({ userSub: 'u1', agentSub: 'agent-1' }),
      what: expect.objectContaining({ tool: 'get_balance' }),
      how: expect.objectContaining({ result: 'forwarded', decision: 'PERMIT' }),
    }));
  });
  test('mcp_insufficient_scope thrown by remote → block 403 mcp_scope_denied, NO local fallback', async () => {
    const deps = makeDeps();
    deps.mcpCallTool = jest.fn(async () => { throw Object.assign(new Error('scope'), { code: 'mcp_insufficient_scope', mcpErrorData: { missingScopes: ['write'] } }); });
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

  test('gateway_misconfigured (introspection/lookup infra failure) → block 503 gateway_misconfigured, NOT policy-denied, NO fallback', async () => {
    const deps = makeDeps();
    deps.mcpCallTool = jest.fn(async () => { throw Object.assign(
      new Error('The security gateway could not validate this token (introspection unavailable).'),
      { code: 'gateway_misconfigured', httpStatus: 503 },
    ); });
    const outcome = await runMcpToolPipeline(makeCtx({ deps }));
    expect(outcome).toMatchObject({
      kind: 'block',
      httpStatus: 503,
      body: { error: 'gateway_misconfigured', message: expect.stringContaining('introspection unavailable') },
    });
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

  test('connection error + NO session user → block from mcpNoBearerResponse (remote-fallback no-user)', async () => {
    const deps = makeDeps({
      mcpCallTool: jest.fn(async () => { throw Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' }); }),
      mcpNoBearerResponse: jest.fn(() => ({ status: 401, body: { error: 'no_bearer' } })),
    });
    const ctx = makeCtx({ deps, req: { session: { user: null }, correlationId: 'c1' } });
    const outcome = await runMcpToolPipeline(ctx);
    expect(outcome).toMatchObject({ kind: 'block', httpStatus: 401, body: { error: 'no_bearer' } });
  });

  // ── Coverage gaps closed (final-review follow-up) ──────────────────────────

  test('introspection configured but session token is _cookie_session → block from mcpNoBearerResponse', async () => {
    const deps = makeDeps({ config: { ...makeDeps().config, introspectionConfigured: true } });
    deps.getSessionAccessToken = jest.fn(() => '_cookie_session');
    deps.mcpNoBearerResponse = jest.fn(() => ({ status: 401, body: { error: 'no_bearer', cookieOnly: true } }));
    const outcome = await runMcpToolPipeline(makeCtx({ deps }));
    expect(outcome).toMatchObject({ kind: 'block', httpStatus: 401, body: { error: 'no_bearer', cookieOnly: true } });
    expect(deps.introspectToken).not.toHaveBeenCalled(); // skipped before introspectToken
  });

  test('introspection configured but session token absent → block from mcpNoBearerResponse', async () => {
    const deps = makeDeps({ config: { ...makeDeps().config, introspectionConfigured: true } });
    deps.getSessionAccessToken = jest.fn(() => null);
    deps.mcpNoBearerResponse = jest.fn(() => ({ status: 401, body: { error: 'no_bearer' } }));
    const outcome = await runMcpToolPipeline(makeCtx({ deps }));
    expect(outcome).toMatchObject({ kind: 'block', httpStatus: 401, body: { error: 'no_bearer' } });
    expect(deps.introspectToken).not.toHaveBeenCalled();
  });

  test('introspection endpoint throws → degraded (graceful), proceeds to remote success', async () => {
    const deps = makeDeps({ config: { ...makeDeps().config, introspectionConfigured: true } });
    deps.getSessionAccessToken = jest.fn(() => 'sess-tok');
    deps.introspectToken = jest.fn(async () => { throw new Error('introspect endpoint 503'); });
    deps.mcpCallTool = jest.fn(async () => ({ content: [{ text: 'remote-ok' }] }));
    const outcome = await runMcpToolPipeline(makeCtx({ deps }));
    expect(outcome.kind).toBe('result');
    expect(outcome.httpStatus).toBe(200);
    expect(outcome.body.result).toEqual({ content: [{ text: 'remote-ok' }] });
    // a 'degraded' session-token-introspection event was pushed (graceful degradation, not a hard fail)
    expect(outcome.body.tokenEvents.some(e => e.id === 'session-token-introspection' && e.status === 'degraded')).toBe(true);
  });

  test('MCP server returns _meta.authChallenge + session user → local-fallback result', async () => {
    const deps = makeDeps();
    // authChallenge is published under result._meta (content stays spec-clean) since
    // the content[0].authChallenge mirror was removed in the _meta migration (PR #167).
    deps.mcpCallTool = jest.fn(async () => ({ content: [{ text: 'need auth' }], _meta: { authChallenge: { type: 'redirect', url: 'https://idp/authorize' } } }));
    deps.callToolLocal = jest.fn(async () => ({ content: [{ text: 'local-after-challenge' }] }));
    const outcome = await runMcpToolPipeline(makeCtx({ deps }));
    expect(outcome.kind).toBe('result');
    expect(outcome.httpStatus).toBe(200);
    expect(outcome.body._localFallback).toBe(true);
    expect(outcome.body.result).toEqual({ content: [{ text: 'local-after-challenge' }] });
    expect(deps.callToolLocal).toHaveBeenCalledWith('get_my_accounts', {}, 'u1', expect.any(Object));
  });

  test('gateway_policy_denied WITHOUT hitl_required → block 403 gateway_policy_denied (not 428)', async () => {
    const deps = makeDeps();
    deps.mcpCallTool = jest.fn(async () => { throw Object.assign(new Error('audience mismatch'), { code: 'gateway_policy_denied', gatewayErrorCode: 'aud_invalid' }); });
    const outcome = await runMcpToolPipeline(makeCtx({ deps }));
    expect(outcome.kind).toBe('block');
    expect(outcome.httpStatus).toBe(403);
    expect(outcome.body).toMatchObject({
      error: 'gateway_policy_denied', tool: 'get_my_accounts',
      gatewayErrorCode: 'aud_invalid', message: 'audience mismatch',
    });
    expect(deps.callToolLocal).not.toHaveBeenCalled(); // policy denial does NOT fall back to local
  });
});

// REGRESSION (transfer HTTP-code consistency, 2026-05-18): a transfer that
// needs human approval must surface as HTTP 428 regardless of WHICH internal
// path produced the signal. Before this, the local-fallback path and the
// gateway-result-content path returned HTTP 200 with the hitl signal buried
// in the tool body, while the simulated-Authorize gate returned 428 — same
// outcome, three wire shapes. Phase 170: ALL transfers require consent.
describe('runMcpToolPipeline — HITL/step-up surfaces as 428 on every path (REGRESSION_PLAN §1)', () => {
  test('local-fallback result with error:hitl_required → kind:block httpStatus:428', async () => {
    const scopeErr = Object.assign(new Error('At least one scope must be granted'), { httpStatus: 400 });
    const deps = makeDeps({
      resolveMcpAccessTokenWithEvents: jest.fn(async () => { throw scopeErr; }),
      callToolLocal: jest.fn(async () => ({
        error: 'hitl_required',
        hitl: { type: 'consent' },
        message: 'Confirm this transfer on the dashboard.',
        hitl_threshold_usd: 250,
      })),
    });
    const out = await runMcpToolPipeline(makeCtx({ tool: 'create_transfer', deps }));
    expect(out.kind).toBe('block');
    expect(out.httpStatus).toBe(428);
    expect(out.body.error).toBe('mcp_hitl_required');
    expect(out.body.hitl).toEqual({ type: 'consent' });
    expect(out.body.error_description).toMatch(/dashboard/i);
  });

  test('local-fallback result with error:step_up_required → 428 mcp_step_up_required', async () => {
    const scopeErr = Object.assign(new Error('scope'), { httpStatus: 400 });
    const deps = makeDeps({
      resolveMcpAccessTokenWithEvents: jest.fn(async () => { throw scopeErr; }),
      callToolLocal: jest.fn(async () => ({ error: 'step_up_required', hitl: { type: 'step_up' } })),
    });
    const out = await runMcpToolPipeline(makeCtx({ tool: 'create_transfer', deps }));
    expect(out.kind).toBe('block');
    expect(out.httpStatus).toBe(428);
    expect(out.body.error).toBe('mcp_step_up_required');
  });

  test('gateway success whose result CONTENT is a hitl_required JSON → 428 (not 200)', async () => {
    const deps = makeDeps({
      config: { ...makeDeps().config, useGateway: true, gatewayHttpUrl: 'http://gw' },
      callToolViaGateway: jest.fn(async () => ({
        result: {
          isError: false,
          content: [{ type: 'text', text: JSON.stringify({ error: 'hitl_required', hitl: { type: 'consent' }, amount: 100, type: 'transfer' }) }],
        },
        gwAuditTrail: null,
      })),
    });
    const out = await runMcpToolPipeline(makeCtx({ tool: 'create_transfer', deps }));
    expect(out.kind).toBe('block');
    expect(out.httpStatus).toBe(428);
    expect(out.body.error).toBe('mcp_hitl_required');
    expect(out.body._hitlFromResultContent).toBe(true);
  });

  test('NON-HITL local fallback still returns kind:result httpStatus:200 (no false-positive)', async () => {
    const scopeErr = Object.assign(new Error('scope'), { httpStatus: 400 });
    const deps = makeDeps({
      resolveMcpAccessTokenWithEvents: jest.fn(async () => { throw scopeErr; }),
      callToolLocal: jest.fn(async () => ({ content: [{ text: 'ordinary-ok' }] })),
    });
    const out = await runMcpToolPipeline(makeCtx({ deps }));
    expect(out.kind).toBe('result');
    expect(out.httpStatus).toBe(200);
    expect(out.body._localFallback).toBe(true);
  });

  test('gateway success with ordinary content is NOT misclassified as HITL', async () => {
    const deps = makeDeps({
      config: { ...makeDeps().config, useGateway: true, gatewayHttpUrl: 'http://gw' },
      callToolViaGateway: jest.fn(async () => ({
        result: { isError: false, content: [{ type: 'text', text: JSON.stringify({ balance: 4250 }) }] },
        gwAuditTrail: null,
      })),
    });
    const out = await runMcpToolPipeline(makeCtx({ deps }));
    expect(out.kind).toBe('result');
    expect(out.httpStatus).toBe(200);
  });

  test('gateway 401 with audit trail → error body still carries gw-introspection + gw-authorize events', async () => {
    // token_exchange_failed AFTER a P1AZ PERMIT: the decision + introspection
    // arrive on the thrown error's gwAuditTrail and must reach the token chain.
    const err = Object.assign(new Error('gateway rejected the token'), {
      code: 'GATEWAY_TOKEN_REJECTED', httpStatus: 502,
      gatewayErrorCode: 'token_exchange_failed',
      gwAuditTrail: {
        introspection: { active: true, sub: 'u1', scope: 'gateway:mcp:invoke', client_id: 'f4dd707d' },
        authorize: { decision: 'PERMIT', backend: 'real', url: 'https://api.pingone.com/…/decision', tool: 'get_my_accounts' },
      },
    });
    const deps = makeDeps({
      config: { ...makeDeps().config, useGateway: true, gatewayHttpUrl: 'http://gw' },
      callToolViaGateway: jest.fn(async () => { throw err; }),
    });
    const out = await runMcpToolPipeline(makeCtx({ deps }));
    expect(out.kind).toBe('error');
    const ids = (out.body.tokenEvents || []).map((e) => e.id);
    expect(ids).toContain('gw-introspection');
    expect(ids).toContain('gw-authorize');
    const gwAz = deps.buildTokenEvent.mock.calls.find((c) => c[0] === 'gw-authorize');
    expect(gwAz[2]).toBe('permit');
  });
});
