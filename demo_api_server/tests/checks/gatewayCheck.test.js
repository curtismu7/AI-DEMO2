'use strict';
jest.mock('../../services/pingGatewayClient', () => ({ callPingGateway: jest.fn() }));
jest.mock('../../services/oauthService', () => ({ performTokenExchange: jest.fn() }));
jest.mock('../../services/configStore', () => ({ getEffective: jest.fn(() => 'gw-aud') }));

const { callPingGateway } = require('../../services/pingGatewayClient');
const oauth = require('../../services/oauthService');
const { realPath } = require('../../services/checks/gatewayCheck');

const ctxWithToken = { flags: { ff_mcp_gateway_pinggateway: true }, req: { session: { oauthTokens: { accessToken: 'user-jwt' } } } };

describe('gatewayCheck.real_path', () => {
  afterEach(() => jest.clearAllMocks());

  // 5f01bc881 made this a severity:'gate' check required for pre-demo READY, so a
  // missing session token FAILS (with a sign-in nextAction) rather than skipping —
  // skipping would let the Demo check report READY without a live user session.
  test('fails without a session token', async () => {
    const r = await realPath.run({ flags: { ff_mcp_gateway_pinggateway: true }, req: { session: {} } });
    expect(r.status).toBe('fail');
    expect(r.detail).toMatch(/no live user session token/i);
    expect(r.nextAction).toMatch(/sign in/i);
  });

  test('passes when all three hops succeed', async () => {
    oauth.performTokenExchange.mockResolvedValue('gw-token');
    callPingGateway
      .mockResolvedValueOnce({ statusCode: 200, body: { active: true } })            // introspect
      .mockResolvedValueOnce({ statusCode: 200, body: { decision: 'PERMIT' } })       // authorize
      .mockResolvedValueOnce({ statusCode: 200, body: { result: { ok: true } } });    // mcp-call
    const r = await realPath.run(ctxWithToken);
    expect(r.status).toBe('pass');
    expect(r.meta.hops.map((h) => h.status)).toEqual(['pass', 'pass', 'pass']);
  });

  test('fails and pinpoints the hop when introspect is not active', async () => {
    oauth.performTokenExchange.mockResolvedValue('gw-token');
    callPingGateway.mockResolvedValueOnce({ statusCode: 200, body: { active: false } });
    const r = await realPath.run(ctxWithToken);
    expect(r.status).toBe('fail');
    expect(r.detail).toMatch(/introspect/i);
  });

  test('fails when token exchange throws', async () => {
    oauth.performTokenExchange.mockRejectedValue(new Error('exchange_failed'));
    const r = await realPath.run(ctxWithToken);
    expect(r.status).toBe('fail');
    expect(r.detail).toMatch(/exchange_failed/);
  });

  test('fails and pinpoints the hop when authorize is not PERMIT', async () => {
    oauth.performTokenExchange.mockResolvedValue('gw-token');
    callPingGateway
      .mockResolvedValueOnce({ statusCode: 200, body: { active: true } })            // introspect
      .mockResolvedValueOnce({ statusCode: 200, body: { decision: 'DENY' } });        // authorize
    const r = await realPath.run(ctxWithToken);
    expect(r.status).toBe('fail');
    expect(r.detail).toMatch(/authorize/i);
  });

  test('fails and pinpoints the hop when mcp-call returns no result', async () => {
    oauth.performTokenExchange.mockResolvedValue('gw-token');
    callPingGateway
      .mockResolvedValueOnce({ statusCode: 200, body: { active: true } })            // introspect
      .mockResolvedValueOnce({ statusCode: 200, body: { decision: 'PERMIT' } })       // authorize
      .mockResolvedValueOnce({ statusCode: 200, body: {} });                          // mcp-call, no result
    const r = await realPath.run(ctxWithToken);
    expect(r.status).toBe('fail');
    expect(r.detail).toMatch(/mcp-call/i);
  });
});
