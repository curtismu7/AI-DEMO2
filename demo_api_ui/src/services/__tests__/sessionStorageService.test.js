/**
 * sessionStorageService — safe sessionStorage with error handling.
 *
 * setItem, getItem, removeItem, clearNamespace, isAvailable
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import sessionStorageService from '../sessionStorageService';

describe('sessionStorageService — setItem', () => {
  beforeEach(() => sessionStorage.clear());

  it('stores a string value and returns true', () => {
    expect(sessionStorageService.setItem('k', 'hello')).toBe(true);
    expect(sessionStorage.getItem('k')).toBe('hello');
  });

  it('serializes an object to JSON', () => {
    sessionStorageService.setItem('obj', { a: 1 });
    expect(JSON.parse(sessionStorage.getItem('obj'))).toEqual({ a: 1 });
  });

  it('returns false for invalid (empty) key', () => {
    expect(sessionStorageService.setItem('', 'v')).toBe(false);
    expect(sessionStorageService.setItem(null, 'v')).toBe(false);
  });

  it('returns false when value exceeds 5MB', () => {
    // Build a string that JSON-serializes to > 5MB
    const big = 'x'.repeat(5 * 1024 * 1024 + 1);
    expect(sessionStorageService.setItem('big', big)).toBe(false);
  });
});

describe('sessionStorageService — getItem', () => {
  beforeEach(() => sessionStorage.clear());

  it('returns the stored string value', () => {
    sessionStorage.setItem('k', 'hello');
    expect(sessionStorageService.getItem('k')).toBe('hello');
  });

  it('parses stored JSON automatically', () => {
    sessionStorage.setItem('k', JSON.stringify({ x: 42 }));
    expect(sessionStorageService.getItem('k')).toEqual({ x: 42 });
  });

  it('returns raw string when JSON parse fails', () => {
    sessionStorage.setItem('k', 'not-json');
    expect(sessionStorageService.getItem('k')).toBe('not-json');
  });

  it('returns fallback when key is absent', () => {
    expect(sessionStorageService.getItem('missing', 'default')).toBe('default');
  });

  it('returns null fallback by default when key is absent', () => {
    expect(sessionStorageService.getItem('missing')).toBeNull();
  });

  it('returns fallback for invalid key', () => {
    expect(sessionStorageService.getItem('', 'fb')).toBe('fb');
  });
});

describe('sessionStorageService — removeItem', () => {
  beforeEach(() => sessionStorage.clear());

  it('removes the key and returns true', () => {
    sessionStorage.setItem('k', 'v');
    expect(sessionStorageService.removeItem('k')).toBe(true);
    expect(sessionStorage.getItem('k')).toBeNull();
  });

  it('returns true even when key does not exist', () => {
    expect(sessionStorageService.removeItem('nonexistent')).toBe(true);
  });

  it('returns false for invalid key', () => {
    expect(sessionStorageService.removeItem('')).toBe(false);
    expect(sessionStorageService.removeItem(null)).toBe(false);
  });
});

describe('sessionStorageService — clearNamespace', () => {
  beforeEach(() => sessionStorage.clear());

  it('removes all keys with the given prefix', () => {
    sessionStorage.setItem('bx_foo', '1');
    sessionStorage.setItem('bx_bar', '2');
    sessionStorage.setItem('other_key', '3');
    const count = sessionStorageService.clearNamespace('bx_');
    expect(count).toBe(2);
    expect(sessionStorage.getItem('bx_foo')).toBeNull();
    expect(sessionStorage.getItem('bx_bar')).toBeNull();
    expect(sessionStorage.getItem('other_key')).toBe('3');
  });

  it('returns 0 when no keys match the prefix', () => {
    sessionStorage.setItem('other', 'v');
    expect(sessionStorageService.clearNamespace('bx_')).toBe(0);
  });

  it('returns 0 for invalid prefix', () => {
    expect(sessionStorageService.clearNamespace('')).toBe(0);
    expect(sessionStorageService.clearNamespace(null)).toBe(0);
  });
});

describe('sessionStorageService — isAvailable', () => {
  it('returns true in a normal jsdom environment', () => {
    expect(sessionStorageService.isAvailable()).toBe(true);
  });

  it('returns false when sessionStorage throws on setItem', () => {
    const spy = vi.spyOn(sessionStorage.__proto__, 'setItem').mockImplementationOnce(() => {
      throw new DOMException('QuotaExceededError');
    });
    expect(sessionStorageService.isAvailable()).toBe(false);
    spy.mockRestore();
  });
});
