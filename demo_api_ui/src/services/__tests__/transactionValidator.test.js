/**
 * transactionValidator — pure transaction validation helpers.
 */
import { describe, it, expect } from 'vitest';
import {
  parseTransactionAmount,
  validateTransactionForm,
  exceedsThreshold,
} from '../transactionValidator';

// ── parseTransactionAmount ───────────────────────────────────────────────────

describe('parseTransactionAmount', () => {
  it('parses a valid positive number string', () => {
    expect(parseTransactionAmount('123.45')).toBe(123.45);
  });

  it('parses a number value directly', () => {
    expect(parseTransactionAmount(50)).toBe(50);
  });

  it('rounds to 2 decimal places', () => {
    expect(parseTransactionAmount('9.999')).toBe(10);    // 999.9 → 1000 → 10.00
    expect(parseTransactionAmount('1.234')).toBe(1.23);  // 123.4 → 123  →  1.23
  });

  it('returns null for empty string', () => {
    expect(parseTransactionAmount('')).toBeNull();
  });

  it('returns null for null', () => {
    expect(parseTransactionAmount(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(parseTransactionAmount(undefined)).toBeNull();
  });

  it('returns null for non-numeric string', () => {
    expect(parseTransactionAmount('abc')).toBeNull();
  });

  it('returns null when below minAmount', () => {
    expect(parseTransactionAmount(0.001)).toBeNull();
    expect(parseTransactionAmount(0)).toBeNull();
  });

  it('returns null when above maxAmount', () => {
    expect(parseTransactionAmount(1_000_001)).toBeNull();
  });

  it('returns the value at exactly minAmount boundary', () => {
    expect(parseTransactionAmount(0.01)).toBe(0.01);
  });

  it('returns the value at exactly maxAmount boundary', () => {
    expect(parseTransactionAmount(1_000_000)).toBe(1_000_000);
  });

  it('respects custom maxAmount', () => {
    expect(parseTransactionAmount(600, 500)).toBeNull();
    expect(parseTransactionAmount(499, 500)).toBe(499);
  });

  it('trims whitespace from string input', () => {
    expect(parseTransactionAmount('  42.00  ')).toBe(42);
  });
});

// ── validateTransactionForm ──────────────────────────────────────────────────

describe('validateTransactionForm', () => {
  it('returns isValid=true for a valid deposit', () => {
    const { isValid, errors } = validateTransactionForm(
      { amount: '100', accountId: 'CHK-1' },
      'deposit',
    );
    expect(isValid).toBe(true);
    expect(errors).toHaveLength(0);
  });

  it('returns isValid=true for a valid withdrawal', () => {
    const { isValid } = validateTransactionForm(
      { amount: '50', fromId: 'CHK-1' },
      'withdraw',
    );
    expect(isValid).toBe(true);
  });

  it('returns isValid=true for a valid transfer', () => {
    const { isValid } = validateTransactionForm(
      { amount: '200', fromId: 'CHK-1', toId: 'SAV-2' },
      'transfer',
    );
    expect(isValid).toBe(true);
  });

  it('errors when amount is missing', () => {
    const { isValid, errors } = validateTransactionForm({ accountId: 'x' }, 'deposit');
    expect(isValid).toBe(false);
    expect(errors.some((e) => /amount/i.test(e))).toBe(true);
  });

  it('errors on deposit with no accountId or toId', () => {
    const { isValid, errors } = validateTransactionForm({ amount: '10' }, 'deposit');
    expect(isValid).toBe(false);
    expect(errors.some((e) => /account/i.test(e))).toBe(true);
  });

  it('errors on withdrawal with no accountId or fromId', () => {
    const { isValid, errors } = validateTransactionForm({ amount: '10' }, 'withdraw');
    expect(isValid).toBe(false);
  });

  it('errors on transfer with missing fromId', () => {
    const { isValid, errors } = validateTransactionForm(
      { amount: '10', toId: 'SAV-2' },
      'transfer',
    );
    expect(isValid).toBe(false);
    expect(errors.some((e) => /source/i.test(e))).toBe(true);
  });

  it('errors on transfer with missing toId', () => {
    const { isValid, errors } = validateTransactionForm(
      { amount: '10', fromId: 'CHK-1' },
      'transfer',
    );
    expect(isValid).toBe(false);
    expect(errors.some((e) => /destination/i.test(e))).toBe(true);
  });

  it('errors when fromId === toId (same account transfer)', () => {
    const { isValid, errors } = validateTransactionForm(
      { amount: '10', fromId: 'CHK-1', toId: 'CHK-1' },
      'transfer',
    );
    expect(isValid).toBe(false);
    expect(errors.some((e) => /same account/i.test(e))).toBe(true);
  });

  it('errors when note exceeds 500 characters', () => {
    const { isValid, errors } = validateTransactionForm(
      { amount: '10', fromId: 'a', toId: 'b', note: 'x'.repeat(501) },
      'transfer',
    );
    expect(isValid).toBe(false);
    expect(errors.some((e) => /500/i.test(e))).toBe(true);
  });

  it('accepts a note of exactly 500 characters', () => {
    const { isValid } = validateTransactionForm(
      { amount: '10', fromId: 'a', toId: 'b', note: 'x'.repeat(500) },
      'transfer',
    );
    expect(isValid).toBe(true);
  });

  it('returns isValid=false for null form', () => {
    const { isValid } = validateTransactionForm(null, 'deposit');
    expect(isValid).toBe(false);
  });
});

// ── exceedsThreshold ─────────────────────────────────────────────────────────

describe('exceedsThreshold', () => {
  it('returns true when amount strictly exceeds threshold', () => {
    expect(exceedsThreshold(501, 500)).toBe(true);
  });

  it('returns false when amount equals threshold (not strictly greater)', () => {
    expect(exceedsThreshold(500, 500)).toBe(false);
  });

  it('returns false when amount is below threshold', () => {
    expect(exceedsThreshold(100, 500)).toBe(false);
  });

  it('returns false when amount is NaN', () => {
    expect(exceedsThreshold(NaN, 500)).toBe(false);
  });

  it('returns false when threshold is NaN', () => {
    expect(exceedsThreshold(600, NaN)).toBe(false);
  });

  it('returns false for non-number inputs', () => {
    expect(exceedsThreshold('600', 500)).toBe(false);
  });
});
