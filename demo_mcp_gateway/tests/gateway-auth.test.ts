'use strict';

/**
 * gateway-auth.test.ts — Plan 243-02 TDD tests.
 *
 * Tests the complete auth pipeline middleware (authorizeMcpRequest):
 *   1. GatewayTokenPolicy claim validation (sub, act structure, anti-bypass)
 *   2. PingOne Authorize permit/deny evaluation (D-06)
 *   3. RFC 8693 upstream token exchange (D-03)
 *   4. Correct next-hop audience in exchanged token (D-05)
 *
 * External HTTP calls (PingOne Authorize, token exchange) are mocked.
 * The tests exercise behaviour only — no network required.
 */

import axios from 'axios';
import { GatewayTokenPolicy, GatewayTokenPolicyError } from '../src/auth/GatewayTokenPolicy';
import { PingOneAuthorizeClient } from '../src/auth/PingOneAuthorizeClient';
import { guardToolCall } from '../src/pingAuthorizeGuard';
import { McpTokenExchangeClient } from '../src/auth/McpTokenExchangeClient';
import { buildAuthorizeMcpRequest } from '../src/middleware/authorizeMcpRequest';
import type { GatewayConfig } from '../src/config';
import type { DecodedGatewayToken } from '../src/tokenValidator';
import type { McpRequestMiddleware } from '../src/server/GatewayServer';
import { IncomingMessage, ServerResponse } from 'http';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Helper: build a minimal unsigned JWT (jwt.decode doesn't verify signatures)
function makeToken(sub: string, aud: string | string[], extra: Record<string, unknown> = {}): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub, aud, exp: Math.floor(Date.now() / 1000) + 3600,
    iss: 'https://auth.example.com', scope: 'banking:read', act: { sub: 'agent-id' }, ...extra,
  })).toString('base64url');
  return `${header}.${payload}.fakesig`;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const GATEWAY_AUD = 'https://mcp-gateway.example.com';
const OLB_AUD = 'https://mcp-olb.example.com';
const INVEST_AUD = 'https://mcp-invest.example.com';

const stubConfig: GatewayConfig = {
  port: 3099,
  host: '127.0.0.1',
  clientId: 'gw-client',
  clientSecret: 'secret',
  tokenEndpointAuthMethod: 'basic',
  tokenEndpoint: 'https://auth.example.com/token',
  gatewayResourceUri: GATEWAY_AUD,
  mcpOlbWsUrl: 'ws://localhost:8080',
  mcpInvestWsUrl: 'ws://localhost:8081',
  mcpOlbResourceUri: OLB_AUD,
  mcpInvestResourceUri: INVEST_AUD,
  pingAuthorizeEndpoint: 'https://pingauthorize.example.com',
  pingAuthorizeWorkerId: 'worker-01',
  p1azEnabled: true,
  hitlServiceUrl: '',
  introspectionEndpoint: '',
  introspectionClientId: '',
  introspectionClientSecret: '',
  devBypass: false,
  // Phase 266 fields
  demoApiKeyServiceKey: 'demo-api-key-0000',
  mortgageServiceBaseUrl: 'http://localhost:8082',
  mortgageServiceApiKey: 'demo-mortgage-key-0000',
  bffInternalIdTokenUrl: 'http://localhost:3001/internal/id-token',
  bffInternalSecret: 'dev-shared-secret-change-me',
  bankingResourceServerBaseUrl: 'http://localhost:3001',
  bankingResourceServerResourceUri: 'https://banking-resource-server.ping.demo',
  mcpServerPassthrough: false,
  mtlsEnabled: false,
  mtlsCertPath: '/tmp/gw-client.crt',
};

const stubConfigNoAuthz: GatewayConfig = {
  ...stubConfig,
  pingAuthorizeEndpoint: '', // no PingAuthorize — permit all
  pingAuthorizeWorkerId: '',
  p1azEnabled: false,
};

function decodedToken(overrides: Partial<DecodedGatewayToken> = {}): DecodedGatewayToken {
  return {
    sub: 'user-123',
    aud: GATEWAY_AUD,
    exp: Math.floor(Date.now() / 1000) + 3600,
    iss: 'https://auth.example.com',
    scope: 'banking:read',
    act: { sub: 'agent-client-id' },
    ...overrides,
  };
}

