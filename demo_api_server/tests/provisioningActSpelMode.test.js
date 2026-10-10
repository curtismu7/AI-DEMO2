'use strict';

/**
 * act-claim minting mode — ff_may_act_seed.
 *
 * The plan (docs/superpowers/plans/2026-10-10-may-act-actor-token-rearchitecture.md)
 * moves the DEFAULT act mint from `act ← subjectToken.may_act` (the user's consent
 * attribute, checked once at mint) to `act ← actorToken.client_id` (the RFC 8693
 * actor token), with the legacy may_act-seeded form behind ff_may_act_seed=ON.
 *
 * The SpEL itself is baked at provisioning time, so the mode is a pure selection
 * problem: given the flag, which resource attribute value does each site wire?
 * These tests pin that selection — they do NOT verify PingOne evaluates the
 * expressions (that is the live verification gate in the plan §5).
 */

jest.mock('../services/configStore', () => ({
  __esModule: true,
  getEffective: (key) =>
    key === 'ff_may_act_seed' ? global.__FF_MAY_ACT_SEED__ : '',
}));

const { actAttributeValue } = require('../services/pingoneProvisionService');

describe('actAttributeValue — the act SpEL selected per ff_may_act_seed', () => {
  const ORIGINAL = global.__FF_MAY_ACT_SEED__;

  afterEach(() => {
    if (ORIGINAL === undefined) delete global.__FF_MAY_ACT_SEED__;
    else global.__FF_MAY_ACT_SEED__ = ORIGINAL;
  });

  test('flag OFF (default): act is minted from the actor token client id', () => {
    global.__FF_MAY_ACT_SEED__ = 'false';
    const v = actAttributeValue();
    expect(v).toBe("${{'sub': #root.context.requestData.actorToken.client_id}}");
  });

  test('flag unset: defaults to actor-token minting (same as OFF)', () => {
    delete global.__FF_MAY_ACT_SEED__;
    const v = actAttributeValue();
    expect(v).toBe("${{'sub': #root.context.requestData.actorToken.client_id}}");
  });

  test('flag ON: act is seeded from the subject token may_act (legacy teaching form)', () => {
    global.__FF_MAY_ACT_SEED__ = 'true';
    const v = actAttributeValue();
    expect(v).toBe('${#root.context.requestData.subjectToken.may_act}');
  });
});
