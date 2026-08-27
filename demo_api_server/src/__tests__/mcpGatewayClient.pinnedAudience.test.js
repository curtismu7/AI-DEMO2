'use strict';

/**
 * @file mcpGatewayClient.pinnedAudience.test.js
 * @description The expected audience must follow the PIN, not the routing mode.
 *
 * mcpGatewayClient pins certain bearers away from PingGateway to the Node Demo
 * Agent Gateway — native ID-JAG bearers (aud = oauth-mcp's own resource) and A2A
 * nested-act bearers (aud = the A2A gateway resource). PingGateway rejects both
 * audiences; the Node gateway accepts them.
 *
 * The audience classifier resolved `expectedAud` from
 * resolveExpectedMcpResourceUri(), which answers "what does the active ROUTING
 * MODE expect". Under ff_mcp_gateway_pinggateway that is PingGateway's resource
 * URI — so a correctly-pinned bearer was failed GATEWAY_AUDIENCE_MISMATCH against
 * a gateway it had deliberately been routed away from, and the call never left
 * the BFF. Observed live 2026-08-26 on a real get_account_balance turn:
 *
 *   Wrong audience: the access token's aud is [mcpserver.ping.demo]
 *   but the gateway requires "https://api.ping.demo:3036/mcp"
 *
 * ...while the Node gateway's own MCP_GW_RESOURCE_URI listed mcpserver.ping.demo.
 *
 * A pin only fires when the bearer's aud ALREADY contains the pin audience, so
 * that audience is by construction correct for the destination.
 * See TECH_DEBT 2026-08-23 (native ID-JAG / D-05).
 */

jest.mock('axios');

const mockConfig = {};
jest.mock('../../services/configStore', () => ({
  get: jest.fn(() => null),
  getEffective: jest.fn((k) => (k in mockConfig ? mockConfig[k] : null)),
}));

// Stands in for PingGateway-routing mode: the mode-based resolver always answers
// with PingGateway's resource URI, which is exactly what must NOT win once pinned.
const PINGGATEWAY_AUD = 'https://api.ping.demo:3036/mcp';
jest.mock('../../services/mcpToolAuthorizationService', () => ({
  resolveExpectedMcpResourceUri: jest.fn(() => 'https://api.ping.demo:3036/mcp'),
  resolveExpectedMcpResourceSetting: jest.fn(() => ({
    mode: 'pinggateway', settingKey: 'pingone_resource_pinggateway_uri', envVar: 'PINGONE_RESOURCE_PINGGATEWAY_URI',
  })),
}));

const axios = require('axios');
const { callToolViaGateway } = require('../../services/mcpGatewayClient');

const PG_URL = 'http://ping-gateway:8080';
const NODE_URL = 'http://mcp-gateway:3005';
const OLB_AUD = 'mcpserver.ping.demo';
const A2A_AUD = 'mcpgateway-a2a.ping.demo';

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwtWithAud = (aud) =>
  `${b64u({ alg: 'none', typ: 'JWT' })}.${b64u({ aud, sub: 'user1', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;

const ENV_KEYS = [
  'MCP_PINGGATEWAY_URL', 'MCP_DEMO_GATEWAY_URL', 'PINGONE_RESOURCE_MCP_SERVER_URI',
  'A2A_GATEWAY_AUDIENCE', 'PINGONE_RESOURCE_MCP_GATEWAY_URI', 'MCP_GW_RESOURCE_URI',
];
let saved;

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  for (const k of Object.keys(mockConfig)) delete mockConfig[k];

  // PingGateway routing: the caller resolved PingGateway as the base.
  process.env.MCP_PINGGATEWAY_URL = PG_URL;
  process.env.MCP_DEMO_GATEWAY_URL = NODE_URL;
  process.env.PINGONE_RESOURCE_MCP_SERVER_URI = OLB_AUD;
  process.env.A2A_GATEWAY_AUDIENCE = A2A_AUD;

  // Any 401 — the point is how it gets CLASSIFIED, not what the gateway said.
  axios.post = jest.fn().mockResolvedValue({
    status: 401, headers: {}, data: { error: 'invalid_token', message: 'Invalid or expired token' },
  });
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const callWith = (token) => callToolViaGateway(PG_URL, token, 'get_account_balance', {}, {});

describe('expected audience follows the pin, not the routing mode', () => {
  it('sends a pinned native ID-JAG bearer to the Node gateway, not PingGateway', async () => {
    await callWith(jwtWithAud(OLB_AUD)).catch(() => {});
    expect(axios.post).toHaveBeenCalled();
    expect(axios.post.mock.calls[0][0]).toBe(`${NODE_URL}/mcp`);
  });

  // The regression: this used to be GATEWAY_AUDIENCE_MISMATCH against PingGateway.
  it('does NOT classify a pinned ID-JAG bearer as a wrong-audience mismatch', async () => {
    const err = await callWith(jwtWithAud(OLB_AUD)).catch((e) => e);
    expect(err.code).not.toBe('GATEWAY_AUDIENCE_MISMATCH');
    expect(err.message).not.toContain(PINGGATEWAY_AUD);
    // It is a plain 401 from the destination, so the honest classification is
    // "the gateway rejected this token", not "your config drifted" — the latter
    // sends an operator off to fix a setting that is already correct.
    expect(err.code).toBe('GATEWAY_TOKEN_REJECTED');
  });

  it('does NOT classify a pinned A2A bearer as a wrong-audience mismatch', async () => {
    const err = await callWith(jwtWithAud(A2A_AUD)).catch((e) => e);
    expect(err.code).not.toBe('GATEWAY_AUDIENCE_MISMATCH');
    expect(err.message).not.toContain(PINGGATEWAY_AUD);
  });

  // Not pinned: the mode's audience is still the right thing to judge against,
  // so the existing PingGateway behaviour must be untouched.
  it('still reports a genuine mismatch for an UNPINNED bearer on the PingGateway path', async () => {
    const err = await callWith(jwtWithAud('some-other-resource')).catch((e) => e);
    expect(err.code).toBe('GATEWAY_AUDIENCE_MISMATCH');
    expect(err.message).toContain(PINGGATEWAY_AUD);
  });

  // The silent no-op case: with no Node URL the pin cannot move `base`, so the
  // request really does go to PingGateway and PingGateway's audience applies.
  it('keeps the mode audience when the pin could not move the request', async () => {
    delete process.env.MCP_DEMO_GATEWAY_URL;
    mockConfig.mcp_demo_gateway_url = '';
    const err = await callWith(jwtWithAud(OLB_AUD)).catch((e) => e);
    expect(axios.post.mock.calls[0][0]).toBe(`${PG_URL}/mcp`);
    expect(err.code).toBe('GATEWAY_AUDIENCE_MISMATCH');
  });
});
