import { beforeEach, describe, expect, it } from 'vitest';
import { getFavorites, addFavorite, removeFavorite, isFavorite, labelForPath } from './favorites';

beforeEach(() => localStorage.clear());

describe('favorites', () => {
  it('seeds the demo lanes and Agent Identity Academy on first use', () => {
    const favs = getFavorites();
    expect(favs.map((f) => f.path)).toEqual([
      '/llm-gateway',
      '/privilege-mcp-client',
      '/academy/identity',
      '/academy/journey',
    ]);
    expect(favs[0].label).toBe('AI Guard');
    expect(favs[2].label).toBe('Agent Identity Academy');
    expect(favs[3].label).toBe('Guided Demo Tour');
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

  it('moves the legacy standalone Academy favorite to the in-app route', () => {
    localStorage.setItem(
      'demo_header_favorites',
      JSON.stringify([{ label: 'Agent Identity Academy', path: '/academy-identity-preview.html' }]),
    );
    localStorage.setItem('demo_header_favorites_agent_identity_academy_v1', '1');

    expect(getFavorites()).toEqual([
      { label: 'Agent Identity Academy', path: '/academy/identity' },
    ]);
  });

  it('removing a seeded favorite persists (does not re-seed)', () => {
    getFavorites(); // seed
    removeFavorite('/llm-gateway');
    expect(isFavorite('/llm-gateway')).toBe(false);
    expect(getFavorites().map((f) => f.path)).toEqual([
      '/privilege-mcp-client',
      '/academy/identity',
      '/academy/journey',
    ]);
  });

  it('migrates existing favorites once and respects a later removal', () => {
    localStorage.setItem(
      'demo_header_favorites',
      JSON.stringify([{ label: 'Audit Agent', path: '/audit-agent' }]),
    );

    expect(getFavorites().map((f) => f.path)).toEqual([
      '/audit-agent',
      '/academy/identity',
    ]);

    removeFavorite('/academy/identity');
    expect(getFavorites().map((f) => f.path)).toEqual(['/audit-agent']);
  });

  it.each([
    ['malformed JSON', '{not-json'],
    ['a non-array value', JSON.stringify({ label: 'Old favorite', path: '/old' })],
  ])('repairs %s and still respects a later Academy removal', (_case, storedValue) => {
    localStorage.setItem('demo_header_favorites', storedValue);

    expect(getFavorites().some((f) => f.path === '/academy/identity')).toBe(true);
    removeFavorite('/academy/identity');

    expect(getFavorites().some((f) => f.path === '/academy/identity')).toBe(false);
  });

  it('derives a readable label, handling acronyms', () => {
    expect(labelForPath('/privilege-mcp-client')).toBe('Privilege MCP Client');
    expect(labelForPath('/llm-gateway')).toBe('AI Guard');
    expect(labelForPath('/academy/identity')).toBe('Agent Identity Academy');
    expect(addFavorite({ path: '/intent-inspector' }).at(-1).label).toBe('Intent Inspector');
  });
});
