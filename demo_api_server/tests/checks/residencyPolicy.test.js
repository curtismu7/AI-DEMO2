// demo_api_server/tests/checks/residencyPolicy.test.js
'use strict';

const {
  resolveResidencyPolicy,
  DUAL_MIN_TOTAL_GB,
  DEFAULT_DUAL,
} = require('../../../demo_llm_proxy/residencyPolicy');

describe('resolveResidencyPolicy', () => {
  test('24GB refuses dual and pins phi', () => {
    const r = resolveResidencyPolicy({
      totalRamGb: 24,
      residentTiersExplicit: false,
    });
    expect(r.mode).toBe('pin-phi');
    expect(r.residentTiers).toBe('');
    expect(r.pinTier).toBe('8091');
    expect(r.reason).toMatch(/refused|pin/i);
  });

  test('64GB keeps dual default', () => {
    const r = resolveResidencyPolicy({
      totalRamGb: 64,
      residentTiersExplicit: false,
    });
    expect(r.mode).toBe('dual');
    expect(r.residentTiers).toBe(DEFAULT_DUAL);
  });

  test('FORCE_DUAL keeps dual on low RAM', () => {
    const r = resolveResidencyPolicy({
      totalRamGb: 24,
      residentTiersExplicit: false,
      forceDual: true,
    });
    expect(r.mode).toBe('dual');
    expect(r.residentTiers).toBe(DEFAULT_DUAL);
  });

  test('explicit empty residents is classic swap', () => {
    const r = resolveResidencyPolicy({
      totalRamGb: 64,
      residentTiersExplicit: true,
      residentTiersEnv: '',
    });
    expect(r.mode).toBe('classic');
    expect(r.residentTiers).toBe('');
  });

  test(`threshold is ${DUAL_MIN_TOTAL_GB}GB`, () => {
    expect(DUAL_MIN_TOTAL_GB).toBe(32);
    const justUnder = resolveResidencyPolicy({
      totalRamGb: DUAL_MIN_TOTAL_GB - 1,
      residentTiersExplicit: true,
      residentTiersEnv: '8091,8096',
    });
    expect(justUnder.mode).toBe('pin-phi');
  });
});
