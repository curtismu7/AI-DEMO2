'use strict';

describe('Transaction amount validation', () => {
  // Unit test the validation logic directly
  function validateAmount(amount) {
    const parsed = parseFloat(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) return { ok: false, reason: 'must be positive' };
    if (parsed > 1_000_000) return { ok: false, reason: 'exceeds limit' };
    return { ok: true, value: Math.round(parsed * 100) / 100 };
  }

  it('accepts a valid positive amount', () => {
    expect(validateAmount(100).ok).toBe(true);
    expect(validateAmount(100).value).toBe(100);
  });

  it('rejects zero', () => expect(validateAmount(0).ok).toBe(false));
  it('rejects negative amounts', () => expect(validateAmount(-50).ok).toBe(false));
  it('rejects non-numeric strings', () => expect(validateAmount('abc').ok).toBe(false));
  it('rejects amounts over 1,000,000', () => expect(validateAmount(1_000_001).ok).toBe(false));
  it('accepts the maximum allowed amount', () => expect(validateAmount(1_000_000).ok).toBe(true));
  it('rounds to 2 decimal places', () => expect(validateAmount(9.999).value).toBe(10));
  it('rejects undefined', () => expect(validateAmount(undefined).ok).toBe(false));
});
