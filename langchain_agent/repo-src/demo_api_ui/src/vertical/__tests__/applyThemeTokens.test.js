import { applyThemeTokens } from '../applyThemeTokens';

describe('applyThemeTokens', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('style');
  });

  test('writes each cssVar to documentElement.style', () => {
    applyThemeTokens({ '--theme-accent': '#000', '--brand-hero-start': '#abc' });
    expect(document.documentElement.style.getPropertyValue('--theme-accent')).toBe('#000');
    expect(document.documentElement.style.getPropertyValue('--brand-hero-start')).toBe('#abc');
  });

  test('returns the applied keys', () => {
    const keys = applyThemeTokens({ '--a': '1', '--b': '2' });
    expect(keys).toBeInstanceOf(Set);
    expect([...keys].sort()).toEqual(['--a', '--b']);
  });

  test('clears previously-set keys not present in new vars (via returned prior keys)', () => {
    const prior = applyThemeTokens({ '--a': '1', '--b': '2' });
    applyThemeTokens({ '--a': '1' }, prior);
    expect(document.documentElement.style.getPropertyValue('--a')).toBe('1');
    expect(document.documentElement.style.getPropertyValue('--b')).toBe('');
  });

  test('ignores empty input gracefully', () => {
    expect(() => applyThemeTokens({})).not.toThrow();
  });

  test('ignores null/undefined input gracefully', () => {
    expect(() => applyThemeTokens(null)).not.toThrow();
    expect(() => applyThemeTokens(undefined)).not.toThrow();
  });

  test('does not clear keys it did not set (only the supplied prior keys)', () => {
    document.documentElement.style.setProperty('--external', 'external-value');
    const prior = applyThemeTokens({ '--mine': 'x' });
    applyThemeTokens({}, prior);
    // --external was never tracked — should NOT be cleared.
    expect(document.documentElement.style.getPropertyValue('--external')).toBe('external-value');
    // --mine WAS tracked and is absent from the new vars — should be cleared.
    expect(document.documentElement.style.getPropertyValue('--mine')).toBe('');
  });
});