function mcpBody(method: string, toolName?: string): Buffer {
  return Buffer.from(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params: toolName ? { name: toolName } : {},
    }),
  );
}

function mockReqRes(): { req: Partial<IncomingMessage>; res: Partial<ServerResponse>; ended: string[] } {
  const ended: string[] = [];
  const res: Partial<ServerResponse> = {
    headersSent: false,
    writeHead: jest.fn(),
    end: jest.fn((data?: unknown) => { ended.push(typeof data === 'string' ? data : ''); return res as unknown as ServerResponse; }),
  };
  const req: Partial<IncomingMessage> = { headers: {} };
  return { req, res, ended };
}

// ---------------------------------------------------------------------------
// Section 1: GatewayTokenPolicy — claim validation (Task 1)
// ---------------------------------------------------------------------------

describe('GatewayTokenPolicy', () => {
  it('accepts a valid token with sub and gateway aud', () => {
    const decoded = decodedToken();
    expect(() => GatewayTokenPolicy.validate(decoded, stubConfig)).not.toThrow();
  });

  it('rejects when sub is missing or empty', () => {
    const decoded = decodedToken({ sub: '' });
    expect(() => GatewayTokenPolicy.validate(decoded, stubConfig)).toThrow(GatewayTokenPolicyError);
  });

  it('rejects when act is present but act.sub is empty (malformed delegation chain)', () => {
    const decoded = decodedToken({ act: { sub: '' } });
    expect(() => GatewayTokenPolicy.validate(decoded, stubConfig)).toThrow(GatewayTokenPolicyError);
  });

  it('accepts tokens without act (direct client, no agent delegation)', () => {
    const decoded = decodedToken({ act: undefined });
    expect(() => GatewayTokenPolicy.validate(decoded, stubConfig)).not.toThrow();
  });

  it('accepts tokens with valid nested act chain (user → agent)', () => {
    const decoded = decodedToken({ act: { sub: 'agent-id', act: { sub: 'orchestrator-id' } } });
    expect(() => GatewayTokenPolicy.validate(decoded, stubConfig)).not.toThrow();
  });

  it('rejects when token aud contains an upstream MCP-server audience (anti-bypass: D-05)', () => {
    // A token targeted at the OLB server should NEVER enter through the gateway
    const decoded = decodedToken({ aud: OLB_AUD });
    expect(() => GatewayTokenPolicy.validate(decoded, stubConfig)).toThrow(GatewayTokenPolicyError);
  });

  it('rejects when token aud contains invest server audience (anti-bypass: D-05)', () => {
    const decoded = decodedToken({ aud: INVEST_AUD });
    expect(() => GatewayTokenPolicy.validate(decoded, stubConfig)).toThrow(GatewayTokenPolicyError);
  });

  it('rejects a multi-aud token carrying the Phase 266 RS audience (anti-bypass: D-05)', () => {
    // [gatewayResourceUri, bankingResourceServerResourceUri] passes the
    // inbound aud check but must be rejected by D-05 so it cannot be
    // force-forwarded with the RS audience already present.
    const decoded = decodedToken({
      aud: [GATEWAY_AUD, stubConfig.bankingResourceServerResourceUri],
    });
    expect(() => GatewayTokenPolicy.validate(decoded, stubConfig)).toThrow(
      GatewayTokenPolicyError,
    );
  });

  it('still accepts a normal gateway-aud token after the D-05 set widened', () => {
    const decoded = decodedToken({ aud: GATEWAY_AUD });
    expect(() => GatewayTokenPolicy.validate(decoded, stubConfig)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Section 2: PingOneAuthorizeClient (Task 2)
// ---------------------------------------------------------------------------

describe('PingOneAuthorizeClient', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns permit when PingAuthorize returns PERMIT', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { decision: 'PERMIT' } });
    const client = new PingOneAuthorizeClient(stubConfig);
    const result = await client.evaluate(decodedToken(), 'tools/call', 'get_my_accounts');
    expect(result.decision).toBe('PERMIT');
  });

  it('returns deny when PingAuthorize returns DENY', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { decision: 'DENY' } });
    const client = new PingOneAuthorizeClient(stubConfig);
    const result = await client.evaluate(decodedToken(), 'tools/call', 'create_transfer');
    expect(result.decision).toBe('DENY');
  });

  it('returns indeterminate (HITL trigger) when PingAuthorize returns INDETERMINATE', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { decision: 'INDETERMINATE' } });
    const client = new PingOneAuthorizeClient(stubConfig);
    const result = await client.evaluate(decodedToken(), 'tools/call', 'create_transfer');
    expect(result.decision).toBe('INDETERMINATE');
  });

  it('fails CLOSED (deny) when PingAuthorize endpoint is unreachable', async () => {
    mockedAxios.post.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const client = new PingOneAuthorizeClient(stubConfig);
    const result = await client.evaluate(decodedToken(), 'tools/call', 'get_my_accounts');
    expect(result.decision).toBe('DENY');
    expect(result.reason).toMatch(/unavailable/i);
  });

  it('permits all when PingAuthorize is not configured', async () => {
    const client = new PingOneAuthorizeClient(stubConfigNoAuthz);
    // Use plain scope names that match the scope topology (generic naming).
    const result = await client.evaluate(decodedToken({ scope: 'read write' }), 'tools/list');
    expect(result.decision).toBe('PERMIT');
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Section 2b: WS-vs-HTTP PingAuthorize parity (WR-02)
// ---------------------------------------------------------------------------

describe('PingAuthorize WS/HTTP parity (WR-02)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('guardToolCall (WS) sends the SAME request body as evaluate (HTTP) for an over-threshold create_transfer', async () => {
    const decoded = decodedToken({ scope: 'banking:read banking:write' });
    const toolArgs = { amount: 750, transaction_type: 'transfer', to_account_id: 'acct-999' };

    // HTTP path
    mockedAxios.post.mockResolvedValueOnce({ data: { decision: 'PERMIT' } });
    const client = new PingOneAuthorizeClient(stubConfig);
    await client.evaluate(decoded, 'tools/call', 'create_transfer', toolArgs);
    const httpBody = mockedAxios.post.mock.calls[0][1];

    mockedAxios.post.mockClear();

    // WS path
    mockedAxios.post.mockResolvedValueOnce({ data: { decision: 'PERMIT' } });
    await guardToolCall('create_transfer', decoded, stubConfig, toolArgs);
    const wsBody = mockedAxios.post.mock.calls[0][1];

    expect(wsBody).toEqual(httpBody);
    expect((wsBody as { parameters: Record<string, string> }).parameters.TransactionAmount).toBe('750');
    expect((wsBody as { parameters: Record<string, string> }).parameters.McpMethod).toBe('tools/call');
  });
});

