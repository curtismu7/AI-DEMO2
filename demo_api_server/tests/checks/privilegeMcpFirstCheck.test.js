'use strict';

/**
 * The demo-killer this guards (plan §2.2): with ff_mcp_gateway_privilege_first
 * ON, every MCP tool call is routed through the Privilege AI Gateway. That hop
 * needs a live Privilege gateway session, and the session is held in BFF memory
 * — a restart, or an expiry nobody watched, silently turns every tool call into
 * an auth failure that looks like a broken gateway rather than a missing sign-in.
 *
 * Three outcomes the check must tell apart, because the remedy differs for each:
 *   warn — nobody is signed in (a human must go and sign in)
 *   fail — signed in, but Privilege refuses (403 = policy missing or expired)
 *   pass — signed in and the app really answers with a tool list
 */

jest.mock('../../services/privilegeGatewaySession');

const privilegeGatewaySession = require('../../services/privilegeGatewaySession');
const { runPrivilegeMcpFirstCheck } = require('../../services/checks/privilegeMcpFirstCheck');

const URL_KEYS = ['MCP_PRIVILEGE_GATEWAY_URL', 'MCP_FACADE_PRIVILEGE_GATEWAY_BASE'];

/** One JSON-RPC reply, shaped the way global.fetch hands it back. */
function fetchReturning({ status = 200, body = {} } = {}) {
  return jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  });
}

describe('gateway.privilege_first', () => {
  const saved = {};
  let realFetch;

  beforeEach(() => {
    jest.clearAllMocks();
    realFetch = global.fetch;
    for (const k of URL_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
    process.env.MCP_PRIVILEGE_GATEWAY_URL = 'https://privilege.example/agent-gateway/mcp';
  });

  afterEach(() => {
    global.fetch = realFetch;
    for (const k of URL_KEYS) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  });

  test('warns — not fails — when no one is signed in, and names the remedy', async () => {
    privilegeGatewaySession.status.mockReturnValue({ ready: false, reason: 'no_session' });
    global.fetch = fetchReturning();

    const out = await runPrivilegeMcpFirstCheck();

    expect(out.status).toBe('warn');
    // An absent session is an operator action, not a broken system: a fail here
    // would send someone debugging the gateway instead of signing in.
    expect(out.nextAction).toMatch(/sign in/i);
    // Must not have dialled the gateway with no credential.
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('warns when the session exists but has expired beyond refresh', async () => {
    privilegeGatewaySession.status.mockReturnValue({ ready: false, reason: 'expired' });
    global.fetch = fetchReturning();

    const out = await runPrivilegeMcpFirstCheck();

    expect(out.status).toBe('warn');
    expect(out.detail).toMatch(/expired/i);
  });

  test('fails with the policy remedy on 403', async () => {
    privilegeGatewaySession.status.mockReturnValue({ ready: true });
    privilegeGatewaySession.getAccessToken.mockResolvedValue('tok-abc');
    global.fetch = fetchReturning({ status: 403, body: { error: 'forbidden' } });

    const out = await runPrivilegeMcpFirstCheck();

    expect(out.status).toBe('fail');
    // The exact string the plan specifies — a bare 403 is indistinguishable
    // from a dead gateway unless the check says which one it is.
    expect(out.detail).toContain('Privilege policy missing or expired for app agent-gateway');
  });

  test('passes when an authenticated tools/list returns at least one tool', async () => {
    privilegeGatewaySession.status.mockReturnValue({ ready: true });
    privilegeGatewaySession.getAccessToken.mockResolvedValue('tok-abc');
    global.fetch = fetchReturning({
      status: 200,
      body: { jsonrpc: '2.0', id: 1, result: { tools: [{ name: 'get_weather' }, { name: 'brave_search' }] } },
    });

    const out = await runPrivilegeMcpFirstCheck();

    expect(out.status).toBe('pass');
    expect(out.detail).toMatch(/2 tool/);

    // The probe must be a real authenticated MCP JSON-RPC tools/list.
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe('https://privilege.example/agent-gateway/mcp');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tok-abc');
    expect(JSON.parse(init.body).method).toBe('tools/list');
  });

  test('fails when the app answers 200 but exposes no tools', async () => {
    privilegeGatewaySession.status.mockReturnValue({ ready: true });
    privilegeGatewaySession.getAccessToken.mockResolvedValue('tok-abc');
    global.fetch = fetchReturning({ status: 200, body: { result: { tools: [] } } });

    const out = await runPrivilegeMcpFirstCheck();

    expect(out.status).toBe('fail');
    expect(out.detail).toMatch(/no tools/i);
  });

  test('warns when the flag is on but no Privilege URL is configured', async () => {
    // getMcpGatewayHttpUrl() logs and falls through to the next lane in exactly
    // this case, so the posture run must say so rather than dial `undefined`.
    for (const k of URL_KEYS) delete process.env[k];
    privilegeGatewaySession.status.mockReturnValue({ ready: true });
    global.fetch = fetchReturning();

    const out = await runPrivilegeMcpFirstCheck();

    expect(out.status).toBe('warn');
    expect(out.detail).toMatch(/MCP_PRIVILEGE_GATEWAY_URL/);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
