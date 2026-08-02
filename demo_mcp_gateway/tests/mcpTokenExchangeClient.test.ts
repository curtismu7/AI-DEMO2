'use strict';
import axios from 'axios';
import { McpTokenExchangeClient } from '../src/auth/McpTokenExchangeClient';
import type { GatewayConfig } from '../src/config';

jest.mock('axios');
const mockedPost = axios.post as jest.Mock;

const config = {
  tokenEndpoint: 'https://auth.example/as/token',
  tokenEndpointAuthMethod: 'post',
  clientId: 'gw-client',
  clientSecret: 'gw-secret',
  mcpOlbResourceUri: 'mcpserver.ping.demo',
  mcpResourceServerResourceUri: 'mcp-resource-server.ping.demo',
} as unknown as GatewayConfig;

// Subject token with scopes: read + invest:read + something foreign
const subjectToken = [
  Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'),
  Buffer.from(JSON.stringify({ sub: 'u1', scope: 'read invest:read mcp:invoke' })).toString('base64url'),
  '',
].join('.');

beforeEach(() => {
  mockedPost.mockReset();
  McpTokenExchangeClient.clearCache();
  mockedPost.mockResolvedValue({ data: { access_token: 'exchanged-tok', expires_in: 300 } });
});

describe('McpTokenExchangeClient', () => {
  it('sends RFC 8707 resource= (not audience=) and explicit scope filtered to the target resource', async () => {
    const client = new McpTokenExchangeClient(config);
    const result = await client.exchange(subjectToken, 'get_my_accounts');
    expect(result).toMatchObject({ token: 'exchanged-tok', targetAud: 'mcpserver.ping.demo', cached: false });
    // calls[0] is the gateway's client_credentials actor-token mint (F10);
    // calls[1] is the token exchange itself.
    const sentBody = String(mockedPost.mock.calls[1][1]);
    const params = new URLSearchParams(sentBody);
    expect(params.get('resource')).toBe('mcpserver.ping.demo');
    expect(params.get('audience')).toBeNull();
    const scopes = (params.get('scope') || '').split(' ');
    // Invariant: requested scope ⊆ (subject scopes ∩ target-resource scopes).
    // Per scope-topology.json, "Super Banking MCP Server" (mcpserver.ping.demo)
    // carries mcp:invoke natively and mirrors read + invest:read (among others)
    // — all three subject scopes survive the intersection, so the exact
    // requested set is these three (verified against the real manifest).
    expect(scopes.sort()).toEqual(['invest:read', 'mcp:invoke', 'read']);
  });

  it('exchangeForBackend targets the requested backend audience', async () => {
    const client = new McpTokenExchangeClient(config);
    const result = await client.exchangeForBackend(subjectToken, 'olb');
    expect(result.targetAud).toBe('mcpserver.ping.demo');
  });

  it('returns cached=true on the second identical exchange', async () => {
    const client = new McpTokenExchangeClient(config);
    await client.exchange(subjectToken, 'get_my_accounts');
    const second = await client.exchange(subjectToken, 'get_my_accounts');
    expect(second.cached).toBe(true);
    // One actor-token mint + one exchange. The second exchange is served from
    // cache, and the actor token is cached too, so neither repeats.
    expect(mockedPost).toHaveBeenCalledTimes(2);
  });

  it('propagates exchange failure (callers fail closed)', async () => {
    mockedPost.mockRejectedValue(new Error('invalid_scope'));
    const client = new McpTokenExchangeClient(config);
    await expect(client.exchange(subjectToken, 'get_my_accounts')).rejects.toThrow();
  });
});

/**
 * F10 — the actor chain was asserted at the gateway and then DROPPED at the last
 * hop. Exchange #3 sent no `actor_token`, so whatever `act` reached the MCP server
 * was only whatever the AS chose to copy: the gateway proved the delegation chain
 * and then failed to re-bind itself into it.
 *
 * RFC 8693 §2.1: actor_token identifies the party acting on behalf of the subject,
 * and actor_token_type is REQUIRED when actor_token is present.
 */
