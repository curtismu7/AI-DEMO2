'use strict';

/**
 * Discovery-before-call: a real MCP client walks initialize → tools/list →
 * tools/call. The chip/direct pipeline historically skipped the tools/list leg
 * (discovery lived only on the launcher's /api/demo-agent/tools route), so the
 * Token Chain's tools-list hop read "notinpath" on every chip run and the run
 * looked like it bypassed the protocol. These tests pin the new behavior:
 *
 *   - the pipeline issues ONE real tools/list through the same gateway
 *     transport the tool call uses, BEFORE the tools/call;
 *   - the discovery result lands in the token chain as a `tools_list_success`
 *     event — the exact vocabulary buildTraceSteps already matches, so the
 *     existing UI card lights up with permitted/denied counts;
 *   - the flag `ff_mcp_discovery_before_call` turns the leg off;
 *   - a discovery failure never blocks the tool call (authorization is
 *     per-call at the gateway, not per-list).
 *
 * The flag is driven via its env alias (FF_MCP_DISCOVERY_BEFORE_CALL), NOT via
 * jest.spyOn on configStore: the global setup afterEach jest.resetModules()s,
 * so a module-captured configStore reference is stale by test 2 while the
 * pipeline requires a fresh instance — the spy never intercepts. Env survives
 * the reset; the generic getEffective tier reads env before the store.
 */

const { runMcpToolPipeline } = require('../../services/mcpToolPipeline');

const FLAG_ENV = 'FF_MCP_DISCOVERY_BEFORE_CALL';
const previousFlagEnv = process.env[FLAG_ENV];

const fakeBuildTokenEvent = (id, label, status, decoded, explanation, extra = {}) => ({
  id, label, status, timestamp: new Date().toISOString(), explanation, ...extra,
});

function baseCtx(over = {}) {
  const deps = {
    resolveMcpAccessTokenWithEvents: jest.fn(async () => ({ token: 'mcp-tok', tokenEvents: [], userSub: 'u1' })),
    callToolViaGateway: jest.fn(async (url, tok, tool, params, opts) => (
      (opts && opts.rpcMethod === 'tools/list')
        ? { result: { tools: [{ name: 'get_account_balance' }, { name: 'create_transfer' }] }, gwAuditTrail: null, gwMcpHandshake: null }
        : { result: { content: [{ type: 'text', text: 'ok' }] }, gwAuditTrail: null, gwMcpHandshake: null }
    )),
    callToolLocal: jest.fn(),
    getSessionAccessToken: jest.fn(() => null),
    introspectToken: jest.fn(),
    mcpNoBearerResponse: jest.fn(() => ({ status: 401, body: { error: 'session_not_hydrated' } })),
    buildTokenEvent: fakeBuildTokenEvent,
    publishTokenEventsToSse: jest.fn(),
    publishMcpResultToSse: jest.fn(),
    recordMcpToolCall: jest.fn(),
    appEventLog: jest.fn(),
    emit: jest.fn(),
    config: {
      useGateway: true,
      gatewayHttpUrl: 'http://ping-gateway:8080',
      introspectionConfigured: false,
      mcpUrl: 'ws://localhost:8080',
      mcpServerUrlEnv: null,
      useHttp2: false,
    },
  };
  const ctx = {
    tool: 'get_account_balance',
    params: {},
    req: { session: { user: { id: 'u1' } }, correlationId: 'corr-1', body: {} },
    deps,
    flowTraceId: 'flow-1',
    startTime: Date.now(),
    useCaseId: 'delegated-access-with-proof',
    vertical: 'banking',
    ...over,
  };
  return { ctx, deps };
}