// ---------------------------------------------------------------------------
// Section 3: McpTokenExchangeClient (Task 2)
// ---------------------------------------------------------------------------

describe('McpTokenExchangeClient', () => {
  beforeEach(() => { jest.clearAllMocks(); McpTokenExchangeClient.clearCache(); });

  it('exchanges for OLB audience when tool belongs to OLB backend', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: { access_token: 'olb-token-xyz', expires_in: 300 },
    });
    const client = new McpTokenExchangeClient(stubConfig);
    const result = await client.exchange('inbound-token', 'get_my_accounts');
    expect(result.token).toBe('olb-token-xyz');
    expect(result.targetAud).toBe(OLB_AUD);
    // RFC 8693: subject_token must be the inbound token
    const body = new URLSearchParams(mockedAxios.post.mock.calls[0][1] as string);
    expect(body.get('subject_token')).toBe('inbound-token');
    expect(body.get('audience')).toBe(OLB_AUD);
  });

  it('exchanges for invest audience when tool belongs to invest backend', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: { access_token: 'invest-token', expires_in: 300 },
    });
    const client = new McpTokenExchangeClient(stubConfig);
    const result = await client.exchange('inbound-token', 'get_investment_balance');
    expect(result.targetAud).toBe(INVEST_AUD);
  });

  it('exchanges for OLB audience for tools/list (default backend)', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: { access_token: 'olb-list-token', expires_in: 300 },
    });
    const client = new McpTokenExchangeClient(stubConfig);
    const result = await client.exchange('inbound-token');
    expect(result.targetAud).toBe(OLB_AUD);
  });

  it('exchanged token never carries the gateway audience (D-05 next-hop)', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: { access_token: 'backend-token', expires_in: 300 },
    });
    const client = new McpTokenExchangeClient(stubConfig);
    const result = await client.exchange('inbound-token', 'get_my_accounts');
    expect(result.targetAud).not.toBe(GATEWAY_AUD);
  });

  it('throws when token endpoint returns no access_token', async () => {
    McpTokenExchangeClient.clearCache();
    mockedAxios.post.mockResolvedValueOnce({ data: {} });
    const client = new McpTokenExchangeClient(stubConfig);
    await expect(client.exchange('unique-no-access-token-test-' + Date.now())).rejects.toThrow(/access_token/i);
  });
});

