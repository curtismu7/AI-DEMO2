'use strict';

/**
 * C2 — provenance on the paths the first pass missed.
 *
 * The C2 fix labelled DENY bodies and stopped there. Three gaps remained, and
 * the dangerous one is the PERMIT:
 *
 *   1. A degraded local-fallback PERMIT went out indistinguishable from a real
 *      PDP PERMIT. The audit trail recorded `decision: PERMIT` and nothing about
 *      WHO decided, so the audit trail could not tell a PDP verdict from the
 *      gateway deciding for itself.
 *   2. The `hitl_required` branch still emitted `required_scopes` unconditionally
 *      — the exact defect F8 fixed one branch lower down.
 *   3. The HTTP 4xx `authorize_config_error` and the middleware's catch-all DENY
 *      carried no provenance while their siblings did.
 */

import axios from 'axios';
import {
  PingOneAuthorizeClient,
  POLICY_SOURCES,
  type PolicySource,
} from '../src/auth/PingOneAuthorizeClient';
import { guardToolCall, guardToolsList } from '../src/pingAuthorizeGuard';
import { buildAuthorizeMcpRequest } from '../src/middleware/authorizeMcpRequest';
import { buildAuthzHealth } from '../src/authzPosture';
import type { GatewayConfig } from '../src/config';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const stubConfig = {
  devBypass: false,
  gatewayResourceUri: 'https://gateway.ping.demo',
  introspectionEndpoint: '',
} as unknown as GatewayConfig;

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

/** Drive the HTTP middleware with an injected decision and return what went out. */
async function runWith(authorize: () => Promise<any>, toolName = 'create_transfer') {
  const middleware = buildAuthorizeMcpRequest(stubConfig, {
    introspect: async () => ({ active: true, sub: 'u1', exp: 9999999999 }),
    authorize,
    exchange: async () => ({ token: 'x', targetAud: 'mcpserver.ping.demo', cached: false }),
  } as any);
  const harness = makeRes();
  const rpc = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: toolName, arguments: { from_account_id: 'acct-1', to_account_id: 'acct-2', amount: 5000 } },
  };
  const forwarded: string[] = [];
  await middleware('tok', Buffer.from(JSON.stringify(rpc)),
    { headers: {}, socket: {} } as any, harness.res, async (t) => { forwarded.push(t); });
  return { ...harness, forwarded };
}

/**
 * GAP 1 — the unlabelled PERMIT.
 *
 * A PERMIT is forwarded upstream, so the response BODY belongs to the backend.
 * The gateway's own channel for "what did I decide and why" is the
 * X-Gw-Audit-Trail header, which it already sets on the forward path — it just
 * never carried the provenance. A degraded PERMIT that reads exactly like a PDP
 * PERMIT is the failure mode C2 exists to prevent.
 */
describe('C2 — a PERMIT carries its provenance, not just a DENY', () => {
  it('labels a degraded local-fallback PERMIT in the audit trail', async () => {
    const { auditTrail, forwarded } = await runWith(async () => ({
      decision: 'PERMIT',
      reason: 'local-fallback: local scope engine (degraded — not a PDP decision)',
      policySource: 'local-fallback',
      degraded: true,
    }));
    expect(forwarded).toHaveLength(1);
    expect(auditTrail().authorize.policySource).toBe('local-fallback');
    expect(auditTrail().authorize.degraded).toBe(true);
  });

  it('a real PDP PERMIT is distinguishable from the degraded one', async () => {
    const { auditTrail } = await runWith(async () => ({
      decision: 'PERMIT',
      policySource: 'p1az',
      decisionId: 'dec-1',
    }));
    expect(auditTrail().authorize.policySource).toBe('p1az');
    expect(auditTrail().authorize.degraded).toBeFalsy();
  });

  it('stamps denyingFilter=P1AZDecision and filterChain on DENY', async () => {
    const { auditTrail, status } = await runWith(async () => ({
      decision: 'DENY',
      reason: 'policy deny',
      policySource: 'p1az',
    }));
    expect(status()).toBe(403);
    expect(auditTrail().denyingFilter).toBe('P1AZDecision');
    expect(Array.isArray(auditTrail().filterChain)).toBe(true);
    expect(auditTrail().filterChain.some((s: any) => s.filter === 'P1AZDecision' && s.result === 'blocked')).toBe(true);
  });

  it('stamps lastFilter=BackendExchange on PERMIT forward after exchange', async () => {
    const { auditTrail, forwarded } = await runWith(async () => ({
      decision: 'PERMIT',
      policySource: 'p1az',
    }));
    expect(forwarded).toHaveLength(1);
    expect(auditTrail().lastFilter).toBe('BackendExchange');
    expect(auditTrail().denyingFilter).toBeUndefined();
    expect(auditTrail().filterChain).toEqual(expect.arrayContaining([
      expect.objectContaining({ filter: 'TokenIntrospection', result: 'passed' }),
      expect.objectContaining({ filter: 'P1AZDecision', result: 'forwarded' }),
      expect.objectContaining({ filter: 'BackendExchange', result: 'forwarded' }),
    ]));
  });
});

