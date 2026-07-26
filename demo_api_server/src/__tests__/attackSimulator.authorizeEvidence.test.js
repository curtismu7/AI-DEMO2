'use strict';
/**
 * Attack sims that reach PingOne Authorize (UC10 cross-owner, UC13 rogue-actor)
 * are routed through the FULL production pipeline (bffMcpToolExecutor.
 * runPipelineForSim → runMcpToolPipeline: RFC 8693 exchange, BFF-preflight
 * Authorize, real Agent Gateway call) — the same code path a real chip/agent
 * call uses, not a hand-rolled direct token-exchange + gateway shortcut. This
 * asserts the sim (a) calls the tool through that real pipeline with the
 * demo-only `_testActClientId` override, and (b) surfaces the pipeline's real
 * Authorize decision (not the gateway's generic 403 body) as `result.authorize`
 * — the evidence tokenChainTraceStore.ingestAuthorize / computeVerdict need.
 * Mocked at the bffMcpToolExecutor boundary — no live stack.
 */

const mockRunPipelineForSim = jest.fn();

jest.mock('../../services/bffMcpToolExecutor', () => ({
  runPipelineForSim: (...args) => mockRunPipelineForSim(...args),
}));

jest.mock('../../data/store', () => ({
  getAccountById: jest.fn(() => ({ id: '3', userId: '2' })),
}));

const { buildTokenEvent, buildGwAuthorizeEventExtra } = require('../../services/agentMcpTokenService');
const { runAttackSim } = require('../../services/attackSimulatorService');

