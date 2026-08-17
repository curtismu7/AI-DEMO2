'use strict';

/**
 * F1 — the shadow PDP. `MCP_GW_P1AZ_ENABLED` defaulted to false, so out of the box the
 * gateway substituted its OWN scope engine for the PDP and called the result a PERMIT.
 * Contract D2: the flag defaults true, and the local engine survives only as an explicit
 * opt-in whose every decision is labelled.
 *
 * C2 — decision provenance. Every decision carries
 *   policySource: 'p1az' | 'p1az-mock' | 'local-fallback' | 'simulated'
 * and anything carrying 'local-fallback' also sets degraded: true.
 *
 * Also pins the tools/call vs tools/list consistency the split had lost: with P1AZ off,
 * tools/call degraded to a local PERMIT while tools/list hard-denied.
 */

import axios from 'axios';
import { PingOneAuthorizeClient } from '../src/auth/PingOneAuthorizeClient';
import { guardToolsList, guardToolCall } from '../src/pingAuthorizeGuard';
import { loadConfig } from '../src/config';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const p1azOn: any = {
  pingAuthorizeEndpoint: 'https://real.example/authz',
  pingAuthorizeMockBase: 'http://authz-server:9001',
  pingAuthorizeWorkerId: 'mcp-gateway',
  gatewayResourceUri: 'mcpgateway.ping.demo',
  p1azEnabled: true,
};
// P1AZ off, local scope engine NOT opted in (the new default posture).
const p1azOff: any = { ...p1azOn, p1azEnabled: false, pingAuthorizeEndpoint: '' };
// P1AZ off, local scope engine explicitly opted in (degraded mode).
const localOptIn: any = { ...p1azOff, allowLocalScopeFallback: true };

const decoded: any
  = { sub: 'u1', scope: 'read transfer', aud: 'mcpgateway.ping.demo', act: { sub: 'agent' } };

describe('F1 — MCP_GW_P1AZ_ENABLED defaults to true', () => {
  const OLD = { ...process.env };
  beforeEach(() => {
    jest.clearAllMocks();
    // loadConfig() requires a handful of vars; supply the minimum.
    process.env.MCP_GW_RESOURCE_URI = 'mcpgateway.ping.demo';
    process.env.MCP_GW_CLIENT_ID = 'gw';
    process.env.MCP_GW_CLIENT_SECRET = 'sec';
    process.env.PINGONE_TOKEN_ENDPOINT = 'https://auth.example/token';
    delete process.env.MCP_GW_P1AZ_ENABLED;
    delete process.env.MCP_GW_ALLOW_LOCAL_SCOPE_FALLBACK;
  });
  afterAll(() => { process.env = OLD; });

  test('p1azEnabled is true when MCP_GW_P1AZ_ENABLED is unset', () => {
    expect(loadConfig().p1azEnabled).toBe(true);
  });

  test('p1azEnabled is false only when explicitly set to "false"', () => {
    process.env.MCP_GW_P1AZ_ENABLED = 'false';
    expect(loadConfig().p1azEnabled).toBe(false);
  });

  test('the local scope engine is NOT opted in by default', () => {
    expect(loadConfig().allowLocalScopeFallback).toBe(false);
  });
});

describe('C2 — policySource on the real-PDP paths', () => {
  beforeEach(() => jest.clearAllMocks());

  test('a live P1AZ decision is labelled p1az and is not degraded', async () => {
    mockedAxios.post.mockResolvedValueOnce({ status: 200, data: { decision: 'PERMIT' } });
    const d = await new PingOneAuthorizeClient(p1azOn).evaluate(decoded, 'tools/call', 'create_transfer', {});
    expect(d.decision).toBe('PERMIT');
    expect(d.policySource).toBe('p1az');
    expect(d.degraded).toBeFalsy();
  });

  test('a DENY from live P1AZ is still labelled p1az', async () => {
    mockedAxios.post.mockResolvedValueOnce({ status: 200, data: { decision: 'DENY', reason: 'nope' } });
    const d = await new PingOneAuthorizeClient(p1azOn).evaluate(decoded, 'tools/call', 'create_transfer', {});
    expect(d.decision).toBe('DENY');
    expect(d.policySource).toBe('p1az');
  });

  test('mock failover normalises the mock-failover engine to p1az-mock', async () => {
    mockedAxios.post
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce({ status: 200, data: { decision: 'PERMIT' } });
    const d = await new PingOneAuthorizeClient(p1azOn).evaluate(decoded, 'tools/call', 'create_transfer', {});
    expect(d.engine).toBe('mock-failover');
    expect(d.policySource).toBe('p1az-mock');
  });

  test('when the configured endpoint IS the mock, the label is p1az-mock', async () => {
    const mockOnly = { ...p1azOn, pingAuthorizeMockBase: p1azOn.pingAuthorizeEndpoint };
    mockedAxios.post.mockResolvedValueOnce({ status: 200, data: { decision: 'PERMIT' } });
    const d = await new PingOneAuthorizeClient(mockOnly).evaluate(decoded, 'tools/call', 'create_transfer', {});
    expect(d.policySource).toBe('p1az-mock');
  });

  test('a fail-closed DENY when the PDP is unreachable is still labelled, not silent', async () => {
    const noFailover = { ...p1azOn, pingAuthorizeMockBase: undefined };
    mockedAxios.post.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const d = await new PingOneAuthorizeClient(noFailover).evaluate(decoded, 'tools/call', 'create_transfer', {});
    expect(d.decision).toBe('DENY');
    expect(d.policySource).toBeDefined();
  });
});

