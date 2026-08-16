'use strict';
/**
 * Canary: vertical mutators must honour the id the caller named.
 *
 * Phase 2 admin writeAction (#1477) already refused unknown rows on the
 * support-console path. The MCP/agent mutators still fell back to "first open /
 * first outstanding" on a miss — so a typo or a WO-4002 phrase that the
 * extractor truncated to "4002" silently mutated a different record and
 * reported success.
 */
const { createManufacturingStore } = require('../config/verticals/manufacturing/data');
const { createGovernmentStore } = require('../config/verticals/government/data');
const { buildManufacturingTools } = require('../config/verticals/manufacturing/tools');
const { buildGovernmentTools } = require('../config/verticals/government/tools');
const { parseHeuristic, resolveVerticalCtx } = require('../services/nlIntentParser');

describe('manufacturing releaseWorkOrder id honour', () => {
  it('does not release a different work order when the id is unknown', () => {
    const store = createManufacturingStore();
    const before = store.get('u1').workOrders.map((w) => ({ id: w.id, status: w.status }));

    const result = store.releaseWorkOrder('u1', 'WO-does-not-exist');
    expect(result).toBeNull();

    const after = store.get('u1').workOrders.map((w) => ({ id: w.id, status: w.status }));
    expect(after).toEqual(before);
  });

  it('releases the named work order, including bare numeric / WO- forms', () => {
    const store = createManufacturingStore();
    const byFull = store.releaseWorkOrder('u1', 'WO-4002');
    expect(byFull).toMatchObject({ id: 'WO-4002', status: 'Released' });

    const store2 = createManufacturingStore();
    const byBare = store2.releaseWorkOrder('u1', '4003');
    expect(byBare).toMatchObject({ id: 'WO-4003', status: 'Released' });
  });

  it('agent tool path with a bad orderId does not mutate another row', async () => {
    const store = createManufacturingStore();
    const { execute } = buildManufacturingTools(store);
    const openBefore = store.get('u1').workOrders.filter((w) => w.status !== 'Released').map((w) => w.id);

    const out = await execute('release_work_order', { orderId: 'WO-9999' }, { userId: 'u1' });
    expect(out.result.error || out.result.status).toBeTruthy();
    expect(out.result.id).toBeUndefined();

    const openAfter = store.get('u1').workOrders.filter((w) => w.status !== 'Released').map((w) => w.id);
    expect(openAfter).toEqual(openBefore);
  });
});

