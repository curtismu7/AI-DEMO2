'use strict';

// RFC 8693 exchange for the façade's next hop.
//
// oauth-mcp refuses a forwarded gateway-audience token on purpose
// (auth/lastHopAuthorization.ts): "D-05 violation: gateway-audience token
// cannot be used at upstream. The gateway must perform RFC 8693 exchange
// before forwarding." That refusal is the invariant the demo exists to show —
// a per-hop token must not skip a hop — so the fix is to do what it asks.
//
// The subtle part these tests pin: MCP_SERVER_RESOURCE_URI lists SEVERAL
// accepted audiences and includes the gateway audience, so "matches the list"
// is not the bar. Rule 1 rejects any token still carrying the gateway audience,
// which is why the exchange requests ONE specific audience.

const axios = require('axios');

jest.mock('axios', () => ({ post: jest.fn() }));
jest.mock('../../services/configStore', () => ({ getEffective: () => undefined }));

const svc = require('../../services/facadeUpstreamExchange');

const ENV = '01d89b06-66d5-430e-9f28-65636843788b';
const TOKEN_URL = `https://auth.pingone.com/${ENV}/as/token`;
const UPSTREAM_AUD = 'mcpserver.ping.demo';
const AGENT_GATEWAY_AUD = 'agentgateway.ping.demo';
const MCP_GATEWAY_AUD = 'mcpgateway.ping.demo';

