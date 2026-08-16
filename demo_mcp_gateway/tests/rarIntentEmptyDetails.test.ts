'use strict';

/**
 * BUG #65 — an empty authorization_details ([]) must NOT bypass RAR intent-subset
 * enforcement when REQUIRE_RAR_INTENT is on. `[]` is caller-supplied (unsigned
 * X-TraT-Context, ALLOW_UNSIGNED_TRAT_CONTEXT=true), so treating it as "intent
 * present" let an attacker skip the amount/payee subset checks entirely. Both
 * transports must now fail closed (rar_intent_required).
 */

import axios from 'axios';
import { buildAuthorizeMcpRequest } from '../src/middleware/authorizeMcpRequest';
import { guardToolCall } from '../src/pingAuthorizeGuard';
import { GatewayIntrospectionClient } from '../src/auth/GatewayIntrospectionClient';
import type { GatewayConfig } from '../src/config';
import type { DecodedGatewayToken } from '../src/tokenValidator';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const GATEWAY_RESOURCE_URI = 'https://gateway.ping.demo';
const INTROSPECTION_URL = 'https://as.test/as/introspect';
const TOKEN_URL = 'https://as.test/as/token';

beforeEach(() => {
  jest.clearAllMocks();
  GatewayIntrospectionClient.clearCache();
  process.env.ALLOW_UNSIGNED_TRAT_CONTEXT = 'true';
});
afterEach(() => {
  delete process.env.ALLOW_UNSIGNED_TRAT_CONTEXT;
});

// ── HTTP transport (buildAuthorizeMcpRequest, production path — no deps) ──────

function httpConfig(over: Partial<GatewayConfig> = {}): GatewayConfig {
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
    p1azEnabled: false,
    allowLocalScopeFallback: true,
    requireActForAgentTools: false,
    intentTokenRequired: false,
    requireRarIntent: true,
    wbaMode: 'off',
    rateLimitEnabled: false,
    hitlServiceUrl: '',
    mtlsEnabled: false,
    ...over,
  } as GatewayConfig;
}

let _seq = 0;
function tokenWith(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: 'user-123', aud: GATEWAY_RESOURCE_URI, exp: 9999999999, jti: `t${_seq++}`, ...claims,
  })).toString('base64url');
  return `${header}.${payload}.`;
}

function makeRes() {
  const chunks: string[] = [];
  const headCalls: Array<{ status: number }> = [];
  return {
    res: {
      writeHead: jest.fn((status: number) => { headCalls.push({ status }); }),
      end: jest.fn((s?: string) => { if (s) chunks.push(s); }),
      setHeader: jest.fn(),
    } as any,
    body: () => JSON.parse(chunks.join('') || '{}'),
    status: () => headCalls[0]?.status,
  };
}

async function httpCall(config: GatewayConfig, token: string, tratContext: string, args: Record<string, unknown>) {
  mockedAxios.post.mockImplementation(async (url: string) => {
    if (url === TOKEN_URL) return { data: { access_token: 'upstream-tok', expires_in: 300 } } as any;
    return { data: { active: true, sub: 'user-123', exp: 9999999999 } } as any;
  });
  const middleware = buildAuthorizeMcpRequest(config);
  const harness = makeRes();
  const rpc = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'create_transfer', arguments: args } };
  const forwarded: string[] = [];
  await middleware(
    token,
    Buffer.from(JSON.stringify(rpc)),
    { headers: { 'x-trat-context': tratContext }, socket: {} } as any,
    harness.res,
    async (t) => { forwarded.push(t); },
  );
  return { ...harness, forwarded };
}

