'use strict';
const { evaluate } = require('../../services/transactionInvariants');

function rec(hops) {
  return { correlationId: 'c1', hops: hops.map((h, i) => ({ seq: i + 1, ts: `2026-07-18T00:00:0${i}.000Z`, ...h })) };
}
function ids(result) {
  return result.violations.map((v) => v.id).sort();
}

describe('INV-1 actor chain continuity', () => {
  test('passes when every exchanged token carries an act chain', () => {
    const r = evaluate(rec([
      { service: 'demo-api-server', phase: 'token.exchange', identity: { sub: 'u', tokenType: 'exchanged_token', act: ['agent-gw'], aud: 'mcp' } },
      { service: 'mcp-server', phase: 'mcp.tool', op: 'get_balance', identity: { sub: 'u', tokenType: 'exchanged_token', act: ['agent-gw'], aud: 'mcp' } },
    ]));
    expect(ids(r)).not.toContain('INV-1');
  });

  test('fails when an exchanged token has an empty act chain', () => {
    const r = evaluate(rec([
      { service: 'demo-api-server', phase: 'token.exchange', identity: { sub: 'u', tokenType: 'exchanged_token', act: [], aud: 'mcp' } },
    ]));
    expect(ids(r)).toContain('INV-1');
    expect(r.status).toBe('FAIL');
  });

  test('does not fire on a plain user token', () => {
    const r = evaluate(rec([
      { service: 'demo-api-server', phase: 'ui.request', identity: { sub: 'u', tokenType: 'user_token', act: [] } },
    ]));
    expect(ids(r)).not.toContain('INV-1');
  });
});

describe('INV-2 subject stability', () => {
  test('passes when every hop names the same subject', () => {
    const r = evaluate(rec([
      { service: 'a', phase: 'ui.request', identity: { sub: 'u1' } },
      { service: 'b', phase: 'mcp.tool', op: 't', identity: { sub: 'u1' } },
    ]));
    expect(ids(r)).not.toContain('INV-2');
  });

  test('fails when the subject changes mid-transaction', () => {
    const r = evaluate(rec([
      { service: 'a', phase: 'ui.request', identity: { sub: 'u1' } },
      { service: 'b', phase: 'mcp.tool', op: 't', identity: { sub: 'u2' } },
    ]));
    expect(ids(r)).toContain('INV-2');
    expect(r.violations.find((v) => v.id === 'INV-2').detail).toMatch(/u1.*u2|u2.*u1/);
  });

  test('hops with no subject are ignored, not treated as a change', () => {
    const r = evaluate(rec([
      { service: 'a', phase: 'ui.request', identity: { sub: 'u1' } },
      { service: 'b', phase: 'agent.reason' },
      { service: 'c', phase: 'mcp.tool', op: 't', identity: { sub: 'u1' } },
    ]));
    expect(ids(r)).not.toContain('INV-2');
  });

  test('attributes the divergence to the hop that actually diverged (A,B,A), not the first or last hop', () => {
    const r = evaluate(rec([
      { service: 'a', phase: 'ui.request', identity: { sub: 'A' } },
      { service: 'b', phase: 'mcp.tool', op: 't', identity: { sub: 'B' } },
      { service: 'c', phase: 'mcp.tool', op: 't', identity: { sub: 'A' } },
    ]));
    expect(ids(r)).toContain('INV-2');
    expect(r.violations.find((v) => v.id === 'INV-2').hopSeq).toBe(2);
  });
});