describe('runMcpToolPipeline — discovery before call (ff_mcp_discovery_before_call)', () => {
  beforeEach(() => {
    process.env[FLAG_ENV] = 'true';
  });
  afterEach(() => {
    if (previousFlagEnv === undefined) delete process.env[FLAG_ENV];
    else process.env[FLAG_ENV] = previousFlagEnv;
  });

  test('runs a real tools/list through the same gateway before tools/call and stamps tools_list_success', async () => {
    const { ctx, deps } = baseCtx();

    const outcome = await runMcpToolPipeline(ctx);

    expect(outcome.kind).toBe('result');
    // Two calls: discovery first, then the tool call.
    expect(deps.callToolViaGateway).toHaveBeenCalledTimes(2);
    const [discUrl, discTok, discTool, discParams, discOpts] = deps.callToolViaGateway.mock.calls[0];
    // The pipeline resolves the gateway base from its routing config when
    // useGateway — deps.config.gatewayHttpUrl is only the non-gateway fallback.
    expect(discUrl).toBe('https://api.ping.demo:3036');
    expect(discTok).toBe('mcp-tok');
    expect(discTool).toBe('get_account_balance'); // routing key, ignored on discovery
    expect(discOpts).toMatchObject({ rpcMethod: 'tools/list' });
    // The tool call still goes out as the real invocation.
    const callOpts = deps.callToolViaGateway.mock.calls[1][4];
    expect(callOpts).not.toHaveProperty('rpcMethod');

    // The token chain gains a tools_list_success event — the type vocabulary
    // buildTraceSteps' existing `tools-list` hop already matches.
    const ev = outcome.body.tokenEvents.find((e) => e.type === 'tools_list_success');
    expect(ev).toBeTruthy();
    expect(ev.permittedCount).toBe(2);
    expect(ev.deniedCount).toBe(0);
    expect(ev.toolNames).toEqual(['get_account_balance', 'create_transfer']);
    expect(deps.publishTokenEventsToSse).toHaveBeenCalledWith(
      'flow-1',
      expect.arrayContaining([expect.objectContaining({ type: 'tools_list_success' })]),
    );
  });

  test('flag off: no discovery leg, no tools_list_success event, tool call unchanged', async () => {
    process.env[FLAG_ENV] = 'false';
    const { ctx, deps } = baseCtx();

    const outcome = await runMcpToolPipeline(ctx);

    expect(deps.callToolViaGateway).toHaveBeenCalledTimes(1);
    expect(deps.callToolViaGateway.mock.calls[0][4]).not.toHaveProperty('rpcMethod');
    expect(outcome.body.tokenEvents.some((e) => e.type === 'tools_list_success')).toBe(false);
  });

  test('discovery failure never blocks the tool call', async () => {
    const { ctx, deps } = baseCtx();
    deps.callToolViaGateway
      .mockImplementationOnce(async () => { throw new Error('gateway discovery blip'); });

    const outcome = await runMcpToolPipeline(ctx);

    expect(outcome.kind).toBe('result');
    expect(deps.callToolViaGateway).toHaveBeenCalledTimes(2);
    expect(outcome.body.tokenEvents.some((e) => e.type === 'tools_list_success')).toBe(false);
  });

  test('gateway handshake on the discovery leg surfaces as mcp-initialize / mcp-initialized events', async () => {
    const { ctx, deps } = baseCtx();
    deps.callToolViaGateway
      .mockImplementationOnce(async () => ({
        result: { tools: [{ name: 'get_account_balance' }] },
        gwAuditTrail: null,
        gwMcpHandshake: {
          initialize: { status: 200, protocolVersion: '2025-11-25', serverInfo: { name: 'banking-mcp-server', version: '1.0.0' } },
          initialized: true,
          sessionId: 'sess-1',
        },
      }));

    const outcome = await runMcpToolPipeline(ctx);

    const init = outcome.body.tokenEvents.find((e) => e.id === 'mcp-initialize');
    expect(init).toBeTruthy();
    expect(init.negotiatedVersion).toBe('2025-11-25');
    expect(init.performedBy).toBe('agent-gateway');
    const inited = outcome.body.tokenEvents.find((e) => e.id === 'mcp-initialized');
    expect(inited).toBeTruthy();
  });

  test('guest public tool (no bearer) skips discovery', async () => {
    const { ctx, deps } = baseCtx();
    // Public tool + no bearer: the guest-public branch. The gateway call there
    // goes out anonymously, still as a tools/call — discovery needs a bearer.
    deps.resolveMcpAccessTokenWithEvents.mockResolvedValue({ token: null, tokenEvents: [], need_auth: true });
    deps.callToolViaGateway
      .mockImplementation(async () => ({ result: { content: [{ type: 'text', text: 'ok' }] }, gwAuditTrail: null, gwMcpHandshake: null }));
    // get_account_balance is not in the public set; swap the tool for one that is.
    ctx.tool = 'get_branch_hours';

    await runMcpToolPipeline(ctx);

    expect(deps.callToolViaGateway).toHaveBeenCalledTimes(1);
    expect(deps.callToolViaGateway.mock.calls[0][4]).not.toHaveProperty('rpcMethod');
  });
});
