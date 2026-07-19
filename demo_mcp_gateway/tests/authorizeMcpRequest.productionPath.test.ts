'use strict';

/**
 * The middleware -> pipeline hop, driven the way production drives it.
 *
 * Every other suite in this directory reaches the authorization pipeline by
 * injecting `deps`, which SKIPS the production branch entirely
 * (authorizeMcpRequest.ts: `if (deps) { ... } else { runMcpAuthorizationPipeline(...) }`).
 * So two whole classes of defect were invisible:
 *
 *   - UC16: the pipeline call supplies `toolName` + `decisionContext`, and those
 *     two arguments are the ONLY reason the require-act branch is reachable on
 *     HTTP. authorizeMcpRequestCore.uc16.test.ts calls the pipeline directly, so
 *     deleting both arguments from the middleware left all six of its tests green.
 *   - C2: a test that injects `policySource` and then asserts `policy_source`
 *     proves the middleware copies a field. It cannot prove the gateway PRODUCES
 *     the right provenance, because no production code ran.
 *
 * These tests use no `deps`. Introspection is the only stub (axios), so the
 * pipeline, GatewayTokenPolicy, PingOneAuthorizeClient and the response
 * rendering are all real.
 */

import axios from 'axios';
import { buildAuthorizeMcpRequest } from '../src/middleware/authorizeMcpRequest';
import { GatewayIntrospectionClient } from '../src/auth/GatewayIntrospectionClient';
import type { GatewayConfig } from '../src/config';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Test fixtures only — never read by production code.
const INTROSPECTION_URL = 'https://as.test/as/introspect';
const TOKEN_URL = 'https://as.test/as/token';
const GATEWAY_RESOURCE_URI = 'https://gateway.ping.demo';

function makeConfig(over: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    devBypass: false,
    gatewayResourceUri: GATEWAY_RESOURCE_URI,
    introspectionEndpoint: INTROSPECTION_URL,
    introspectionClientId: 'gw',
    introspectionClientSecret: 'sec',
    clientId: 'gw',
    clientSecret: 'sec',
    tokenEndpoint: TOKEN_URL,
    tokenEndpointAuthMethod: 'basic',
    mcpOlbResourceUri: 'mcpserver.ping.demo',
    // P1AZ off + the local engine explicitly opted in: the only configuration in
    // which the gateway legitimately produces a decision of its own, and so the
    // only one where 'local-fallback' provenance can be produced rather than injected.
    p1azEnabled: false,
    allowLocalScopeFallback: true,
    requireActForAgentTools: false,
    intentTokenRequired: false,
    requireRarIntent: false,
    wbaMode: 'off',
    rateLimitEnabled: false,
    hitlServiceUrl: '',
    mtlsEnabled: false,
    ...over,
  } as GatewayConfig;
}

/** Unsigned JWT — the pipeline only jwt.decode()s it. */
let _tokenSeq = 0;
function tokenWith(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: 'user-123',
    aud: GATEWAY_RESOURCE_URI,
    exp: 9999999999,
    // Unique per token so the 30s introspection cache never serves a previous
    // test's result — a cached hit would make these tests pass without the
    // pipeline running at all.
    jti: `t${_tokenSeq++}`,
    ...claims,
  })).toString('base64url');
  return `${header}.${payload}.`;
}

function makeRes() {
  const chunks: string[] = [];
  const headers: Record<string, string> = {};
  const headCalls: Array<{ status: number }> = [];
  return {
    res: {
      writeHead: jest.fn((status: number) => { headCalls.push({ status }); }),
      end: jest.fn((s?: string) => { if (s) chunks.push(s); }),
      setHeader: jest.fn((k: string, v: string) => { headers[k] = v; }),
    } as any,
    body: () => JSON.parse(chunks.join('') || '{}'),
    status: () => headCalls[0]?.status,
    auditTrail: () => JSON.parse(headers['X-Gw-Audit-Trail'] || '{}'),
  };
}

async function call(config: GatewayConfig, token: string, toolName: string, args: Record<string, unknown> = {}) {
  // Network calls are the only stubs — introspection (RFC 7662) and the RFC 8693
  // exchange. Neither is a decision; every policy step below runs for real.
  mockedAxios.post.mockImplementation(async (url: string) => {
    if (url === TOKEN_URL) return { data: { access_token: 'upstream-tok', expires_in: 300 } } as any;
    return { data: { active: true, sub: 'user-123', exp: 9999999999 } } as any;
  });
  const middleware = buildAuthorizeMcpRequest(config);
  const harness = makeRes();
  const rpc = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: toolName, arguments: args } };
  const forwarded: string[] = [];
  await middleware(token, Buffer.from(JSON.stringify(rpc)),
    { headers: {}, socket: {} } as any, harness.res, async (t) => { forwarded.push(t); });
  return { ...harness, forwarded };
}

