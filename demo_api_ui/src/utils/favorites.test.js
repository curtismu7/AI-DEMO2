import { beforeEach, describe, expect, it } from 'vitest';
import { getFavorites, addFavorite, removeFavorite, isFavorite, labelForPath } from './favorites';

beforeEach(() => localStorage.clear());

describe('favorites', () => {
  it('seeds the demo lanes and Agent Identity Academy on first use', () => {
    const favs = getFavorites();
    expect(favs.map((f) => f.path)).toEqual([
      '/llm-gateway',
      '/privilege-mcp-client',
      '/academy-identity-preview.html',
    ]);
    expect(favs[0].label).toBe('AI Guard');
    expect(favs[2].label).toBe('Agent Identity Academy');
  });

  it('adds a page and does not duplicate it', () => {
    addFavorite({ label: 'Audit Agent', path: '/audit-agent' });
    addFavorite({ label: 'Audit Agent', path: '/audit-agent' });
    expect(getFavorites().filter((f) => f.path === '/audit-agent')).toHaveLength(1);
    expect(isFavorite('/audit-agent')).toBe(true);
  });

  it('updates the renamed gateway favorite in existing browser storage', () => {
    localStorage.setItem('demo_header_favorites', JSON.stringify([{ label: 'LLM Gateway', path: '/llm-gateway' }]));
    expect(getFavorites()[0].label).toBe('AI Guard');
  });

  it('removing a seeded favorite persists (does not re-seed)', () => {
    getFavorites(); // seed
    removeFavorite('/llm-gateway');
    expect(isFavorite('/llm-gateway')).toBe(false);
    expect(getFavorites().map((f) => f.path)).toEqual([
      '/privilege-mcp-client',
      '/academy-identity-preview.html',
    ]);
  });

  it('migrates existing favorites once and respects a later removal', () => {
    localStorage.setItem(
      'demo_header_favorites',
      JSON.stringify([{ label: 'Audit Agent', path: '/audit-agent' }]),
    );

    expect(getFavorites().map((f) => f.path)).toEqual([
      '/audit-agent',
      '/academy-identity-preview.html',
    ]);

    removeFavorite('/academy-identity-preview.html');
    expect(getFavorites().map((f) => f.path)).toEqual(['/audit-agent']);
  });

  it.each([
    ['malformed JSON', '{not-json'],
    ['a non-array value', JSON.stringify({ label: 'Old favorite', path: '/old' })],
  ])('repairs %s and still respects a later Academy removal', (_case, storedValue) => {
    localStorage.setItem('demo_header_favorites', storedValue);

    expect(getFavorites().some((f) => f.path === '/academy-identity-preview.html')).toBe(true);
    removeFavorite('/academy-identity-preview.html');

    expect(getFavorites().some((f) => f.path === '/academy-identity-preview.html')).toBe(false);
  });

  it('derives a readable label, handling acronyms', () => {
    expect(labelForPath('/privilege-mcp-client')).toBe('Privilege MCP Client');
    expect(labelForPath('/llm-gateway')).toBe('AI Guard');
    expect(labelForPath('/academy-identity-preview.html')).toBe('Agent Identity Academy');
    expect(addFavorite({ path: '/intent-inspector' }).at(-1).label).toBe('Intent Inspector');
  });
});
