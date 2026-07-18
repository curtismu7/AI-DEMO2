'use strict';
const { evaluate } = require('../../services/transactionInvariants');

function rec(hops) {
  return { correlationId: 'c1', hops: hops.map((h, i) => ({ seq: i + 1, ts: `2026-07-18T00:00:0${i}.000Z`, ...h })) };
}
function ids(result) {
  return result.violations.map((v) => v.id);
}
const PERMIT = { outcome: 'permit', by: 'pingauthorize', reason: 'ok' };
const DENY = { outcome: 'deny', by: 'pingauthorize', reason: 'Amount > 2000' };

describe('INV-5 decision coverage', () => {
  test('passes when a decision precedes the tool call', () => {
    const r = evaluate(rec([
      { service: 'authz-server', phase: 'authz.decision', op: 'create_withdrawal', decision: PERMIT },
      { service: 'mcp-server', phase: 'mcp.tool', op: 'create_withdrawal' },
    ]));
    expect(ids(r)).not.toContain('INV-5');
    expect(r.status).toBe('PASS');
  });

  test('a gateway.authorize hop also satisfies coverage', () => {
    const r = evaluate(rec([
      { service: 'mcp-gateway', phase: 'gateway.authorize', op: 'get_balance', decision: PERMIT },
      { service: 'mcp-server', phase: 'mcp.tool', op: 'get_balance' },
    ]));
    expect(ids(r)).not.toContain('INV-5');
  });

  test('INCOMPLETE when the record has no decision hop at all', () => {
    const r = evaluate(rec([
      { service: 'mcp-server', phase: 'mcp.tool', op: 'get_balance' },
    ]));
    expect(ids(r)).toContain('INV-5');
    expect(r.status).toBe('INCOMPLETE');
    expect(r.violations.find((v) => v.id === 'INV-5').severity).toBe('incomplete');
  });

  test('FAIL when decisions exist but none precedes the tool call', () => {
    const r = evaluate(rec([
      { service: 'mcp-server', phase: 'mcp.tool', op: 'create_withdrawal' },
      { service: 'authz-server', phase: 'authz.decision', op: 'create_withdrawal', decision: PERMIT },
    ]));
    expect(ids(r)).toContain('INV-5');
    expect(r.status).toBe('FAIL');
    expect(r.violations.find((v) => v.id === 'INV-5').severity).toBe('error');
  });
});

describe('INV-6 deny honored', () => {
  test('passes when a deny is followed by no tool call — the demo happy path for a blocked withdrawal', () => {
    const r = evaluate(rec([
      { service: 'authz-server', phase: 'authz.decision', op: 'create_withdrawal', decision: DENY },
      { service: 'demo-api-server', phase: 'response', op: '403' },
    ]));
    expect(ids(r)).not.toContain('INV-6');
  });

  test('fails when the tool ran after a deny for the same op', () => {
    const r = evaluate(rec([
      { service: 'authz-server', phase: 'authz.decision', op: 'create_withdrawal', decision: DENY },
      { service: 'mcp-server', phase: 'mcp.tool', op: 'create_withdrawal' },
    ]));
    expect(ids(r)).toContain('INV-6');
    expect(r.status).toBe('FAIL');
  });

  test('a deny for a different op does not block an unrelated tool', () => {
    const r = evaluate(rec([
      { service: 'authz-server', phase: 'authz.decision', op: 'create_withdrawal', decision: DENY },
      { service: 'authz-server', phase: 'authz.decision', op: 'get_balance', decision: PERMIT },
      { service: 'mcp-server', phase: 'mcp.tool', op: 'get_balance' },
    ]));
    expect(ids(r)).not.toContain('INV-6');
  });

  test('a deny with no op recorded blocks any later tool — an unattributable deny is not a free pass', () => {
    const r = evaluate(rec([
      { service: 'authz-server', phase: 'authz.decision', op: null, decision: DENY },
      { service: 'mcp-server', phase: 'mcp.tool', op: 'get_balance' },
    ]));
    expect(ids(r)).toContain('INV-6');
  });
});

