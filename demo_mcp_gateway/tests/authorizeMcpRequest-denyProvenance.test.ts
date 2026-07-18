'use strict';

/**
 * F8 — deny reasons came from the wrong source.
 *
 * The denial body populated `required_scopes` from the LOCAL scope topology on
 * EVERY denial, including P1AZ denials for entirely unrelated reasons (amount
 * ceiling, tier, group membership, actor chain). The operator hint could
 * therefore contradict the actual decision: "you need scope X" when the token
 * already had scope X and the PDP denied because the amount was too large.
 *
 * `required_scopes` is only meaningful when the decision actually came from the
 * local scope engine, so it is only included then — and the response carries the
 * decision's provenance either way (contract C2).
 */

import { buildAuthorizeMcpRequest } from '../src/middleware/authorizeMcpRequest';
import type { GatewayConfig } from '../src/config';

const stubConfig = {
  devBypass: false,
  gatewayResourceUri: 'https://gateway.ping.demo',
  introspectionEndpoint: '',
} as unknown as GatewayConfig;

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

async function denyWith(authzDecision: Record<string, unknown>) {
  const middleware = buildAuthorizeMcpRequest(stubConfig, {
    introspect: async () => ({ active: true, sub: 'u1', exp: 9999999999 }),
    authorize: async () => authzDecision,
    exchange: async () => ({ token: 'x', targetAud: 'mcpserver.ping.demo', cached: false }),
  } as any);
  const { res, body, status } = makeRes();
  const rpc = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'create_transfer', arguments: { from_account_id: 'acct-1', to_account_id: 'acct-2', amount: 5000 } } };
  const forwarded: string[] = [];
  await middleware('tok', Buffer.from(JSON.stringify(rpc)),
    { headers: {}, socket: {} } as any, res, async (t) => { forwarded.push(t); });
  return { body, status, forwarded };
}

describe('F8 — required_scopes only when the local scope engine decided', () => {
  it('omits required_scopes on a P1AZ deny for an unrelated reason', async () => {
    const { body, forwarded } = await denyWith({
      decision: 'DENY',
      reason: 'mcp-tier-amount-exceeded: Standard tier limit is 2000',
      policySource: 'p1az',
    });
    expect(forwarded).toHaveLength(0);
    // The token's scopes have nothing to do with a tier-amount denial.
    expect(body()).not.toHaveProperty('required_scopes');
    expect(body().message).toMatch(/tier-amount-exceeded/);
  });

  it('includes required_scopes when the local scope engine produced the deny', async () => {
    const { body } = await denyWith({
      decision: 'DENY',
      reason: 'local-fallback: insufficient_scope: missing transfer',
      policySource: 'local-fallback',
      degraded: true,
    });
    expect(body().required_scopes).toEqual(expect.arrayContaining(['transfer']));
  });

  it('surfaces the decision provenance on the denial body (C2)', async () => {
    const { body } = await denyWith({
      decision: 'DENY', reason: 'nope', policySource: 'p1az',
    });
    expect(body().policy_source).toBe('p1az');
  });

  it('marks a degraded denial so it is not mistaken for a PDP verdict', async () => {
    const { body } = await denyWith({
      decision: 'DENY',
      reason: 'local-fallback: insufficient_scope: missing transfer',
      policySource: 'local-fallback',
      degraded: true,
    });
    expect(body().policy_source).toBe('local-fallback');
    expect(body().degraded).toBe(true);
  });

  it('a p1az-mock deny is labelled as such and still omits required_scopes', async () => {
    const { body } = await denyWith({
      decision: 'DENY', reason: 'mcp-not-in-required-group', policySource: 'p1az-mock',
    });
    expect(body().policy_source).toBe('p1az-mock');
    expect(body()).not.toHaveProperty('required_scopes');
  });
});