describe('BUG #65 HTTP — empty authorization_details fails closed under requireRarIntent', () => {
  it('DENIES (403 rar_intent_required) when authorization_details is []', async () => {
    const trat = JSON.stringify({ azd: { authorization_details: [] } });
    const { status, body, forwarded } = await httpCall(
      httpConfig(), tokenWith({ scope: 'read write transfer' }), trat,
      { from_account_id: 'acct-1', to_account_id: 'acct-2', amount: 999999 },
    );
    expect(status()).toBe(403);
    expect(body().error).toBe('rar_intent_required');
    expect(forwarded).toHaveLength(0);
  });

  it('still PERMITS a legitimate non-empty grant that the call is a subset of', async () => {
    const trat = JSON.stringify({
      azd: { authorization_details: [{ tool: 'create_transfer', actions: ['create_transfer'], amount: 100, payee: 'acct-2' }] },
    });
    const { forwarded, body } = await httpCall(
      httpConfig(), tokenWith({ scope: 'read write transfer' }), trat,
      { from_account_id: 'acct-1', to_account_id: 'acct-2', amount: 10 },
    );
    expect(body().error).not.toBe('rar_intent_required');
    expect(forwarded).toHaveLength(1);
  });
});

// ── WS transport (guardToolCall) ─────────────────────────────────────────────

function wsConfig(over: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    requireActForAgentTools: false,
    requireRarIntent: true,
    gatewayResourceUri: 'https://mcpgateway.ping.demo',
    mcpOlbResourceUri: 'https://mcp.olb.ping.demo',
    mcpResourceServerResourceUri: 'https://mcp.invest.ping.demo',
    bankingResourceServerResourceUri: 'https://banking-resource-server.ping.demo',
    p1azEnabled: true,
    pingAuthorizeEndpoint: 'http://localhost:9999',
    pingAuthorizeWorkerId: 'test-policy',
    pingAuthorizeMockBase: undefined,
    port: 3005,
    host: '0.0.0.0',
    clientId: 'test-client',
    clientSecret: 'test-secret',
    tokenEndpointAuthMethod: 'basic',
    tokenEndpoint: 'https://auth.pingone.com/test/as/token',
    mcpOlbWsUrl: 'ws://localhost:8080',
    mcpResourceServerWsUrl: 'ws://localhost:8081',
    hitlServiceUrl: '',
    introspectionEndpoint: '',
    devBypass: false,
    demoApiKeyServiceKey: '',
    apiResourceServerBaseUrl: '',
    apiResourceServerApiKey: '',
    bffInternalIdTokenUrl: '',
    bffInternalSecret: 'test-secret-that-is-long-enough-to-pass',
    bankingResourceServerBaseUrl: '',
    mtlsEnabled: false,
    mtlsCertPath: '',
    authorizedActorClientId: '',
    ...over,
  } as GatewayConfig;
}

function wsToken(): DecodedGatewayToken {
  return {
    sub: 'user-123', aud: 'https://mcpgateway.ping.demo',
    exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000),
    scope: 'read write transfer',
  } as DecodedGatewayToken;
}

describe('BUG #65 WS — empty authorization_details fails closed under requireRarIntent', () => {
  beforeEach(() => mockedAxios.post.mockReset());

  it('DENIES (rar_intent_required) when authorization_details is []', async () => {
    const trat = JSON.stringify({
      purp: 'transfer', reqctx: { tool: 'create_transfer' },
      azd: { authorization_details: [] }, rctx: { session: 's1' },
    });
    const result = await guardToolCall(
      'create_transfer', wsToken(), wsConfig(),
      { amount: 999999, to_account_id: 'acct-2' } as any, trat,
    );
    expect(result.permitted).toBe(false);
    expect(result.reason).toMatch(/rar_intent_required/);
    // The P1AZ decision endpoint must never be reached — we fail closed first.
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('still PERMITS a legitimate non-empty grant that the call is a subset of', async () => {
    mockedAxios.post.mockResolvedValue({ status: 200, data: { decision: 'PERMIT' } } as never);
    const trat = JSON.stringify({
      purp: 'transfer', reqctx: { tool: 'create_transfer' },
      azd: { authorization_details: [{ tool: 'create_transfer', actions: ['create_transfer'], amount: 100, payee: 'acct-2' }] },
      rctx: { session: 's1' },
    });
    const result = await guardToolCall(
      'create_transfer', wsToken(), wsConfig(),
      { amount: 10, to_account_id: 'acct-2' } as any, trat,
    );
    expect(result.permitted).toBe(true);
  });
});
