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
import { McpTokenExchangeClient, scopeMismatchReasonFromExchangeError } from '../src/auth/McpTokenExchangeClient';
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

/**
 * The pre-flight warning above is a LOG. This maps the same empty-intersection
 * rejection into a caller-FACING reason so the caller learns it from the
 * response body, not a gateway log — WITHOUT changing the exchange request,
 * which still goes out scope-less as the two contracts below re-assert.
 */
describe('scopeMismatchReasonFromExchangeError — caller-facing reason', () => {
  // What exchangeError() actually throws for this rejection: an opaque message
  // about resource ambiguity that names neither the caller's nor the backend's scopes.
  const opaqueRejection = new Error(
    'RFC 8693 exchange to backend=olb (resource=mcpserver.ping.demo) rejected with ' +
    'HTTP 400 — invalid_scope: May not request scopes for multiple resources',
  );

  it('names BOTH scope sets — the caller holds purchase:read, olb accepts none of it', () => {
    const m = scopeMismatchReasonFromExchangeError(opaqueRejection, foreignScopeToken, 'get_my_accounts');
    expect(m).not.toBeNull();
    expect(m!.backend).toBe('olb');
    expect(m!.subjectScopes).toEqual(['purchase:read']); // what the caller holds
    expect(m!.backendScopes).toContain('read');           // what the backend accepts
    expect(m!.backendScopes).toContain('mcp:invoke');
    expect(m!.backendScopes).not.toContain('purchase:read');
    // The sentence names both sets so the caller can act on it.
    expect(m!.reason).toContain('purchase:read');
    expect(m!.reason).toContain('read');
    expect(m!.reason).toMatch(/scope mismatch/i);
    expect(m!.reason).toMatch(/mirroredScopes|Grant the caller/);
  });

  it('returns null for a bare invalid_scope — the generic exchange-failure path is untouched', () => {
    // Same signal the caller tests inject; must NOT be relabeled a scope mismatch.
    expect(scopeMismatchReasonFromExchangeError(new Error('invalid_scope'), foreignScopeToken, 'get_my_accounts')).toBeNull();
    expect(scopeMismatchReasonFromExchangeError(new Error('Backend error'), foreignScopeToken, 'get_my_accounts')).toBeNull();
  });

  it('returns null when the caller DOES hold a backend scope — never masks an unrelated multi-resource error', () => {
    const overlapToken = [
      Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'),
      Buffer.from(JSON.stringify({ sub: 'u1', scope: 'read' })).toString('base64url'),
      '',
    ].join('.');
    expect(scopeMismatchReasonFromExchangeError(opaqueRejection, overlapToken, 'get_my_accounts')).toBeNull();
  });
});

/**
 * Preservation guard — the two TESTED contracts this diagnosability fix must not
 * disturb, re-asserted here in one place. The fix is caller-side only; the
 * exchange request behaviour and cache semantics of exchangeForBackend are
 * unchanged. (The canonical copies live in mcpTokenExchangeClient.test.ts.)
 */
describe('preserved contracts (exchangeForBackend is unchanged)', () => {
  const gatewayOnlyToken = [
    Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'),
    Buffer.from(JSON.stringify({ sub: 'u1', scope: 'gateway:mcp:invoke' })).toString('base64url'),
    '',
  ].join('.');

  it('sends no scope without the flag — the tools/call path is unchanged', async () => {
    const client = new McpTokenExchangeClient(config);
    await client.exchangeForBackend(gatewayOnlyToken, 'olb');
    expect(new URLSearchParams(String(mockedPost.mock.calls[1][1])).get('scope')).toBeNull();
  });

  it('cache isolation — a discovery-scoped token is not served to a later call-path exchange', async () => {
    const client = new McpTokenExchangeClient(config);
    await client.exchangeForBackend(gatewayOnlyToken, 'olb', { allowDiscoveryScopeFallback: true });
    const second = await client.exchangeForBackend(gatewayOnlyToken, 'olb');
    expect(second.cached).toBe(false);
  });
});
