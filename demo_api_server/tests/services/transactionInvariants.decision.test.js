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

  // The 'unknown' string is an emitter sentinel (HttpMCPTransport.ts's
  // `op: String(params?.name ?? 'unknown')`, the MCP gateway's `_audCtx`
  // default), not a real tool name. It must be treated as unattributable
  // exactly like a null/absent op.
  test('a deny with the sentinel op "unknown" still blocks a later, differently-named tool', () => {
    const r = evaluate(rec([
      { service: 'mcp-gateway', phase: 'gateway.authorize', op: 'unknown', decision: DENY },
      { service: 'mcp-server', phase: 'mcp.tool', op: 'create_withdrawal' },
    ]));
    const v = r.violations.find((x) => x.id === 'INV-6');
    expect(v).toBeDefined();
    expect(v.detail).toMatch(/unattributable/i);
    expect(v.detail).not.toMatch(/same operation/i);
  });

  test('two unrelated hops that both happen to carry the sentinel op are not reported as the same operation', () => {
    const r = evaluate(rec([
      { service: 'mcp-gateway', phase: 'gateway.authorize', op: 'unknown', decision: DENY },
      { service: 'mcp-server', phase: 'mcp.tool', op: 'unknown' },
    ]));
    const v = r.violations.find((x) => x.id === 'INV-6');
    // Still blocked — an unattributable deny is not a free pass — but the
    // detail must not claim it matched "the same operation" by sentinel
    // string equality.
    expect(v).toBeDefined();
    expect(v.detail).toMatch(/unattributable/i);
    expect(v.detail).not.toMatch(/same operation/i);
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

  // Latest matching consent wins — mirrors real-time re-consent / step-up,
  // where only the CURRENT HITL status is ever checked. An earlier, broader
  // consent that was superseded must not govern.
  test('the LATER of two same-op consents governs, not the earlier broader one', () => {
    const r = evaluate(rec([
      { service: 'hitl-service', phase: 'hitl.consent', op: 'create_transfer', decision: PERMIT, params: { amount: 5000, to_account_id: 'acc-1' } },
      { service: 'hitl-service', phase: 'hitl.consent', op: 'create_transfer', decision: PERMIT, params: { amount: 250, to_account_id: 'acc-1' } },
      { service: 'mcp-server', phase: 'mcp.tool', op: 'create_transfer', params: { amount: 250, to_account_id: 'acc-1' } },
    ]));
    expect(ids(r)).not.toContain('INV-7');
  });

  test('collects every mismatched account key into a single violation rather than stopping at the first', () => {
    const r = evaluate(rec([
      { service: 'hitl-service', phase: 'hitl.consent', op: 'create_transfer', decision: PERMIT, params: { amount: 250, to_account_id: 'acc-1', account_id: 'src-1' } },
      { service: 'mcp-server', phase: 'mcp.tool', op: 'create_transfer', params: { amount: 250, to_account_id: 'acc-999', account_id: 'src-999' } },
    ]));
    const violations = r.violations.filter((v) => v.id === 'INV-7');
    expect(violations).toHaveLength(1);
    // Distinct values (not just key names, since "account_id" is a substring
    // of "to_account_id") so this actually pins that BOTH mismatches were
    // collected, not just whichever key comes first in CONSENT_BOUND_KEYS.
    expect(violations[0].detail).toContain('to_account_id=acc-999');
    expect(violations[0].detail).toContain('account_id=src-999');
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

  test('an unparseable-timestamp hop does not corrupt the baseline used for later ordering checks', () => {
    const r = evaluate({
      correlationId: 'c1',
      hops: [
        { seq: 1, ts: '2026-07-18T00:00:10.000Z', service: 'a', phase: 'ui.request' },
        { seq: 2, ts: 'not-a-date', service: 'b', phase: 'response' },
        // Out of order relative to hop 1 (not hop 2, which was skipped).
        { seq: 3, ts: '2026-07-18T00:00:05.000Z', service: 'c', phase: 'response' },
      ],
    });
    const v = r.violations.find((x) => x.id === 'INV-8');
    expect(v).toBeDefined();
    expect(v.hopSeq).toBe(3);
  });
});
