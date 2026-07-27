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

  // The three-hop shape is GONE. It probed /introspect and /authorize as
  // separate endpoints — the Node demo gateway's shape — while appliesWhen gates
  // this check to ff_mcp_gateway_pinggateway === true, i.e. it only ever runs
  // against PingGateway (IG). Probed live on IG: /introspect 404, /authorize
  // 404, /mcp 401, /health 200. The gate could never pass in its own mode.
  // On IG those are FILTERS inside the route chain, not URLs; who decided and
  // what is enforcing is asserted by gateway.posture instead.
  test('passes on a single authenticated tools/call', async () => {
    oauth.performTokenExchange.mockResolvedValue('gw-token');
    callPingGateway.mockResolvedValueOnce({ statusCode: 200, body: { result: { ok: true } } });
    const r = await realPath.run(ctxWithToken);
    expect(r.status).toBe('pass');
    expect(callPingGateway).toHaveBeenCalledTimes(1);
    expect(callPingGateway.mock.calls[0][1]).toBe('/mcp');
    expect(r.meta.hops.map((h) => h.status)).toEqual(['pass']);
  });

  test('does NOT probe /introspect or /authorize (they 404 on IG)', async () => {
    oauth.performTokenExchange.mockResolvedValue('gw-token');
    callPingGateway.mockResolvedValueOnce({ statusCode: 200, body: { result: { ok: true } } });
    await realPath.run(ctxWithToken);
    const paths = callPingGateway.mock.calls.map((c) => c[1]);
    expect(paths).not.toContain('/introspect');
    expect(paths).not.toContain('/authorize');
  });

  test('names the hop when the gateway refuses the token', async () => {
    oauth.performTokenExchange.mockResolvedValue('gw-token');
    callPingGateway.mockResolvedValueOnce({ statusCode: 401, body: {} });
    const r = await realPath.run(ctxWithToken);
    expect(r.status).toBe('fail');
    expect(r.detail).toMatch(/mcp-call/i);
    expect(r.detail).toMatch(/401/);
  });

  test('names the hop when the transport throws, instead of escaping bare', async () => {
    // Unwrapped, a connection error escaped to runChecks and arrived as a bare
    // code with no indication of which hop produced it — observed live as
    // detail:"ECONNREFUSED", and before that as detail:"" .
    oauth.performTokenExchange.mockResolvedValue('gw-token');
    callPingGateway.mockRejectedValueOnce(Object.assign(new Error(''), { code: 'ECONNREFUSED' }));
    const r = await realPath.run(ctxWithToken);
    expect(r.status).toBe('fail');
    expect(r.detail).toMatch(/mcp-call/i);
    expect(r.detail).toMatch(/ECONNREFUSED/);
  });

  test('fails when token exchange throws', async () => {
    oauth.performTokenExchange.mockRejectedValue(new Error('exchange_failed'));
    const r = await realPath.run(ctxWithToken);
    expect(r.status).toBe('fail');
    expect(r.detail).toMatch(/exchange_failed/);
  });

  test('fails when the tool call returns a JSON-RPC error', async () => {
    oauth.performTokenExchange.mockResolvedValue('gw-token');
    callPingGateway.mockResolvedValueOnce({ statusCode: 200, body: { error: { code: -32005, message: 'insufficient_scope' } } });
    const r = await realPath.run(ctxWithToken);
    expect(r.status).toBe('fail');
    expect(r.detail).toMatch(/mcp-call/i);
    expect(r.detail).toMatch(/insufficient_scope/);
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