/**
 * GAP 2 — F8 was fixed on the insufficient_scope branch only. The HITL branch
 * returns a body to the same caller with the same misleading hint.
 */
describe('F8 — the hitl_required branch gates required_scopes too', () => {
  it('omits required_scopes when the PDP asked for human approval', async () => {
    const { body, status } = await runWith(async () => ({
      decision: 'INDETERMINATE',
      reason: 'HITL_REQUIRED',
      policySource: 'p1az',
    }));
    // 428, not 403: the PDP asked for a human, it did not refuse the call. The
    // precondition the caller must satisfy is an approved consent receipt.
    expect(status()).toBe(428);
    expect(body().error).toBe('hitl_required');
    // The token's scopes are not what is missing — a human is.
    expect(body()).not.toHaveProperty('required_scopes');
  });

  it('keeps required_scopes when the local scope engine produced the hold', async () => {
    const { body } = await runWith(async () => ({
      decision: 'INDETERMINATE',
      reason: 'HITL_REQUIRED',
      policySource: 'local-fallback',
      degraded: true,
    }));
    expect(body().error).toBe('hitl_required');
    expect(body().required_scopes).toEqual(expect.arrayContaining(['transfer']));
  });

  it('the hitl body carries provenance like every other decision', async () => {
    const { body } = await runWith(async () => ({
      decision: 'INDETERMINATE', reason: 'HITL_REQUIRED', policySource: 'p1az',
    }));
    expect(body().policy_source).toBe('p1az');
  });
});

/** GAP 3a — the middleware's catch-all DENY invented a verdict with no author. */
describe('C2 — the catch-all DENY names an authority', () => {
  it('labels the DENY it manufactures when the authorize call throws', async () => {
    const { body, status } = await runWith(async () => { throw new Error('boom'); });
    expect(status()).toBe(403);
    expect(body().policy_source).toBeDefined();
    // No PDP is configured on stubConfig, so the gateway itself decided.
    expect(body().policy_source).toBe('local-fallback');
    expect(body().degraded).toBe(true);
  });
});

/** GAP 3b — the HTTP 4xx path lost the label its WS sibling kept. */
describe('C2 — authorize_config_error is labelled on BOTH transports', () => {
  const p1azOn: any = {
    pingAuthorizeEndpoint: 'https://pdp.test/authz',
    pingAuthorizeMockBase: 'http://pdp-mock.test:9001',
    pingAuthorizeWorkerId: 'mcp-gateway',
    gatewayResourceUri: 'mcpgateway.ping.demo',
    p1azEnabled: true,
  };
  const decoded: any = { sub: 'u1', scope: 'read transfer', act: { sub: 'agent' } };

  beforeEach(() => jest.clearAllMocks());

  it('the HTTP client labels a 4xx config error', async () => {
    mockedAxios.post.mockResolvedValueOnce({ status: 400, data: { message: 'bad parameters' } });
    const d = await new PingOneAuthorizeClient(p1azOn).evaluate(decoded, 'tools/call', 'create_transfer', {});
    expect(d.reason).toMatch(/authorize_config_error/);
    expect(d.policySource).toBe('p1az');
  });

  it('the WS guard already did — the two now agree', async () => {
    mockedAxios.post.mockResolvedValueOnce({ status: 400, data: { message: 'bad parameters' } });
    const g = await guardToolCall('create_transfer', decoded, p1azOn, {});
    expect(g.reason).toMatch(/authorize_config_error/);
    expect(g.policySource).toBe('p1az');
  });
});

