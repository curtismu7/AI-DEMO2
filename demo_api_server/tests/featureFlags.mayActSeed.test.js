'use strict';

/**
 * ff_may_act_seed — legacy mint-mode flag (may_act re-architecture, Task 1).
 *
 * Default OFF: `act` mints from the actor token and may_act is enforced per
 * call (Rule 2.6). ON restores the pre-2026-10 mint-time seeding. The flag is
 * ONLY reachable if it is registered in BOTH registries — an unregistered flag
 * is silently dropped by PATCH /api/admin/feature-flags and absent from
 * configStore FIELD_DEFS, making the legacy teaching mode unreachable (the
 * exact dead-toggle trap this test pins).
 */

jest.mock('../services/configStore', () => ({
  getEffective: jest.fn(),
  setRaw: jest.fn(),
}));

const { FLAG_REGISTRY } = require('../routes/featureFlags');

describe('ff_may_act_seed', () => {
  it('is registered as a boolean flag that is OFF by default', () => {
    const flag = FLAG_REGISTRY.find((f) => f.id === 'ff_may_act_seed');
    expect(flag).toBeDefined();
    expect(flag.type).toBe('boolean');
    // Must ship OFF: default mode mints act from the actor token.
    expect(flag.defaultValue).toBe(false);
  });
});

describe('ff_may_act_seed configStore registration', () => {
  it('has a FIELD_DEFS entry defaulting to the string "false"', () => {
    const { FIELD_DEFS } = jest.requireActual('../services/configStore');
    expect(FIELD_DEFS.ff_may_act_seed).toBeDefined();
    expect(FIELD_DEFS.ff_may_act_seed.default).toBe('false');
  });
});
