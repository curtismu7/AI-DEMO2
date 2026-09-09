'use strict';
/**
 * UC30 signed out (2026-09-08 Demo Steps review): auth-requirements.json
 * declares the weather chip public and PingGateway's /mcp/weather route has
 * no auth filter, but this pipeline always ran the RFC 8693 exchange — so a
 * guest died at the no-bearer gate ("Sign in to use the banking agent") before
 * the gateway was called. A public tool with NO session now skips exchange,
 * introspection and the BFF pre-flight and calls the gateway anonymously; every
 * other tool, and the same tool with a session, is unchanged.
 *
 * makeDeps()/makeCtx() follow mcpToolPipeline.introspectionNotConfigured.test.js.
 */
const { runMcpToolPipeline } = require('../services/mcpToolPipeline');

function makeDeps(over = {}) {
  return {
    // What agentMcpTokenService returns for a session with no bearer at all.
    resolveMcpAccessTokenWithEvents: jest.fn(async () => ({
      token: null, tokenEvents: [], userSub: null, need_auth: true, exchange_mode: '1-token', tratContextHeader: null,
    })),
    evaluateMcpFirstToolGate: jest.fn(async () => ({ ran: true, permit: true, evaluation: { decision: 'PERMIT' } })),
    getSessionAccessToken: jest.fn(() => null),
    introspectToken: jest.fn(async () => ({ active: true })),
    callToolLocal: jest.fn(async () => ({ content: [{ text: 'local-ok' }] })),
    mcpCallTool: jest.fn(async () => ({ content: [{ text: 'remote-ok' }] })),
    callToolViaGateway: jest.fn(async () => ({ result: { content: [{ type: 'text', text: 'Clear, 82F' }] }, gwAuditTrail: {} })),
    http2Bridge: { createHttp2Session: jest.fn(() => ({})), forwardToolCall: jest.fn(async () => ({ content: [] })) },
    buildTokenEvent: jest.fn((id, label, status, _t, detail, extra) => ({ id, label, status, detail, extra })),
    mcpNoBearerResponse: jest.fn(() => ({ status: 401, body: { error: 'authentication_required' } })),
    recordMcpToolCall: jest.fn(),
    createPendingDecision: jest.fn(() => ({ taskId: 't' })),
    createHitlChallenge: jest.fn(async () => ({ challengeId: 't', expiresAt: '2026-01-01T00:00:00Z' })),
    decodeAgentId: jest.fn(() => 'agent-1'),
    appEventLog: jest.fn(),
    publishMcpResultToSse: jest.fn(),
    publishTokenEventsToSse: jest.fn(),
    emit: jest.fn(),
    config: {
      introspectionConfigured: true,
      useGateway: true,
      gatewayHttpUrl: 'https://gw.local',
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
    tool: 'get_weather',
    params: { city_name: 'Austin, TX' },
    flowTraceId: 'ft-1',
    startTime: Date.now(),
    // A guest: no session user, no bearer.
    req: { session: {}, sessionID: 'guest-sess', correlationId: 'c1', body: { vertical: 'sporting-goods', useCaseId: 'weather-mcp-texas-permit' } },
    deps: makeDeps(over.deps || {}),
    ...over,
  };
}

describe('runMcpToolPipeline — public tool with no session', () => {
  test('get_weather signed out: no exchange, gateway called with no bearer, result returned', async () => {
    const deps = makeDeps();
    const out = await runMcpToolPipeline(makeCtx({ deps }));

    expect(out.kind).toBe('result');
    expect(deps.mcpNoBearerResponse).not.toHaveBeenCalled();
    expect(deps.introspectToken).not.toHaveBeenCalled();
    expect(deps.evaluateMcpFirstToolGate).not.toHaveBeenCalled();
    expect(deps.callToolViaGateway).toHaveBeenCalledTimes(1);
    expect(deps.callToolViaGateway.mock.calls[0][1]).toBeFalsy(); // bearer
    expect(deps.callToolViaGateway.mock.calls[0][2]).toBe('get_weather');
    expect(deps.emit).toHaveBeenCalledWith({ phase: 'public_tool_no_session', tool: 'get_weather' });
    const skipped = deps.buildTokenEvent.mock.calls.find((c) => c[0] === 'token-exchange');
    expect(skipped[2]).toBe('skipped');
  });

  test('a protected tool signed out is still refused at the bearer gate', async () => {
    const deps = makeDeps();
    const out = await runMcpToolPipeline(makeCtx({ deps, tool: 'get_my_accounts', params: {} }));

    expect(out.kind).toBe('block');
    expect(out.httpStatus).toBe(401);
    expect(deps.mcpNoBearerResponse).toHaveBeenCalledTimes(1);
    expect(deps.callToolViaGateway).not.toHaveBeenCalled();
  });

  test('get_weather WITH a session takes the normal exchange path', async () => {
    const deps = makeDeps({
      resolveMcpAccessTokenWithEvents: jest.fn(async () => ({ token: 'gw-tok', tokenEvents: [], userSub: 'u1' })),
      getSessionAccessToken: jest.fn(() => 'sess-tok'),
    });
    const out = await runMcpToolPipeline(makeCtx({
      deps,
      req: { session: { user: { id: '1', oauthId: 'u1' } }, sessionID: 's1', correlationId: 'c1', body: { vertical: 'sporting-goods' } },
    }));

    expect(out.kind).toBe('result');
    expect(deps.introspectToken).toHaveBeenCalledTimes(1);
    expect(deps.callToolViaGateway.mock.calls[0][1]).toBe('gw-tok');
    expect(deps.emit).not.toHaveBeenCalledWith(expect.objectContaining({ phase: 'public_tool_no_session' }));
  });
});
