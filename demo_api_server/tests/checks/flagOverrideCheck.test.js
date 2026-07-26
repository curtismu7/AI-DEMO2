'use strict';

/**
 * A persisted flag override that contradicts its own default must be visible.
 *
 * serializeFlag marks `pinned` only for ENV pins, so a stored runtime value is
 * returned as plain `value` — indistinguishable from the default. That is how
 * ff_gateway_brokered_exchange sat at false against a `defaultValue: true`
 * registry entry on the live stack, taking 22 of 50 banking use cases with it.
 */

jest.mock('../../routes/featureFlags', () => ({
  FLAG_REGISTRY: [],
  serializeFlag: jest.fn(),
}));

const featureFlags = require('../../routes/featureFlags');
const { flagOverrides, findOverrides, DEMO_CRITICAL } = require('../../services/checks/flagOverrideCheck');

/** Drive the registry + serializer with a fixture set. */
function setFlags(rows) {
  featureFlags.FLAG_REGISTRY.length = 0;
  featureFlags.FLAG_REGISTRY.push(...rows.map((r) => ({ id: r.id })));
  featureFlags.serializeFlag.mockImplementation((f) => rows.find((r) => r.id === f.id));
}

const row = (id, value, defaultValue, extra = {}) => ({
  id, name: id, category: 'MCP / Agent', value, defaultValue, ...extra,
});

describe('config.flag_overrides', () => {
  afterEach(() => jest.clearAllMocks());

  test('passes when every flag sits at its default', async () => {
    setFlags([row('ff_a', true, true), row('ff_b', false, false)]);
    const r = await flagOverrides.run({});
    expect(r.status).toBe('pass');
  });

  test('FAILS on a demo-critical flag persisted against its default', async () => {
    // The exact live shape: default true, stored false, no env pin.
    setFlags([row('ff_gateway_brokered_exchange', false, true)]);
    const r = await flagOverrides.run({});
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('ff_gateway_brokered_exchange=false (default true)');
    expect(r.nextAction).toMatch(/PATCH \/api\/admin\/feature-flags/);
    expect(r.meta.critical).toHaveLength(1);
  });

  test('an ENV pin is not reported — that is a visible, deliberate decision', async () => {
    setFlags([row('ff_gateway_brokered_exchange', false, true, { pinned: true, pinnedBy: 'FF_GATEWAY_BROKERED_EXCHANGE' })]);
    const r = await flagOverrides.run({});
    expect(r.status).toBe('pass');
  });

  test('a non-critical divergence warns rather than fails', async () => {
    setFlags([row('ff_some_toggle', true, false)]);
    const r = await flagOverrides.run({});
    expect(r.status).toBe('warn');
    expect(r.meta.critical).toHaveLength(0);
  });

  test('every demo-critical id is a real flag id shape', () => {
    for (const id of DEMO_CRITICAL) expect(id).toMatch(/^ff_/);
  });

  test('findOverrides never throws on a malformed row', () => {
    setFlags([{ id: 'ff_x', name: 'x', category: 'c', value: true }]); // no defaultValue
    expect(() => findOverrides()).not.toThrow();
    expect(findOverrides().overrides).toHaveLength(0);
  });
});