describe('facade upstream token exchange', () => {
  const saved = {};

  beforeEach(() => {
    saved.env = process.env.PINGONE_ENVIRONMENT_ID;
    saved.cid = process.env.PINGONE_MCP_GATEWAY_CLIENT_ID;
    saved.sec = process.env.PINGONE_MCP_GATEWAY_CLIENT_SECRET;
    saved.region = process.env.PINGONE_REGION;
    saved.agentId = process.env.PINGONE_TOKEN_EXCHANGER_CLIENT_ID;
    saved.agentSecret = process.env.PINGONE_TOKEN_EXCHANGER_CLIENT_SECRET;
    saved.facadeAgentGatewayResource = process.env.MCP_FACADE_AGENT_GATEWAY_RESOURCE_URI;
    process.env.PINGONE_ENVIRONMENT_ID = ENV;
    process.env.PINGONE_MCP_GATEWAY_CLIENT_ID = '6586d3de-b916-454c-84e5-6d21b572a534';
    process.env.PINGONE_MCP_GATEWAY_CLIENT_SECRET = 'shhh';
    process.env.PINGONE_REGION = 'com';
    process.env.PINGONE_TOKEN_EXCHANGER_CLIENT_ID = 'exchanger-client';
    process.env.PINGONE_TOKEN_EXCHANGER_CLIENT_SECRET = 'exchanger-secret';
    process.env.MCP_FACADE_AGENT_GATEWAY_RESOURCE_URI = MCP_GATEWAY_AUD;
    svc.__test.cache.clear();
  });

  afterEach(() => {
    const pairs = [
      ['PINGONE_ENVIRONMENT_ID', saved.env],
      ['PINGONE_MCP_GATEWAY_CLIENT_ID', saved.cid],
      ['PINGONE_MCP_GATEWAY_CLIENT_SECRET', saved.sec],
      ['PINGONE_REGION', saved.region],
      ['PINGONE_TOKEN_EXCHANGER_CLIENT_ID', saved.agentId],
      ['PINGONE_TOKEN_EXCHANGER_CLIENT_SECRET', saved.agentSecret],
      ['MCP_FACADE_AGENT_GATEWAY_RESOURCE_URI', saved.facadeAgentGatewayResource],
    ];
    for (const [k, v] of pairs) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  test('requests ONE audience — naming the list would leave the gateway audience on the token', async () => {
    axios.post.mockResolvedValue({ data: { access_token: 'exchanged', expires_in: 300 } });

    const out = await svc.exchangeForUpstream('caller-token', UPSTREAM_AUD, ['read']);
    expect(out.accessToken).toBe('exchanged');
    expect(out.cached).toBe(false);

    const [url, bodyStr] = axios.post.mock.calls[0];
    expect(url).toBe(TOKEN_URL);
    const body = new URLSearchParams(bodyStr);
    expect(body.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:token-exchange');
    expect(body.get('subject_token')).toBe('caller-token');
    expect(body.get('subject_token_type')).toBe('urn:ietf:params:oauth:token-type:access_token');
    expect(body.get('audience')).toBe(UPSTREAM_AUD);
    expect(body.get('scope')).toBe('read');
    // client_secret_POST: measured — basic is refused by this client with
    // `invalid_client: Unsupported authentication method`.
    expect(body.get('client_secret')).toBe('shhh');
  });

  test('caches per (subject token, audience) so a tools/call storm mints one token', async () => {
    axios.post.mockResolvedValue({ data: { access_token: 'exchanged', expires_in: 300 } });

    const first = await svc.exchangeForUpstream('caller-token', UPSTREAM_AUD);
    const second = await svc.exchangeForUpstream('caller-token', UPSTREAM_AUD);
    expect(axios.post).toHaveBeenCalledTimes(1);
    // The trace distinguishes a real mint from a cache hit, so the demo does
    // not claim an exchange happened on every JSON-RPC message.
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
  });

  test('a DIFFERENT caller never receives the cached token', async () => {
    axios.post.mockResolvedValueOnce({ data: { access_token: 'for-alice', expires_in: 300 } });
    axios.post.mockResolvedValueOnce({ data: { access_token: 'for-bob', expires_in: 300 } });

    expect((await svc.exchangeForUpstream('alice-token', UPSTREAM_AUD)).accessToken).toBe('for-alice');
    expect((await svc.exchangeForUpstream('bob-token', UPSTREAM_AUD)).accessToken).toBe('for-bob');
    expect(axios.post).toHaveBeenCalledTimes(2);
  });

  test('a different audience is a different cache entry', async () => {
    axios.post.mockResolvedValue({ data: { access_token: 'x', expires_in: 300 } });

    await svc.exchangeForUpstream('caller-token', UPSTREAM_AUD);
    await svc.exchangeForUpstream('caller-token', 'other.ping.demo');
    expect(axios.post).toHaveBeenCalledTimes(2);
  });

  test('THROWS rather than returning the original token — silently forwarding it is the bypass D-05 catches', async () => {
    const err = new Error('bad');
    err.response = { status: 400, data: { error: 'invalid_grant' } };
    axios.post.mockRejectedValue(err);

    await expect(svc.exchangeForUpstream('caller-token', UPSTREAM_AUD)).rejects.toThrow();
    await expect(svc.exchangeForUpstream('caller-token', UPSTREAM_AUD)).rejects.not.toThrow(/caller-token/);
  });

  test('unconfigured is reported as such, not as a generic failure', async () => {
    delete process.env.PINGONE_MCP_GATEWAY_CLIENT_SECRET;
    expect(svc.isConfigured()).toBe(false);
    await expect(svc.exchangeForUpstream('caller-token', UPSTREAM_AUD))
      .rejects.toThrow(/PINGONE_MCP_GATEWAY_CLIENT_SECRET/);
  });

  test('a response with no access_token is an error, not an undefined bearer', async () => {
    axios.post.mockResolvedValue({ data: {} });
    await expect(svc.exchangeForUpstream('caller-token', UPSTREAM_AUD)).rejects.toThrow(/no access_token/);
  });

  test('mints an AI-agent actor token, then exchanges the caller for an act-bearing gateway token', async () => {
    axios.post
      .mockResolvedValueOnce({ data: { access_token: 'agent-cc', expires_in: 300 } })
      .mockResolvedValueOnce({ data: { access_token: 'delegated-gateway', expires_in: 300 } });

    const out = await svc.exchangeForAgentGateway('caller-token', ['mcp:invoke', 'write', 'transfer']);

    expect(out).toEqual({ accessToken: 'delegated-gateway', cached: false });
    expect(axios.post).toHaveBeenCalledTimes(2);

    const actorBody = new URLSearchParams(axios.post.mock.calls[0][1]);
    expect(actorBody.get('grant_type')).toBe('client_credentials');
    expect(actorBody.get('client_id')).toBe('exchanger-client');
    expect(actorBody.get('client_secret')).toBe('exchanger-secret');
    expect(actorBody.get('audience')).toBe(AGENT_GATEWAY_AUD);
    expect(actorBody.get('scope')).toBe('agent:invoke');

    const exchangeBody = new URLSearchParams(axios.post.mock.calls[1][1]);
    expect(exchangeBody.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:token-exchange');
    expect(exchangeBody.get('subject_token')).toBe('caller-token');
    expect(exchangeBody.get('actor_token')).toBe('agent-cc');
    expect(exchangeBody.get('audience')).toBe(MCP_GATEWAY_AUD);
    expect(exchangeBody.get('resource')).toBeNull();
    expect(exchangeBody.get('scope')).toBe('mcp:invoke write transfer');
    expect(exchangeBody.get('client_id')).toBe('exchanger-client');
    expect(exchangeBody.get('client_secret')).toBe('exchanger-secret');
  });

  test('caches the delegated gateway token without re-minting the actor', async () => {
    axios.post
      .mockResolvedValueOnce({ data: { access_token: 'agent-cc', expires_in: 300 } })
      .mockResolvedValueOnce({ data: { access_token: 'delegated-gateway', expires_in: 300 } });

    const first = await svc.exchangeForAgentGateway('caller-token', ['mcp:invoke', 'write']);
    const second = await svc.exchangeForAgentGateway('caller-token', ['mcp:invoke', 'write']);

    expect(axios.post).toHaveBeenCalledTimes(2);
    expect(first.cached).toBe(false);
    expect(second).toEqual({ accessToken: 'delegated-gateway', cached: true });
  });

  test('defaults the exchanged token to the local MCP gateway resource', async () => {
    delete process.env.MCP_FACADE_AGENT_GATEWAY_RESOURCE_URI;
    axios.post
      .mockResolvedValueOnce({ data: { access_token: 'agent-cc', expires_in: 300 } })
      .mockResolvedValueOnce({ data: { access_token: 'delegated-gateway', expires_in: 300 } });

    await svc.exchangeForAgentGateway('caller-token', ['mcp:invoke']);

    const exchangeBody = new URLSearchParams(axios.post.mock.calls[1][1]);
    expect(exchangeBody.get('audience')).toBe(MCP_GATEWAY_AUD);
  });
});
