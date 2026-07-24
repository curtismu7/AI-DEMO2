/**
 * formatters.js — locale-aware number/date formatters used throughout the UI.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatPercent,
  formatValue,
  getFormatterLocale,
  setFormatterLocale,
  getCurrencyFormatter,
} from '../formatters';

describe('formatters', () => {
  // Restore locale after any test that changes it
  const originalLocale = getFormatterLocale();
  afterEach(() => setFormatterLocale(originalLocale));

  // ── formatCurrency ──────────────────────────────────────────────────────

  describe('formatCurrency', () => {
    it('formats a positive USD amount', () => {
      expect(formatCurrency(1234.56)).toMatch(/1,234\.56/);
    });

    it('formats zero', () => {
      expect(formatCurrency(0)).toMatch(/0\.00/);
    });

    it('formats a negative amount', () => {
      expect(formatCurrency(-50)).toMatch(/50/);
    });

    it('returns the value as string when amount is not a number', () => {
      expect(formatCurrency('foo')).toBe('foo');
      expect(formatCurrency(null)).toBe('');
      expect(formatCurrency(undefined)).toBe('');
    });

    it('respects non-USD currency', () => {
      const result = formatCurrency(100, 'EUR');
      expect(result).toMatch(/100/);
      expect(result).toMatch(/€|EUR/);
    });
  });

  // ── formatDate ──────────────────────────────────────────────────────────

  describe('formatDate', () => {
    it('formats an ISO date string', () => {
      const result = formatDate('2024-06-15');
      expect(result).toMatch(/2024/);
      expect(result).toMatch(/Jun|June|6/);
    });

    it('returns empty string for null/undefined/empty', () => {
      expect(formatDate(null)).toBe('');
      expect(formatDate(undefined)).toBe('');
      expect(formatDate('')).toBe('');
    });

    it('returns the raw value as string for an unparseable date', () => {
      const result = formatDate('not-a-date');
      expect(typeof result).toBe('string');
    });
  });

  // ── formatDateTime ──────────────────────────────────────────────────────

  describe('formatDateTime', () => {
    it('formats a unix timestamp (seconds)', () => {
      // 2024-01-01 00:00:00 UTC
      const result = formatDateTime(1704067200);
      expect(result).toMatch(/2024/);
    });

    it('formats an ISO string timestamp', () => {
      const result = formatDateTime('2024-06-15T14:30:00Z');
      expect(result).toMatch(/2024/);
    });

    it('returns empty string for null/undefined/empty', () => {
      expect(formatDateTime(null)).toBe('');
      expect(formatDateTime(undefined)).toBe('');
      expect(formatDateTime('')).toBe('');
    });
  });

  // ── formatPercent ───────────────────────────────────────────────────────

  describe('formatPercent', () => {
    it('formats a rate with default 3 decimals', () => {
      expect(formatPercent(4.5)).toBe('4.500%');
    });

    it('respects custom decimal count', () => {
      expect(formatPercent(4.5, 1)).toBe('4.5%');
      expect(formatPercent(4.5, 0)).toBe('5%');
    });

    it('formats zero', () => {
      expect(formatPercent(0)).toBe('0.000%');
    });

    it('returns string for non-number input', () => {
      expect(formatPercent('bad')).toBe('bad');
      expect(formatPercent(null)).toBe('');
      expect(formatPercent(undefined)).toBe('');
    });
  });

  // ── formatValue ─────────────────────────────────────────────────────────

  describe('formatValue', () => {
    it('returns em-dash for null/undefined', () => {
      expect(formatValue(null, 'money')).toBe('—');
      expect(formatValue(undefined, 'text')).toBe('—');
    });

    it('formats money', () => {
      expect(formatValue(500, 'money')).toMatch(/500/);
    });

    it('formats date', () => {
      expect(formatValue('2024-01-01', 'date')).toMatch(/2024/);
    });

    it('formats percent with 2 decimal places', () => {
      expect(formatValue(3.14159, 'percent')).toBe('3.14%');
    });

    it('formats count as rounded integer', () => {
      expect(formatValue(3.7, 'count')).toBe('4');
      expect(formatValue(3.2, 'count')).toBe('3');
    });

    it('formats text (default) as string', () => {
      expect(formatValue('hello', 'text')).toBe('hello');
      expect(formatValue(42, 'unknown')).toBe('42');
    });
  });

  // ── locale management ───────────────────────────────────────────────────

  describe('locale management', () => {
    it('getFormatterLocale returns en-US by default', () => {
      expect(getFormatterLocale()).toBe('en-US');
    });

    it('setFormatterLocale changes the active locale', () => {
      setFormatterLocale('de-DE');
      expect(getFormatterLocale()).toBe('de-DE');
    });

    it('setFormatterLocale clears the formatter cache', () => {
      // Get a cached formatter, then change locale — must return a different instance
      const before = getCurrencyFormatter('USD');
      setFormatterLocale('fr-FR');
      const after = getCurrencyFormatter('USD');
      // Both are valid Intl.NumberFormat instances but locale has changed
      expect(after).not.toBe(before);
    });

    it('same locale set twice does not clear cache', () => {
      setFormatterLocale('en-US'); // already en-US
      const fmt1 = getCurrencyFormatter('USD');
      setFormatterLocale('en-US');
      const fmt2 = getCurrencyFormatter('USD');
      expect(fmt1).toBe(fmt2); // same cached instance
    });
  });
});