describe('manufacturing approve_purchase_order status guard', () => {
  it('approves a genuinely Pending Approval PO via explicit id', async () => {
    const store = createManufacturingStore();
    const { execute } = buildManufacturingTools(store);
    const out = await execute('approve_purchase_order', { poId: 'PO-6001', amount: 300 }, { userId: 'u1' });
    expect(out.result.status).toBe('Approved');
    expect(out.result.id).toBe('PO-6001');
  });

  it('rejects re-approving an already-Delivered PO via explicit id (no silent mutation)', async () => {
    const store = createManufacturingStore();
    const { execute } = buildManufacturingTools(store);
    const before = structuredClone(store.get('u1').purchaseOrders.find((p) => p.id === 'PO-6004'));
    expect(before.status).toBe('Delivered');

    const out = await execute('approve_purchase_order', { poId: 'PO-6004', amount: 300 }, { userId: 'u1' });
    expect(out.result.error).toBeTruthy();

    const after = store.get('u1').purchaseOrders.find((p) => p.id === 'PO-6004');
    expect(after).toEqual(before);
  });

  it('no-id fallback picks a genuinely Pending Approval PO, not just arr[0]', async () => {
    const store = createManufacturingStore();
    const { execute } = buildManufacturingTools(store);
    // The dead-code match was `_arr.find(status === 'Pending')` — the real seed value
    // is 'Pending Approval', so that branch never matched and the fallback silently
    // degraded to arr[0] regardless of status. Put a non-pending PO first to prove the
    // fallback now genuinely prefers a Pending Approval row over blindly taking arr[0].
    const pos = store.get('u1').purchaseOrders;
    pos[0].status = 'Approved'; // PO-6001, normally first and Pending Approval
    const nextPending = pos.find((p) => p.id !== pos[0].id && p.status === 'Pending Approval');
    expect(nextPending).toBeTruthy();

    const out = await execute('approve_purchase_order', { amount: 300 }, { userId: 'u1' });
    expect(out.result.status).toBe('Approved');
    expect(out.result.id).toBe(nextPending.id);
  });

  it('no-id fallback still completes (does not error) when every PO is already non-pending', async () => {
    const store = createManufacturingStore();
    const { execute } = buildManufacturingTools(store);
    // The amount-driven chip ("approve a $300 purchase order") carries no id and must
    // always complete for the demo to run — useCases.chipCompletes.test.js enforces this
    // across every vertical's amount-gated tool. Unlike the explicit-id path, the no-id
    // fallback intentionally does not gate on status, so exhausting every Pending Approval
    // PO (e.g. from repeated UC6/7/8/22 demo calls sharing one store) still succeeds.
    const pos = store.get('u1').purchaseOrders;
    pos.forEach((p) => { p.status = 'Delivered'; });

    const out = await execute('approve_purchase_order', { amount: 300 }, { userId: 'u1' });
    expect(out.result.error).toBeUndefined();
    expect(out.result.status).toBe('Approved');
    expect(out.result.id).toBe(pos[0].id);
  });

  it('does not gate on amount vs PO total — amount only drives the upstream Authorize amount-band gate (UC6/7/8), same as healthcare pay_bill', async () => {
    const store = createManufacturingStore();
    const { execute } = buildManufacturingTools(store);
    // PO-6001's real total is 8750; the UC6/7/8 demo intentionally passes synthetic
    // amounts (300/600/2500 — see stepVerification.amountGateBand.test.js) that never
    // match a real PO total, so handler-level amount==total validation would break
    // the demo's amount-gate chips.
    const out = await execute('approve_purchase_order', { poId: 'PO-6001', amount: 300 }, { userId: 'u1' });
    expect(out.result.status).toBe('Approved');
    expect(out.result.total).toBe(8750);
  });
});

describe('government payFee id honour', () => {
  it('does not pay a different fee when permitId is unknown', () => {
    const store = createGovernmentStore();
    const before = structuredClone(store.get('u1').fees);

    const result = store.payFee('u1', { permitId: 'P-DOES-NOT-EXIST', amount: 999 });
    expect(result.error).toBe('fee not found');
    expect(store.get('u1').fees).toEqual(before);
  });

  it('pays the named permit when permitId matches', () => {
    const store = createGovernmentStore();
    const result = store.payFee('u1', { permitId: 'P-1003' });
    expect(result.error).toBeUndefined();
    expect(result.permitId).toBe('P-1003');
    expect(result.status).toBe('Paid');
    const item = store.get('u1').fees.items.find((f) => f.permitId === 'P-1003');
    expect(item.status).toBe('Paid');
    const other = store.get('u1').fees.items.find((f) => f.permitId === 'P-1001');
    expect(other.status).toBe('Outstanding');
  });

  it('agent tool path with a bad permitId does not mutate another fee', async () => {
    const store = createGovernmentStore();
    const { execute } = buildGovernmentTools(store);
    const before = structuredClone(store.get('u1').fees);

    const out = await execute('pay_fee', { permitId: 'P-NOPE', amount: 50 }, { userId: 'u1' });
    expect(out.result.error).toBe('fee not found');
    expect(store.get('u1').fees).toEqual(before);
  });
});

describe('manufacturing release heuristic extracts WO- ids', () => {
  const mfgCtx = resolveVerticalCtx('manufacturing');

  it('captures WO-4002 whole, not the trailing digits alone', () => {
    const r = parseHeuristic('release work order WO-4002', 'manufacturing', mfgCtx, {});
    expect(r.action).toBe('release_work_order');
    expect(r.params.orderId).toBe('WO-4002');
  });
});
