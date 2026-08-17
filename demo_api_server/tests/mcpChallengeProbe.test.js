'use strict';

jest.mock('axios');
// The probe lazily requires the gateway client only to resolve a base URL; stub
// it so the no-gateway path is reachable without touching configStore/LMDB.
jest.mock('../services/mcpGatewayClient', () => ({ tryGetMcpGatewayHttpUrl: jest.fn(() => null) }));
const axios = require('axios');

const { probeMcpChallenge, parseWwwAuthenticate } = require('../services/mcpChallengeProbe');

const CHALLENGE =
  'Bearer realm="PingOne", resource_metadata="https://gw.example/.well-known/oauth-protected-resource", error="invalid_token", error_description="Bearer token required"';

function makeReq() {
  const events = [];
  return { events, recordTokenEvent: (type, payload) => events.push({ type, ...payload }) };
}
const byType = (req, type) => req.events.find((e) => e.type === type);

describe('parseWwwAuthenticate', () => {
  it('pulls the scheme and every quoted auth-param', () => {
    const parsed = parseWwwAuthenticate(CHALLENGE);
    expect(parsed.scheme).toBe('Bearer');
    expect(parsed.realm).toBe('PingOne');
    expect(parsed.resource_metadata).toBe('https://gw.example/.well-known/oauth-protected-resource');
    expect(parsed.error).toBe('invalid_token');
  });

  it('returns null for a missing or blank header', () => {
    expect(parseWwwAuthenticate(undefined)).toBeNull();
    expect(parseWwwAuthenticate('   ')).toBeNull();
  });
});

describe('probeMcpChallenge', () => {
  beforeEach(() => jest.resetAllMocks());

  it('records the 401 challenge and follows resource_metadata to the RFC 9728 document', async () => {
    axios.post.mockResolvedValue({
      status: 401,
      headers: { 'www-authenticate': CHALLENGE },
      data: { error: 'invalid_token' },
    });
    axios.get.mockResolvedValue({
      status: 200,
      data: {
        resource: 'https://gw.example/mcp',
        authorization_servers: ['https://auth.pingone.com/env/as'],
        scopes_supported: ['mcp:invoke'],
      },
    });

    const req = makeReq();
    const out = await probeMcpChallenge(req, {
      method: 'tools/list',
      phase: 'tools/list',
      gatewayUrl: 'https://gw.example/',
    });

    // The probe must go out with no credential — that omission IS the probe.
    const [url, body, cfg] = axios.post.mock.calls[0];
    expect(url).toBe('https://gw.example/mcp');
    expect(body.method).toBe('tools/list');
    expect(cfg.headers.Authorization).toBeUndefined();

    const challenge = byType(req, 'mcp_challenge');
    expect(challenge.challenged).toBe(true);
    expect(challenge.status).toBe(401);
    expect(challenge.realm).toBe('PingOne');
    expect(challenge.resourceMetadataUrl).toBe('https://gw.example/.well-known/oauth-protected-resource');
    expect(challenge.phase).toBe('tools/list');

    const metadata = byType(req, 'mcp_resource_metadata');
    expect(metadata.authorizationServers).toEqual(['https://auth.pingone.com/env/as']);
    expect(out.status).toBe(401);
    expect(out.events.map((e) => e.type)).toEqual(['mcp_challenge', 'mcp_resource_metadata']);
  });

  it('flags a gateway that lets an anonymous call through instead of asserting the happy path', async () => {
    axios.post.mockResolvedValue({ status: 200, headers: {}, data: { result: { tools: [] } } });

    const req = makeReq();
    await probeMcpChallenge(req, { method: 'tools/call', gatewayUrl: 'https://gw.example' });

    const challenge = byType(req, 'mcp_challenge');
    expect(challenge.challenged).toBe(false);
    expect(challenge.status).toBe(200);
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('swallows a transport failure so the authenticated call that follows still runs', async () => {
    axios.post.mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }));

    const req = makeReq();
    const out = await probeMcpChallenge(req, { method: 'tools/list', gatewayUrl: 'https://gw.example' });
    expect(out.status).toBeNull();
    expect(byType(req, 'mcp_challenge_error').reason).toBe('ECONNREFUSED');
    // The pipeline publishes its own SSE side channel, so the failure has to
    // come back on `events` as well as landing on the request.
    expect(out.events.map((e) => e.type)).toEqual(['mcp_challenge_error']);
  });

  it('records a skip and issues no request when no gateway is configured', async () => {
    // tryGetMcpGatewayHttpUrl is mocked to return null (see jest.mock above).
    const req = makeReq();
    const out = await probeMcpChallenge(req, { method: 'tools/list' });
    expect(out.status).toBeNull();
    expect(byType(req, 'mcp_challenge_skipped').reason).toBe('no_gateway_configured');
    expect(axios.post).not.toHaveBeenCalled();
  });
});
