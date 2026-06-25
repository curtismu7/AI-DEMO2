'use strict';

const { roundToCents } = require('../../utils/money');

describe('money.roundToCents', () => {
  it('rounds to two decimals', () => {
    expect(roundToCents(1.005 * 1)).toBeCloseTo(1.0, 5); // representational
    expect(roundToCents(2.5)).toBe(2.5);
    expect(roundToCents(100)).toBe(100);
  });

  it('eliminates binary-float drift (the reason this util exists)', () => {
    expect(roundToCents(0.1 + 0.2)).toBe(0.3); // 0.30000000000000004 → 0.3
    expect(roundToCents(5.55 + 0.1)).toBe(5.65);
    let bal = 0;
    for (let i = 0; i < 10; i++) bal = roundToCents(bal + 0.1);
    expect(bal).toBe(1); // no accumulated drift across repeated adds
  });

  it('rounds half-cents up (matches Math.round)', () => {
    expect(roundToCents(1.234)).toBe(1.23);
    expect(roundToCents(1.235)).toBe(1.24);
    expect(roundToCents(1.236)).toBe(1.24);
  });

  it('coerces string input like the call sites it replaces', () => {
    expect(roundToCents('250.5')).toBe(250.5);
    expect(roundToCents('19.999')).toBe(20);
  });

  it('is a drop-in for Math.round(x * 100) / 100 over a range of values', () => {
    for (const x of [0, 0.01, 0.1, 0.2, 1.005, 12.344, 12.345, 999999.999, 3500, -120.5]) {
      expect(roundToCents(x)).toBe(Math.round(x * 100) / 100);
    }
  });

  it('returns NaN for non-numeric input (callers validate before persisting)', () => {
    expect(Number.isNaN(roundToCents('abc'))).toBe(true);
    expect(Number.isNaN(roundToCents(undefined))).toBe(true);
  });
});
