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
  mcpInvestResourceUri: 'mcp-invest.ping.demo',
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
    const sentBody = String(mockedPost.mock.calls[0][1]);
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
    expect(mockedPost).toHaveBeenCalledTimes(1);
  });

  it('propagates exchange failure (callers fail closed)', async () => {
    mockedPost.mockRejectedValue(new Error('invalid_scope'));
    const client = new McpTokenExchangeClient(config);
    await expect(client.exchange(subjectToken, 'get_my_accounts')).rejects.toThrow();
  });
});