// ---------------------------------------------------------------------------
// Section 4: buildAuthorizeMcpRequest — full pipeline integration (Task 2)
// ---------------------------------------------------------------------------

describe('buildAuthorizeMcpRequest middleware', () => {
  let middleware: McpRequestMiddleware;
  let forwardSpy: jest.Mock;
  let req: Partial<IncomingMessage>;
  let res: Partial<ServerResponse>;

  const VALID_BEARER = makeToken('user-123', GATEWAY_AUD);

  beforeEach(() => {
    jest.resetAllMocks(); // resetAllMocks drains mockResolvedValueOnce queues, clearAllMocks does not
    McpTokenExchangeClient.clearCache();
    forwardSpy = jest.fn().mockResolvedValue(undefined);
    middleware = buildAuthorizeMcpRequest(stubConfig);
    const mocks = mockReqRes();
    req = mocks.req;
    res = mocks.res;
  });

  it('permit → calls forward with the original bearer token unchanged (no re-exchange)', async () => {
    // PingAuthorize: PERMIT
    mockedAxios.post.mockResolvedValueOnce({ data: { decision: 'PERMIT' } });
    // No token exchange mock needed — the gateway now forwards the TX token unchanged.

    const body = mcpBody('tools/call', 'get_my_accounts');
    const bearerToken = VALID_BEARER;

    await middleware(
      bearerToken,
      body,
      req as IncomingMessage,
      res as ServerResponse,
      forwardSpy,
    );

    expect(forwardSpy).toHaveBeenCalledTimes(1);
    // The TX token (aud: ping.demo) is forwarded unchanged — no re-exchange at the gateway.
    const [calledWithToken] = forwardSpy.mock.calls[0];
    expect(calledWithToken).toBe(bearerToken);
  });

  it('WR-03: strips _hitl_challenge_id from arguments before forwarding on the HTTP path', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { decision: 'PERMIT' } });
    // No exchange mock needed — bearer token is forwarded unchanged.

    const body = Buffer.from(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'create_transfer',
          arguments: { amount: 10, _hitl_challenge_id: 'chal-abc', to_account_id: 'a1' },
        },
      }),
    );

    await middleware(
      VALID_BEARER,
      body,
      req as IncomingMessage,
      res as ServerResponse,
      forwardSpy,
    );

    expect(forwardSpy).toHaveBeenCalledTimes(1);
    const forwardedBody = forwardSpy.mock.calls[0][1] as Buffer;
    const forwarded = JSON.parse(forwardedBody.toString('utf-8'));
    expect(forwarded.params.arguments).not.toHaveProperty('_hitl_challenge_id');
    expect(forwarded.params.arguments).toEqual({ amount: 10, to_account_id: 'a1' });
  });

  it('deny from PingAuthorize → returns 403 and does NOT call forward', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { decision: 'DENY' } });

    const body = mcpBody('tools/call', 'create_transfer');
    await middleware(
      VALID_BEARER,
      body,
      req as IncomingMessage,
      res as ServerResponse,
      forwardSpy,
    );

    expect(forwardSpy).not.toHaveBeenCalled();
    expect(res.writeHead).toHaveBeenCalledWith(403, expect.objectContaining({ 'Content-Type': 'application/json' }));
  });

  it('PingAuthorize unavailable → fails closed, returns 403, no forward', async () => {
    mockedAxios.post.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const body = mcpBody('tools/call', 'get_my_accounts');
    await middleware(
      VALID_BEARER,
      body,
      req as IncomingMessage,
      res as ServerResponse,
      forwardSpy,
    );

    expect(forwardSpy).not.toHaveBeenCalled();
    // Fail closed — not a 200/forward path
    expect(res.writeHead).toHaveBeenCalledWith(403, expect.anything());
  });

  it('no-authz config → permit all, forwards original bearer token unchanged', async () => {
    // No PingAuthorize configured — no exchange, bearer forwarded as-is.
    // Use plain scope names that match the scope topology (generic naming).
    McpTokenExchangeClient.clearCache();
    const NO_AUTHZ_BEARER = makeToken('user-123', GATEWAY_AUD, { scope: 'read write' });
    const noAuthzMiddleware = buildAuthorizeMcpRequest(stubConfigNoAuthz);
    const body = mcpBody('tools/list');
    const { req: req2, res: res2 } = mockReqRes();
    const forward2 = jest.fn().mockResolvedValue(undefined);
    await noAuthzMiddleware(
      NO_AUTHZ_BEARER,
      body,
      req2 as IncomingMessage,
      res2 as ServerResponse,
      forward2,
    );

    expect(forward2).toHaveBeenCalledTimes(1);
    // TX token forwarded unchanged — no re-exchange at the gateway.
    expect(forward2.mock.calls[0][0]).toBe(NO_AUTHZ_BEARER);
  });
});

