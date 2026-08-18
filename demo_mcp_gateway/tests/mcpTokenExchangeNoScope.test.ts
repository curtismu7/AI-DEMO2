'use strict';

/**
 * Diagnosing a scope-less RFC 8693 exchange.
 *
 * On the call path there is no discovery-scope fallback — deliberately, since
 * inventing a scope the caller does not hold would manufacture authority, and
 * `sends no scope without the flag — the tools/call path is unchanged` pins
 * that. The exchange therefore goes out with `scope=` omitted and PingOne
 * rejects it with:
 *
 *   invalid_scope: May not request scopes for multiple resources
 *
 * an error about resource ambiguity that names neither the caller's scopes nor
 * the backend's. Observed live on every sensitive_order_history call as a
 * recurring error-level failure pointing at the wrong thing.
 *
 * The fix is a pre-flight warning, NOT a behaviour change: the failure is
 * correct and deliberate, and only its diagnosability was defective. These tests
 * pin the warning AND that the tested behaviour is untouched.
 */

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

/** Real shape of the failing token: one scope belonging to no backend. */
const foreignScopeToken = [
  Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'),
  Buffer.from(JSON.stringify({ sub: 'u1', scope: 'purchase:read' })).toString('base64url'),
  '',
].join('.');

let warnSpy: jest.SpyInstance;

beforeEach(() => {
  mockedPost.mockReset();
  McpTokenExchangeClient.clearCache();
  mockedPost.mockResolvedValue({ data: { access_token: 'exchanged-tok', expires_in: 300 } });
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => warnSpy.mockRestore());

describe('scope-less exchange diagnostics', () => {
  it('warns with BOTH scope sets before PingOne can answer with the wrong reason', async () => {
    const client = new McpTokenExchangeClient(config);
    await client.exchangeForBackend(foreignScopeToken, 'olb');

    const warned = warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(warned).toMatch(/scope-less/i);
    expect(warned).toContain('purchase:read');        // what the caller holds
    expect(warned).toContain('mcpserver.ping.demo');   // the target resource
    expect(warned).toMatch(/mirroredScopes|Grant the caller/); // how to fix it
  });

  it('leaves the tested behaviour alone — the exchange still goes out scope-less', async () => {
    // The call path deliberately does NOT invent a scope. This fix is additive;
    // if it ever starts changing the request, that is a regression.
    const client = new McpTokenExchangeClient(config);
    await client.exchangeForBackend(foreignScopeToken, 'olb');

    const sent = new URLSearchParams(String(mockedPost.mock.calls[1][1]));
    expect(sent.get('scope')).toBeNull();
    expect(sent.get('resource')).toBe('mcpserver.ping.demo');
  });

  it('stays quiet when the scopes DO overlap', async () => {
    const goodToken = [
      Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'),
      Buffer.from(JSON.stringify({ sub: 'u1', scope: 'read mcp:invoke' })).toString('base64url'),
      '',
    ].join('.');

    const client = new McpTokenExchangeClient(config);
    await client.exchangeForBackend(goodToken, 'olb');

    const warned = warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(warned).not.toMatch(/scope-less/i);
  });

  it('stays quiet on the discovery path, which supplies its own scope', async () => {
    const client = new McpTokenExchangeClient(config);
    await client.exchangeForBackend(foreignScopeToken, 'olb', {
      allowDiscoveryScopeFallback: true,
    });

    const warned = warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(warned).not.toMatch(/scope-less/i);
  });
});