describe('McpTokenExchangeClient — F10 actor_token on Exchange #3', () => {
  /** First call = the gateway's client_credentials mint; second = the exchange. */
  function mockCcThenExchange() {
    mockedPost.mockReset();
    McpTokenExchangeClient.clearCache();
    mockedPost
      .mockResolvedValueOnce({ data: { access_token: 'gw-cc-token', expires_in: 300 } })
      .mockResolvedValueOnce({ data: { access_token: 'exchanged-tok', expires_in: 300 } });
  }

  const exchangeBody = () => new URLSearchParams(String(mockedPost.mock.calls[1][1]));

  it('sends the gateway\'s own client-credentials token as actor_token', async () => {
    mockCcThenExchange();
    const client = new McpTokenExchangeClient(config);
    await client.exchange(subjectToken, 'get_my_accounts');
    expect(exchangeBody().get('actor_token')).toBe('gw-cc-token');
  });

  it('sends the RFC 8693 actor_token_type alongside it', async () => {
    mockCcThenExchange();
    const client = new McpTokenExchangeClient(config);
    await client.exchange(subjectToken, 'get_my_accounts');
    expect(exchangeBody().get('actor_token_type'))
      .toBe('urn:ietf:params:oauth:token-type:access_token');
  });

  it('still sends the subject token and resource unchanged', async () => {
    mockCcThenExchange();
    const client = new McpTokenExchangeClient(config);
    await client.exchange(subjectToken, 'get_my_accounts');
    const p = exchangeBody();
    expect(p.get('subject_token')).toBe(subjectToken);
    expect(p.get('resource')).toBe('mcpserver.ping.demo');
    expect(p.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:token-exchange');
  });

  it('mints the client-credentials token with grant_type=client_credentials', async () => {
    mockCcThenExchange();
    const client = new McpTokenExchangeClient(config);
    await client.exchange(subjectToken, 'get_my_accounts');
    const cc = new URLSearchParams(String(mockedPost.mock.calls[0][1]));
    expect(cc.get('grant_type')).toBe('client_credentials');
  });

  it('mints the actor token with a single RFC 8707 resource= (first gateway URI)', async () => {
    mockCcThenExchange();
    const client = new McpTokenExchangeClient({
      ...config,
      gatewayResourceUri: 'mcpgateway.ping.demo,https://api.ping.demo:3036/mcp,mcpgateway-a2a.ping.demo',
    });
    await client.exchange(subjectToken, 'get_my_accounts');
    const cc = new URLSearchParams(String(mockedPost.mock.calls[0][1]));
    expect(cc.get('resource')).toBe('mcpgateway.ping.demo');
    expect(cc.get('scope')).toBe('gateway:mcp:invoke');
  });

  it('mints the actor token as the exchanger principal when introspection client is set', async () => {
    mockCcThenExchange();
    const client = new McpTokenExchangeClient({
      ...config,
      gatewayResourceUri: 'mcpgateway.ping.demo',
      introspectionClientId: 'exchanger-client',
      introspectionClientSecret: 'exchanger-secret',
    });
    await client.exchange(subjectToken, 'get_my_accounts');
    const cc = new URLSearchParams(String(mockedPost.mock.calls[0][1]));
    expect(cc.get('client_id')).toBe('exchanger-client');
    expect(cc.get('client_secret')).toBe('exchanger-secret');
    expect(cc.get('scope')).toBe('gateway:mcp:invoke');
  });

  it('fails closed when the actor token cannot be minted', async () => {
    mockedPost.mockReset();
    McpTokenExchangeClient.clearCache();
    mockedPost.mockRejectedValueOnce(new Error('cc mint failed'));
    const client = new McpTokenExchangeClient(config);
    // The delegation chain is a security control — a gateway that cannot prove
    // who it is must not complete the exchange anyway.
    await expect(client.exchange(subjectToken, 'get_my_accounts')).rejects.toThrow();
  });
});