function fakeJwt(claims) {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${header}.${payload}.`;
}

function makeReq() {
  return { session: { oauthTokens: { accessToken: fakeJwt({ aud: 'api', sub: 'user-1' }) } }, body: {} };
}

/**
 * A pipeline 'block' Outcome shaped the way runMcpToolPipeline really builds
 * it on a gateway_policy_denied (mcpToolPipeline.js's catch branch): a
 * gw-authorize token event built from the gateway's real X-Gw-Audit-Trail.
 */
function gatewayDenyOutcome(tool, authorizeOverrides = {}) {
  const az = {
    decision: 'DENY',
    backend: 'real',
    url: 'https://auth.pingone.com/env/decisionEndpoints/dec-ep',
    tool,
    method: 'tools/call',
    vertical: 'banking',
    parameters: { ActClientId: 'rogue-agent-9f2a-not-allowlisted' },
    rawResponse: { id: 'dec-123', decision: 'DENY' },
    reason: null,
    statements: null,
    ...authorizeOverrides,
  };
  const gwAuthorizeEvent = buildTokenEvent(
    'gw-authorize', 'PingGateway → PingOne Authorize', 'deny', null,
    `PingOne Authorize decision: ${az.decision}`, buildGwAuthorizeEventExtra(az),
  );
  const tokenEvents = [
    buildTokenEvent('user-token', 'User access token', 'active', null, 'issued'),
    buildTokenEvent('exchanged-token', 'Delegated token', 'active', null, 'exchanged'),
    gwAuthorizeEvent,
  ];
  return {
    kind: 'block', httpStatus: 403, tokenEvents,
    body: { error: 'gateway_policy_denied', tool, gatewayErrorCode: 'forbidden', message: 'Gateway policy denied the tool call', tokenEvents },
  };
}

/** Gateway-perimeter deny with NO Authorize hop (aud/scope checked before Authorize). */
function noAuthorizeDenyOutcome() {
  const tokenEvents = [buildTokenEvent('user-token', 'User access token', 'active', null, 'issued')];
  return {
    kind: 'block', httpStatus: 403, tokenEvents,
    body: { error: 'gateway_policy_denied', message: 'Gateway policy denied the tool call', tokenEvents },
  };
}

beforeEach(() => {
  mockRunPipelineForSim.mockReset();
});

describe('attack sims reaching PingOne Authorize run through the full pipeline', () => {
  test('rogue-actor (UC13): calls the real pipeline with the tool + rogue actor override', async () => {
    // req is mutated-then-restored around the call — capture the body AT CALL
    // TIME (mock.calls[0] holds the same live req reference, which reflects
    // the RESTORED state by the time the test inspects it after the await).
    let bodyAtCallTime = null;
    mockRunPipelineForSim.mockImplementation((args) => {
      bodyAtCallTime = { ...args.req.body };
      return Promise.resolve(gatewayDenyOutcome('get_my_accounts'));
    });

    const req = makeReq();
    const result = await runAttackSim('rogue-actor', req);

    expect(mockRunPipelineForSim).toHaveBeenCalledTimes(1);
    const call = mockRunPipelineForSim.mock.calls[0][0];
    expect(call.tool).toBe('get_my_accounts');
    expect(bodyAtCallTime._testActClientId).toBe('rogue-agent-9f2a-not-allowlisted');
    // The override must not leak past the call — req.body is restored.
    expect(req.body._testActClientId).toBeUndefined();
    expect(result.status).toBe(403);
  });

  test('rogue-actor (UC13): result.authorize carries the real DENY + actor-specific reason', async () => {
    mockRunPipelineForSim.mockResolvedValue(gatewayDenyOutcome('get_my_accounts'));

    const result = await runAttackSim('rogue-actor', makeReq());

    expect(result.status).toBe(403);
    expect(result.errorCode).toBe('mcp_invalid_actor');
    expect(result.authorize).toBeTruthy();
    expect(result.authorize.decision).toBe('DENY');
    expect(result.authorize.outcome).toBe('DENY');
    expect(result.authorize.decisionId).toBe('dec-123');
    expect(String(result.authorize.engine)).toMatch(/authorize/i);
    expect(result.reason).not.toBe('Gateway policy denied the tool call');
    expect(result.reason).toMatch(/actor/i);
    // Pipeline's real token events (exchange, gw-authorize) are merged in.
    expect(result.tokenChainEvents.some((e) => e.id === 'exchanged-token')).toBe(true);
    expect(result.tokenChainEvents.some((e) => e.id === 'gw-authorize')).toBe(true);
    // Sign-in step: the user's session token is surfaced as the chain root.
    expect(result.tokenChainEvents.some((e) => e.id === 'user-token')).toBe(true);
  });

  test('cross-owner (UC10): calls the real pipeline with the foreign account id, reason distinct from rogue-actor', async () => {
    mockRunPipelineForSim.mockResolvedValue(
      gatewayDenyOutcome('get_account_balance', { parameters: { account_id: '3' } }),
    );

    const result = await runAttackSim('cross-owner-account', makeReq());

    expect(mockRunPipelineForSim).toHaveBeenCalledTimes(1);
    const call = mockRunPipelineForSim.mock.calls[0][0];
    expect(call.tool).toBe('get_account_balance');
    expect(call.params).toEqual({ account_id: '3' });

    expect(result.status).toBe(403);
    expect(result.errorCode).toBe('resource_owner_mismatch');
    expect(result.authorize).toBeTruthy();
    expect(result.authorize.decision).toBe('DENY');
    expect(result.reason).not.toBe('Gateway policy denied the tool call');
    expect(result.reason).toMatch(/owner|resource/i);
  });

  test('prefers the real PingOne reason string when the audit trail provides one', async () => {
    mockRunPipelineForSim.mockResolvedValue(
      gatewayDenyOutcome('get_my_accounts', { reason: 'HasValidActorChain: actor not allowlisted' }),
    );

    const result = await runAttackSim('rogue-actor', makeReq());

    expect(result.reason).toMatch(/HasValidActorChain/);
  });

  test('gateway-perimeter deny with no Authorize hop leaves authorize unset', async () => {
    mockRunPipelineForSim.mockResolvedValue(noAuthorizeDenyOutcome());

    const result = await runAttackSim('rogue-actor', makeReq());

    expect(result.status).toBe(403);
    expect(result.authorize == null).toBe(true);
  });

  test('cross-owner (UC10): MCP/API ownership error in kind:result is DENY, not unexpected_permit', async () => {
    mockRunPipelineForSim.mockResolvedValue({
      kind: 'result',
      httpStatus: 200,
      tokenEvents: [buildTokenEvent('user-token', 'User access token', 'active', null, 'issued')],
      body: {
        result: {
          isError: true,
          content: [{ type: 'text', text: 'Access denied — not your account' }],
        },
      },
    });

    const result = await runAttackSim('cross-owner-account', makeReq());

    expect(result.status).toBe(403);
    expect(result.errorCode).toBe('resource_owner_mismatch');
    expect(result.tokenChainEvents.some((e) => e.id === 'sim-cross-owner-denied')).toBe(true);
    expect(result.tokenChainEvents.some((e) => e.id === 'sim-gateway-unexpected-permit')).toBe(false);
  });

  test('unexpected permit: pipeline result surfaces a warning, not a silent success', async () => {
    mockRunPipelineForSim.mockResolvedValue({
      kind: 'result', httpStatus: 200,
      tokenEvents: [buildTokenEvent('user-token', 'User access token', 'active', null, 'issued')],
      body: { result: { content: [] } },
    });

    const result = await runAttackSim('rogue-actor', makeReq());

    expect(result.status).toBe(200);
    expect(result.errorCode).toBe('unexpected_permit');
    expect(result.tokenChainEvents.some((e) => e.id === 'sim-gateway-unexpected-permit')).toBe(true);
  });

  test('pipeline_unavailable (deps unwired) surfaces as a real error, not a fabricated deny', async () => {
    mockRunPipelineForSim.mockRejectedValue(Object.assign(new Error('Full MCP pipeline is not wired'), { code: 'pipeline_unavailable' }));

    const result = await runAttackSim('rogue-actor', makeReq());

    expect(result.errorCode).toBe('pipeline_unavailable');
  });
});
