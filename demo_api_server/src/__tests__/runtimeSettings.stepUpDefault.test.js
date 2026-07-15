'use strict';

/**
 * Regression: unset STEP_UP_AMOUNT_THRESHOLD must default to $500 (mfa_threshold),
 * not 0 — otherwise every transfer amounts ≥ 0 trigger MFA.
 */
describe('runtimeSettings stepUpAmountThreshold default', () => {
  const ORIGINAL = process.env.STEP_UP_AMOUNT_THRESHOLD;

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.STEP_UP_AMOUNT_THRESHOLD;
    else process.env.STEP_UP_AMOUNT_THRESHOLD = ORIGINAL;
    jest.resetModules();
  });

  test('defaults to 500 when env is unset', () => {
    delete process.env.STEP_UP_AMOUNT_THRESHOLD;
    jest.resetModules();
    const runtimeSettings = require('../../config/runtimeSettings');
    expect(runtimeSettings.get('stepUpAmountThreshold')).toBe(500);
  });

  test('honors an explicit env override including 0', () => {
    process.env.STEP_UP_AMOUNT_THRESHOLD = '0';
    jest.resetModules();
    const runtimeSettings = require('../../config/runtimeSettings');
    expect(runtimeSettings.get('stepUpAmountThreshold')).toBe(0);
  });
});