// ---------------------------------------------------------------------------
// Section 5: RFC 9728 WWW-Authenticate header — Phase 264 (D-16)
// ---------------------------------------------------------------------------

describe('authorizeMcpRequest — RFC 9728 WWW-Authenticate header', () => {
  let req: Partial<IncomingMessage>;
  let res: Partial<ServerResponse>;
  let forwardSpy: jest.Mock;

  beforeEach(() => {
    jest.resetAllMocks();
    McpTokenExchangeClient.clearCache();
    forwardSpy = jest.fn().mockResolvedValue(undefined);
    const mocks = mockReqRes();
    req = mocks.req;
    res = mocks.res;
  });

  it('401 on inactive token includes WWW-Authenticate with realm="PingOne" and resource_metadata', async () => {
    // Use a config with introspectionEndpoint set so the inactive-token path is reachable.
    // Without it, GatewayIntrospectionClient skips and returns { active: true, skipped: true }.
    const configWithIntrospection = { ...stubConfig, introspectionEndpoint: 'https://auth.example.com/introspect' };
    mockedAxios.post.mockResolvedValueOnce({ data: { active: false } });
    const middleware = buildAuthorizeMcpRequest(configWithIntrospection);
    const body = mcpBody('tools/list');
    const BEARER = makeToken('user-123', GATEWAY_AUD);

    await middleware(BEARER, body, req as IncomingMessage, res as ServerResponse, forwardSpy);

    const writeHeadCalls = (res.writeHead as jest.Mock).mock.calls;
    const call401 = writeHeadCalls.find((c: unknown[]) => c[0] === 401);
    expect(call401).toBeDefined();
    const wwwAuth: string = call401![1]['WWW-Authenticate'];
    expect(wwwAuth).toMatch(/Bearer realm="PingOne"/);
    expect(wwwAuth).toMatch(/resource_metadata=/);
    expect(wwwAuth).toMatch(/\/\.well-known\/mcp-server/);
  });

  it('403 on Authorize DENY includes WWW-Authenticate with realm="PingOne" and resource_metadata', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { active: true, sub: 'user-123' } });
    mockedAxios.post.mockResolvedValueOnce({ data: { decision: 'DENY' } });
    const middleware = buildAuthorizeMcpRequest(stubConfig);
    const body = mcpBody('tools/call', 'create_transfer');
    const BEARER = makeToken('user-123', GATEWAY_AUD);

    await middleware(BEARER, body, req as IncomingMessage, res as ServerResponse, forwardSpy);

    const writeHeadCalls = (res.writeHead as jest.Mock).mock.calls;
    const call403 = writeHeadCalls.find((c: unknown[]) => (c[0] as number) === 403);
    expect(call403).toBeDefined();
    const wwwAuth: string = call403![1]['WWW-Authenticate'];
    expect(wwwAuth).toMatch(/Bearer realm="PingOne"/);
    expect(wwwAuth).toMatch(/resource_metadata=/);
    expect(wwwAuth).toMatch(/\/\.well-known\/mcp-server/);
    expect(forwardSpy).not.toHaveBeenCalled();
  });
});