/**
 * THE pairing invariant.
 *
 * Health (`buildAuthzHealth`) and every decision path (`PingOneAuthorizeClient`,
 * `guardToolsList`, `guardToolCall`) each answer "is this a REAL PDP or the
 * mock?" independently. They MUST agree for the same config: a `/health` that
 * says `p1az` while every decision says `p1az-mock` (or the reverse) is exactly
 * the divergence this branch exists to remove. The two derivations drifted apart
 * once precisely because each had its own copy of the predicate — so this locks
 * the pairing rather than the individual values.
 *
 * The real-cloud-only shape (a real endpoint, NO mock base to fail over to) is
 * the case that was broken: health reported `p1az`, the decision paths reported
 * `p1az-mock`.
 */
describe('the health block and the decision path report the SAME policy source', () => {
  const decoded: any = { sub: 'u1', scope: 'read transfer', act: { sub: 'agent' } };

  const scenarios: Array<{ name: string; config: any; expected: PolicySource }> = [
    {
      name: 'real endpoint with the mock as a failover target',
      config: {
        pingAuthorizeEndpoint: 'https://pdp.test/authz',
        pingAuthorizeMockBase: 'http://pdp-mock.test:9001',
        pingAuthorizeWorkerId: 'gw', gatewayResourceUri: 'mcpgateway.ping.demo', p1azEnabled: true,
      },
      expected: 'p1az',
    },
    {
      name: 'the endpoint IS the declared mock',
      config: {
        pingAuthorizeEndpoint: 'http://pdp-mock.test:9001',
        pingAuthorizeMockBase: 'http://pdp-mock.test:9001',
        pingAuthorizeWorkerId: 'gw', gatewayResourceUri: 'mcpgateway.ping.demo', p1azEnabled: true,
      },
      expected: 'p1az-mock',
    },
    {
      name: 'real-cloud only — a real endpoint with NO mock base (the broken case)',
      config: {
        pingAuthorizeEndpoint: 'https://pdp.test/authz',
        pingAuthorizeMockBase: undefined,
        pingAuthorizeWorkerId: 'gw', gatewayResourceUri: 'mcpgateway.ping.demo', p1azEnabled: true,
      },
      expected: 'p1az',
    },
  ];

  beforeEach(() => jest.clearAllMocks());

  for (const { name, config, expected } of scenarios) {
    it(`agree on "${name}"`, async () => {
      // A 200 + PERMIT from whichever base the client dials — the label comes
      // from the config-derived engine, not from the response.
      mockedAxios.post.mockResolvedValue({ status: 200, data: { decision: 'PERMIT' } } as any);

      const health = buildAuthzHealth(config as GatewayConfig).policySource;
      const call = await new PingOneAuthorizeClient(config).evaluate(decoded, 'tools/call', 'get_my_accounts', {});
      const list = await guardToolsList(decoded, config, 'banking', ['get_my_accounts']);
      const wsCall = await guardToolCall('get_my_accounts', decoded, config, {});

      // All four are the same fact about the same config.
      expect(health).toBe(expected);
      expect(call.policySource).toBe(expected);
      expect(list.policySource).toBe(expected);
      expect(wsCall.policySource).toBe(expected);
    });
  }
});

/**
 * 'simulated' was declared in the union and produced by nothing in this service.
 * A vocabulary the gateway cannot speak is a claim of coverage it does not have.
 */
describe('C2 — the policy-source vocabulary matches what the gateway produces', () => {
  it('does not advertise a source no gateway path emits', () => {
    expect(POLICY_SOURCES).not.toContain('simulated');
  });

  it('advertises exactly the three the gateway can produce', () => {
    expect([...POLICY_SOURCES].sort()).toEqual(['local-fallback', 'p1az', 'p1az-mock']);
  });
});
