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
    introspect: async () => ({ active: true, sub: 'u1', exp: 9999999999, scope: 'write transfer' }),
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

  it('a p1az-mock deny still omits required_scopes', async () => {
    const { body } = await denyWith({
      decision: 'DENY', reason: 'mcp-not-in-required-group', policySource: 'p1az-mock',
    });
    expect(body()).not.toHaveProperty('required_scopes');
  });
});

/**
 * Writing `policySource: 'p1az'` into a stub and then asserting
 * `policy_source === 'p1az'` proves one thing: the middleware copies a field
 * under a new name. It cannot fail for any reason that matters. What has to
 * hold is that the rendering DISCRIMINATES — that two different authorities
 * produce two visibly different bodies, and that the middleware never supplies
 * a provenance the decision did not carry.
 *
 * (The complementary proof — that the gateway PRODUCES the right provenance
 * rather than echoing an injected one — is in
 * authorizeMcpRequest.productionPath.test.ts, which runs the real client.)
 */
describe('C2 — the denial body discriminates between authorities', () => {
  it('a PDP deny and a gateway-local deny are not interchangeable on the wire', async () => {
    const pdp = (await denyWith({
      decision: 'DENY', reason: 'mcp-tier-amount-exceeded', policySource: 'p1az',
    })).body();
    const local = (await denyWith({
      decision: 'DENY', reason: 'local-fallback: insufficient_scope: missing transfer',
      policySource: 'local-fallback', degraded: true,
    })).body();

    // Three independent signals separate them; a reader of either body can tell
    // which authority spoke without consulting anything else.
    expect(pdp.policy_source).not.toBe(local.policy_source);
    expect(pdp.degraded).toBeUndefined();
    expect(local.degraded).toBe(true);
    expect(pdp).not.toHaveProperty('required_scopes');
    expect(local).toHaveProperty('required_scopes');
  });

  it('never invents a provenance the decision did not carry', async () => {
    // A decision path that forgets to label itself must surface as unlabelled,
    // not be silently defaulted to the most reassuring value.
    const { body } = await denyWith({ decision: 'DENY', reason: 'unlabelled' });
    expect(body().policy_source).toBeUndefined();
    expect(body()).not.toHaveProperty('required_scopes');
  });

  it('degraded is only claimed when the decision claimed it', async () => {
    // A local-fallback decision that (wrongly) omitted degraded must not have it
    // manufactured from the policySource — the two fields are set by the engine.
    const { body } = await denyWith({
      decision: 'DENY', reason: 'local-fallback: insufficient_scope', policySource: 'local-fallback',
    });
    expect(body()).not.toHaveProperty('degraded');
    expect(body().policy_source).toBe('local-fallback');
  });
});