describe('INV-7 consent binding', () => {
  test('passes when consented params match the executed params', () => {
    const r = evaluate(rec([
      { service: 'hitl-service', phase: 'hitl.consent', op: 'create_transfer', decision: PERMIT, params: { amount: 250, to_account_id: 'acc-1' } },
      { service: 'mcp-server', phase: 'mcp.tool', op: 'create_transfer', params: { amount: 250, to_account_id: 'acc-1' } },
    ]));
    expect(ids(r)).not.toContain('INV-7');
  });

  test('fails when the executed amount differs from the consented amount', () => {
    const r = evaluate(rec([
      { service: 'hitl-service', phase: 'hitl.consent', op: 'create_transfer', decision: PERMIT, params: { amount: 250, to_account_id: 'acc-1' } },
      { service: 'mcp-server', phase: 'mcp.tool', op: 'create_transfer', params: { amount: 5000, to_account_id: 'acc-1' } },
    ]));
    expect(ids(r)).toContain('INV-7');
    expect(r.violations.find((v) => v.id === 'INV-7').detail).toMatch(/amount/);
  });

  test('fails on a same-amount recipient swap', () => {
    const r = evaluate(rec([
      { service: 'hitl-service', phase: 'hitl.consent', op: 'create_transfer', decision: PERMIT, params: { amount: 250, to_account_id: 'acc-1' } },
      { service: 'mcp-server', phase: 'mcp.tool', op: 'create_transfer', params: { amount: 250, to_account_id: 'acc-999' } },
    ]));
    expect(ids(r)).toContain('INV-7');
    expect(r.violations.find((v) => v.id === 'INV-7').detail).toMatch(/to_account_id/);
  });

  test('fails when the tool ran after consent was denied', () => {
    const r = evaluate(rec([
      { service: 'hitl-service', phase: 'hitl.consent', op: 'create_transfer', decision: DENY, params: { amount: 250 } },
      { service: 'mcp-server', phase: 'mcp.tool', op: 'create_transfer', params: { amount: 250 } },
    ]));
    expect(ids(r)).toContain('INV-7');
  });

  test('fails when the tool declares consentRequired but no consent hop precedes it', () => {
    const r = evaluate(rec([
      { service: 'mcp-gateway', phase: 'gateway.authorize', op: 'create_transfer', decision: PERMIT },
      { service: 'mcp-server', phase: 'mcp.tool', op: 'create_transfer', consentRequired: true, params: { amount: 250 } },
    ]));
    expect(ids(r)).toContain('INV-7');
  });

  test('a tool with no consent hop and no consentRequired flag is not evaluated', () => {
    const r = evaluate(rec([
      { service: 'mcp-gateway', phase: 'gateway.authorize', op: 'get_balance', decision: PERMIT },
      { service: 'mcp-server', phase: 'mcp.tool', op: 'get_balance' },
    ]));
    expect(ids(r)).not.toContain('INV-7');
  });

  test('numeric and string amounts compare equal', () => {
    const r = evaluate(rec([
      { service: 'hitl-service', phase: 'hitl.consent', op: 'create_transfer', decision: PERMIT, params: { amount: '250.00' } },
      { service: 'mcp-server', phase: 'mcp.tool', op: 'create_transfer', params: { amount: 250 } },
    ]));
    expect(ids(r)).not.toContain('INV-7');
  });
});

describe('INV-8 temporal sanity', () => {
  test('passes on monotonic timestamps within token expiry', () => {
    const r = evaluate({
      correlationId: 'c1',
      hops: [
        { seq: 1, ts: '2026-07-18T00:00:00.000Z', service: 'a', phase: 'ui.request', identity: { exp: '2026-07-18T01:00:00.000Z' } },
        { seq: 2, ts: '2026-07-18T00:00:05.000Z', service: 'b', phase: 'response' },
      ],
    });
    expect(ids(r)).not.toContain('INV-8');
  });

  test('fails when a later seq has an earlier timestamp', () => {
    const r = evaluate({
      correlationId: 'c1',
      hops: [
        { seq: 1, ts: '2026-07-18T00:00:10.000Z', service: 'a', phase: 'ui.request' },
        { seq: 2, ts: '2026-07-18T00:00:00.000Z', service: 'b', phase: 'response' },
      ],
    });
    expect(ids(r)).toContain('INV-8');
    expect(r.violations.find((v) => v.id === 'INV-8').detail).toMatch(/order/i);
  });

  test('fails when a hop uses a token past its expiry', () => {
    const r = evaluate({
      correlationId: 'c1',
      hops: [
        { seq: 1, ts: '2026-07-18T02:00:00.000Z', service: 'b', phase: 'mcp.tool', op: 't', identity: { exp: '2026-07-18T01:00:00.000Z' } },
      ],
    });
    expect(ids(r)).toContain('INV-8');
    expect(r.violations.find((v) => v.id === 'INV-8').detail).toMatch(/expir/i);
  });

  test('an unparseable timestamp is skipped, not reported as a violation', () => {
    const r = evaluate({
      correlationId: 'c1',
      hops: [
        { seq: 1, ts: 'not-a-date', service: 'a', phase: 'ui.request' },
        { seq: 2, ts: '2026-07-18T00:00:00.000Z', service: 'b', phase: 'response' },
      ],
    });
    expect(ids(r)).not.toContain('INV-8');
  });
});
