/**
 * parseCitations — Unit Tests
 */

import {
  parseCitations,
  extractCitationIds,
  hasCitations,
  createCitationResolver,
} from '../parseCitations';

// ===========================================================================
// parseCitations()
// ===========================================================================

describe('parseCitations', () => {
  test('parses simple text with no citations', () => {
    const result = parseCitations('Hello world, no citations here.');
    expect(result).toEqual([
      { type: 'text', content: 'Hello world, no citations here.' },
    ]);
  });

  test('parses single citation at end', () => {
    const result = parseCitations('Balance is calculated [K1].');
    expect(result).toEqual([
      { type: 'text', content: 'Balance is calculated ' },
      { type: 'citation', id: 'K1', raw: '[K1]' },
      { type: 'text', content: '.' },
    ]);
  });

  test('parses multiple citations', () => {
    const result = parseCitations('Per [K1] and [K3], the limit is set.');
    expect(result).toHaveLength(5);
    expect(result[0]).toEqual({ type: 'text', content: 'Per ' });
    expect(result[1]).toEqual({ type: 'citation', id: 'K1', raw: '[K1]' });
    expect(result[2]).toEqual({ type: 'text', content: ' and ' });
    expect(result[3]).toEqual({ type: 'citation', id: 'K3', raw: '[K3]' });
    expect(result[4]).toEqual({ type: 'text', content: ', the limit is set.' });
  });

  test('parses adjacent citations without space', () => {
    const result = parseCitations('[K1][K2][K3]');
    expect(result).toEqual([
      { type: 'citation', id: 'K1', raw: '[K1]' },
      { type: 'citation', id: 'K2', raw: '[K2]' },
      { type: 'citation', id: 'K3', raw: '[K3]' },
    ]);
  });

  test('parses citation at start of text', () => {
    const result = parseCitations('[K5] is the relevant policy.');
    expect(result[0]).toEqual({ type: 'citation', id: 'K5', raw: '[K5]' });
    expect(result[1]).toEqual({ type: 'text', content: ' is the relevant policy.' });
  });

  test('parses double-digit citation IDs', () => {
    const result = parseCitations('See [K12] and [K50].');
    const citations = result.filter(s => s.type === 'citation');
    expect(citations).toHaveLength(2);
    expect(citations[0].id).toBe('K12');
    expect(citations[1].id).toBe('K50');
  });

  test('ignores citations above K50', () => {
    const result = parseCitations('See [K51] for more.');
    expect(result).toEqual([
      { type: 'text', content: 'See [K51] for more.' },
    ]);
  });

  test('ignores K0', () => {
    const result = parseCitations('See [K0] for info.');
    expect(result).toEqual([
      { type: 'text', content: 'See [K0] for info.' },
    ]);
  });

  test('ignores malformed citations', () => {
    const result = parseCitations('Not a citation: [KA], [K], [K1a], K1, (K1)');
    expect(result).toEqual([
      { type: 'text', content: 'Not a citation: [KA], [K], [K1a], K1, (K1)' },
    ]);
  });

  test('handles empty string', () => {
    const result = parseCitations('');
    expect(result).toEqual([{ type: 'text', content: '' }]);
  });

  test('handles null/undefined', () => {
    expect(parseCitations(null)).toEqual([{ type: 'text', content: '' }]);
    expect(parseCitations(undefined)).toEqual([{ type: 'text', content: '' }]);
  });

  test('handles text with only citation', () => {
    const result = parseCitations('[K7]');
    expect(result).toEqual([
      { type: 'citation', id: 'K7', raw: '[K7]' },
    ]);
  });

  test('preserves whitespace and newlines', () => {
    const text = 'Line 1 [K1]\n\nLine 3 [K2]';
    const result = parseCitations(text);
    expect(result).toHaveLength(4);
    expect(result[0].content).toBe('Line 1 ');
    expect(result[2].content).toBe('\n\nLine 3 ');
  });
});

// ===========================================================================
// extractCitationIds()
// ===========================================================================

describe('extractCitationIds', () => {
  test('extracts unique sorted IDs', () => {
    const ids = extractCitationIds('Per [K3], see [K1], also [K3] again.');
    expect(ids).toEqual(['K1', 'K3']);
  });

  test('returns empty array for no citations', () => {
    expect(extractCitationIds('No citations')).toEqual([]);
  });

  test('returns empty for null', () => {
    expect(extractCitationIds(null)).toEqual([]);
  });

  test('sorts numerically not alphabetically', () => {
    const ids = extractCitationIds('[K9] [K10] [K2] [K1]');
    expect(ids).toEqual(['K1', 'K2', 'K9', 'K10']);
  });

  test('excludes IDs above K50', () => {
    const ids = extractCitationIds('[K1] [K99] [K50] [K51]');
    expect(ids).toEqual(['K1', 'K50']);
  });
});

// ===========================================================================
// hasCitations()
// ===========================================================================

describe('hasCitations', () => {
  test('returns true when citations present', () => {
    expect(hasCitations('See [K1]')).toBe(true);
  });

  test('returns false when no citations', () => {
    expect(hasCitations('No citations here')).toBe(false);
  });

  test('returns false for invalid citations', () => {
    expect(hasCitations('[K0] [K51] [KA]')).toBe(false);
  });

  test('returns false for empty/null', () => {
    expect(hasCitations('')).toBe(false);
    expect(hasCitations(null)).toBe(false);
  });
});

// ===========================================================================
// createCitationResolver()
// ===========================================================================

describe('createCitationResolver', () => {
  test('creates resolver with expected methods', () => {
    const resolver = createCitationResolver();
    expect(typeof resolver.resolve).toBe('function');
    expect(typeof resolver.resolveAll).toBe('function');
    expect(typeof resolver.clearCache).toBe('function');
  });

  test('resolves to null when fetch fails', async () => {
    // In test environment, fetch is not available — should gracefully fail
    const resolver = createCitationResolver('http://localhost:9999');
    const result = await resolver.resolve('test', 'K1');
    expect(result).toBeNull();
  });
});