beforeEach(() => {
  jest.clearAllMocks();
  GatewayIntrospectionClient.clearCache();
});

/**
 * UC16 through the middleware. If the `toolName` / `decisionContext` arguments
 * are ever dropped from the runMcpAuthorizationPipeline call again, the pipeline
 * authorizes the act-less token and the request proceeds — these fail, where the
 * direct-pipeline suite would not notice.
 */
describe('UC16 — the middleware supplies the arguments that arm the require-act branch', () => {
  it('rejects an act-less token for an agent-mediated tool (401 missing_act)', async () => {
    const { status, body, forwarded } = await call(
      makeConfig({ requireActForAgentTools: true }), tokenWith({ scope: 'read write transfer' }), 'create_transfer',
      { from_account_id: 'acct-1', to_account_id: 'acct-2', amount: 10 },
    );
    expect(status()).toBe(401);
    expect(body().error).toBe('missing_act');
    expect(forwarded).toHaveLength(0);
  });

  it('the same call WITH an act claim gets past the policy step', async () => {
    const { body, status } = await call(
      makeConfig({ requireActForAgentTools: true }),
      tokenWith({ scope: 'read write transfer', act: { sub: 'agent-client' } }), 'create_transfer',
      { from_account_id: 'acct-1', to_account_id: 'acct-2', amount: 10 },
    );
    expect(status()).not.toBe(401);
    expect(body().error).not.toBe('missing_act');
  });

  it('stays flag-gated — REQUIRE_ACT off lets the act-less token through the policy step', async () => {
    const { body, status } = await call(
      makeConfig({ requireActForAgentTools: false }), tokenWith({ scope: 'read write transfer' }), 'create_transfer',
      { from_account_id: 'acct-1', to_account_id: 'acct-2', amount: 10 },
    );
    expect(status()).not.toBe(401);
    expect(body().error).not.toBe('missing_act');
  });

  it('the actor allow-list is enforced through the middleware too', async () => {
    const { status, body, forwarded } = await call(
      makeConfig({ authorizedActorClientId: 'the-real-exchanger' } as Partial<GatewayConfig>),
      tokenWith({ scope: 'read', act: { sub: 'impostor' } }), 'get_my_accounts',
    );
    expect(status()).toBe(401);
    expect(body().error).toBe('unauthorized_actor');
    expect(forwarded).toHaveLength(0);
  });
});

/**
 * C2 end-to-end: the provenance on the wire is PRODUCED by PingOneAuthorizeClient,
 * not written by the test. Nothing here injects a policySource.
 */
describe('C2 — provenance the gateway produced, not provenance the test supplied', () => {
  it('a denial the local scope engine produced is labelled local-fallback + degraded', async () => {
    const { status, body } = await call(
      makeConfig(), tokenWith({ scope: 'read' }), 'create_transfer',
      { from_account_id: 'acct-1', to_account_id: 'acct-2', amount: 10 },
    );
    expect(status()).toBe(403);
    expect(body().policy_source).toBe('local-fallback');
    expect(body().degraded).toBe(true);
    // This IS the local scope engine's own verdict, so the scope hint belongs.
    expect(body().required_scopes).toEqual(expect.arrayContaining(['transfer']));
  });

  it('a PERMIT the local scope engine produced is labelled degraded on the wire', async () => {
    const { forwarded, auditTrail } = await call(
      makeConfig(), tokenWith({ scope: 'read write transfer' }), 'create_transfer',
      { from_account_id: 'acct-1', to_account_id: 'acct-2', amount: 10 },
    );
    expect(forwarded).toHaveLength(1);
    expect(auditTrail().authorize.decision).toBe('PERMIT');
    expect(auditTrail().authorize.policySource).toBe('local-fallback');
    expect(auditTrail().authorize.degraded).toBe(true);
  });

  it('fails closed WITH a label when the local engine is not opted in', async () => {
    const { status, body } = await call(
      makeConfig({ allowLocalScopeFallback: false }), tokenWith({ scope: 'read write transfer' }), 'create_transfer',
      { from_account_id: 'acct-1', to_account_id: 'acct-2', amount: 10 },
    );
    expect(status()).toBe(403);
    expect(body().message).toMatch(/authz_unavailable/);
    expect(body().policy_source).toBe('local-fallback');
  });
});