describe('INV-3 no scope escalation', () => {
  test('passes when scopes narrow monotonically', () => {
    const r = evaluate(rec([
      { service: 'a', phase: 'token.exchange', identity: { sub: 'u', scopes: ['banking:read', 'banking:write'], aud: 'x' } },
      { service: 'b', phase: 'mcp.tool', op: 't', identity: { sub: 'u', scopes: ['banking:read'], aud: 'x' } },
    ]));
    expect(ids(r)).not.toContain('INV-3');
  });

  test('fails when a later hop gains a scope', () => {
    const r = evaluate(rec([
      { service: 'a', phase: 'token.exchange', identity: { sub: 'u', scopes: ['banking:read'], aud: 'x' } },
      { service: 'b', phase: 'mcp.tool', op: 't', identity: { sub: 'u', scopes: ['banking:read', 'banking:transfer'], aud: 'x' } },
    ]));
    expect(ids(r)).toContain('INV-3');
    expect(r.violations.find((v) => v.id === 'INV-3').detail).toContain('banking:transfer');
  });

  test('hops with no scopes do not break the chain', () => {
    const r = evaluate(rec([
      { service: 'a', phase: 'token.exchange', identity: { sub: 'u', scopes: ['banking:read'], aud: 'x' } },
      { service: 'b', phase: 'agent.reason' },
      { service: 'c', phase: 'mcp.tool', op: 't', identity: { sub: 'u', scopes: ['banking:read'], aud: 'x' } },
    ]));
    expect(ids(r)).not.toContain('INV-3');
  });

  test('flags an escalation across a scope-less gap (a reset-on-empty implementation would miss this)', () => {
    const r = evaluate(rec([
      { service: 'a', phase: 'token.exchange', identity: { sub: 'u', scopes: ['banking:read'], aud: 'x' } },
      { service: 'b', phase: 'agent.reason' },
      { service: 'c', phase: 'mcp.tool', op: 't', identity: { sub: 'u', scopes: ['banking:read', 'banking:transfer'], aud: 'x' } },
    ]));
    expect(ids(r)).toContain('INV-3');
    expect(r.violations.find((v) => v.id === 'INV-3').detail).toContain('banking:transfer');
  });

  test('trims whitespace before comparing so formatting drift is not read as escalation', () => {
    const r = evaluate(rec([
      { service: 'a', phase: 'token.exchange', identity: { sub: 'u', scopes: ['banking:read'], aud: 'x' } },
      { service: 'b', phase: 'mcp.tool', op: 't', identity: { sub: 'u', scopes: ['banking:read '], aud: 'x' } },
    ]));
    expect(ids(r)).not.toContain('INV-3');
  });
});

describe('INV-4 audience minted in this transaction', () => {
  test('passes when a presented audience was minted by an earlier exchange', () => {
    const r = evaluate(rec([
      { service: 'a', phase: 'token.exchange', identity: { sub: 'u', aud: 'mcp-server' } },
      { service: 'b', phase: 'mcp.tool', op: 't', identity: { sub: 'u', aud: 'mcp-server' } },
    ]));
    expect(ids(r)).not.toContain('INV-4');
  });

  test('fails when a hop presents an audience nobody minted here', () => {
    const r = evaluate(rec([
      { service: 'a', phase: 'token.exchange', identity: { sub: 'u', aud: 'mcp-server' } },
      { service: 'b', phase: 'mcp.tool', op: 't', identity: { sub: 'u', aud: 'payments-api' } },
    ]));
    expect(ids(r)).toContain('INV-4');
    expect(r.violations.find((v) => v.id === 'INV-4').detail).toContain('payments-api');
  });

  test('does not evaluate when the transaction has no exchange hop', () => {
    const r = evaluate(rec([
      { service: 'b', phase: 'mcp.tool', op: 't', identity: { sub: 'u', aud: 'anything' } },
    ]));
    expect(ids(r)).not.toContain('INV-4');
  });

  test('accepts an array-valued aud when one entry was minted', () => {
    const r = evaluate(rec([
      { service: 'a', phase: 'token.exchange', identity: { sub: 'u', aud: 'mcp-server' } },
      { service: 'b', phase: 'mcp.tool', op: 't', identity: { sub: 'u', aud: ['mcp-server', 'other'] } },
    ]));
    expect(ids(r)).not.toContain('INV-4');
  });

  test('flags an audience presented before the later exchange hop that mints it (order matters)', () => {
    const r = evaluate(rec([
      { service: 'a', phase: 'mcp.tool', op: 't', identity: { sub: 'u', aud: 'payments-api' } },
      { service: 'b', phase: 'token.exchange', identity: { sub: 'u', aud: 'payments-api' } },
    ]));
    expect(ids(r)).toContain('INV-4');
    expect(r.violations.find((v) => v.id === 'INV-4').hopSeq).toBe(1);
  });
});

describe('evaluate status', () => {
  test('a clean record is PASS with no violations', () => {
    const r = evaluate(rec([
      { service: 'a', phase: 'ui.request', identity: { sub: 'u' } },
      { service: 'b', phase: 'response' },
    ]));
    expect(r.status).toBe('PASS');
    expect(r.violations).toEqual([]);
  });

  test('an empty record is PASS, not a crash', () => {
    expect(evaluate({ correlationId: 'c1', hops: [] }).status).toBe('PASS');
    expect(evaluate({ correlationId: 'c1' }).status).toBe('PASS');
  });
});
