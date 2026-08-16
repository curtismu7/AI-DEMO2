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