describe('F1/C2 — the local scope engine is opt-in and always labelled', () => {
  beforeEach(() => jest.clearAllMocks());

  test('tools/call fails closed when P1AZ is off and the fallback is not opted in', async () => {
    const d = await new PingOneAuthorizeClient(p1azOff).evaluate(decoded, 'tools/call', 'get_my_accounts', {});
    expect(d.decision).toBe('DENY');
    expect(d.policySource).toBe('local-fallback');
    expect(d.degraded).toBe(true);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  test('opted-in tools/call PERMIT carries local-fallback + degraded', async () => {
    const d = await new PingOneAuthorizeClient(localOptIn).evaluate(decoded, 'tools/call', 'get_my_accounts', {});
    expect(d.decision).toBe('PERMIT');
    expect(d.policySource).toBe('local-fallback');
    expect(d.degraded).toBe(true);
  });

  test('opted-in tools/call DENY carries local-fallback + degraded', async () => {
    const noScope = { ...decoded, scope: '' };
    const d = await new PingOneAuthorizeClient(localOptIn).evaluate(noScope, 'tools/call', 'create_transfer', {});
    expect(d.decision).toBe('DENY');
    expect(d.policySource).toBe('local-fallback');
    expect(d.degraded).toBe(true);
  });

  test('a non-tools/call method degrades WITH A LABEL rather than hard-denying', async () => {
    const d = await new PingOneAuthorizeClient(localOptIn).evaluate(decoded, 'tools/list');
    expect(d.policySource).toBe('local-fallback');
    expect(d.degraded).toBe(true);
  });
});

describe('F1 — tools/list and tools/call now agree when P1AZ is off', () => {
  beforeEach(() => jest.clearAllMocks());

  test('both hard-deny when the fallback is not opted in', async () => {
    const call = await guardToolCall('get_my_accounts', decoded, p1azOff, {});
    const list = await guardToolsList(decoded, p1azOff, 'banking', ['get_my_accounts']);
    expect(call.permitted).toBe(false);
    expect(list.permitted).toBe(false);
    expect(call.policySource).toBe('local-fallback');
    expect(list.policySource).toBe('local-fallback');
    expect(call.degraded).toBe(true);
    expect(list.degraded).toBe(true);
  });

  test('both degrade-with-label when the fallback IS opted in', async () => {
    const call = await guardToolCall('get_my_accounts', decoded, localOptIn, {});
    const list = await guardToolsList(decoded, localOptIn, 'banking', ['get_my_accounts']);
    expect(call.permitted).toBe(true);
    expect(list.permitted).toBe(true);
    expect(call.policySource).toBe('local-fallback');
    expect(list.policySource).toBe('local-fallback');
    expect(call.degraded).toBe(true);
    expect(list.degraded).toBe(true);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  test('the degraded tools/list applies the local scope engine to its candidates', async () => {
    const noScope = { ...decoded, scope: '' };
    const list = await guardToolsList(noScope, localOptIn, 'banking', ['create_transfer']);
    expect(list.permitted).toBe(true);
    expect(list.deniedTools?.map((t) => t.name)).toContain('create_transfer');
  });

  test('a live tools/list decision is labelled p1az, not local-fallback', async () => {
    mockedAxios.post.mockResolvedValueOnce({ status: 200, data: { decision: 'PERMIT' } });
    const list = await guardToolsList(decoded, p1azOn, 'banking', ['get_my_accounts']);
    expect(list.permitted).toBe(true);
    expect(list.policySource).toBe('p1az');
    expect(list.degraded).toBeFalsy();
  });
});

/**
 * C1 rule 1 on the discovery path. guardToolsList builds its own parameter block
 * and had the SAME tautology as the tools/call path: TokenAudience and
 * McpResourceUri were both set to config.gatewayResourceUri.
 */
describe('C1 — guardToolsList sends the token\'s real audience', () => {
  beforeEach(() => jest.clearAllMocks());

  const sentParams = () => (mockedAxios.post.mock.calls[0][1] as any).parameters;

  test('TokenAudience reflects the token, not the expected resource URI', async () => {
    mockedAxios.post.mockResolvedValueOnce({ status: 200, data: { decision: 'PERMIT' } });
    await guardToolsList({ ...decoded, aud: 'a-different-audience' }, p1azOn, 'banking', []);
    expect(sentParams().TokenAudience).toBe('a-different-audience');
    expect(sentParams().McpResourceUri).toBe('mcpgateway.ping.demo');
  });

  test('an array aud contributes the full space-joined list (D-05: a decoy first entry cannot hide a real second audience from the PDP)', async () => {
    mockedAxios.post.mockResolvedValueOnce({ status: 200, data: { decision: 'PERMIT' } });
    await guardToolsList({ ...decoded, aud: ['aud-one', 'aud-two'] }, p1azOn, 'banking', []);
    expect(sentParams().TokenAudience).toBe('aud-one aud-two');
  });

  test('the audience key is omitted when the token has no aud', async () => {
    mockedAxios.post.mockResolvedValueOnce({ status: 200, data: { decision: 'PERMIT' } });
    await guardToolsList({ ...decoded, aud: undefined }, p1azOn, 'banking', []);
    expect(sentParams()).not.toHaveProperty('TokenAudience');
    expect(sentParams().McpResourceUri).toBe('mcpgateway.ping.demo');
  });
});
