import { beforeEach, describe, expect, it } from 'vitest';
import { getFavorites, addFavorite, removeFavorite, isFavorite, labelForPath } from './favorites';

beforeEach(() => localStorage.clear());

describe('favorites', () => {
  it('seeds the two demo lanes on first use', () => {
    const favs = getFavorites();
    expect(favs.map((f) => f.path)).toEqual(['/llm-gateway', '/privilege-mcp-client']);
  });

  it('adds a page and does not duplicate it', () => {
    addFavorite({ label: 'Audit Agent', path: '/audit-agent' });
    addFavorite({ label: 'Audit Agent', path: '/audit-agent' });
    expect(getFavorites().filter((f) => f.path === '/audit-agent')).toHaveLength(1);
    expect(isFavorite('/audit-agent')).toBe(true);
  });

  it('removing a seeded favorite persists (does not re-seed)', () => {
    getFavorites(); // seed
    removeFavorite('/llm-gateway');
    expect(isFavorite('/llm-gateway')).toBe(false);
    expect(getFavorites().map((f) => f.path)).toEqual(['/privilege-mcp-client']);
  });

  it('derives a readable label, handling acronyms', () => {
    expect(labelForPath('/privilege-mcp-client')).toBe('Privilege MCP Client');
    expect(labelForPath('/llm-gateway')).toBe('LLM Gateway');
    expect(addFavorite({ path: '/intent-inspector' }).at(-1).label).toBe('Intent Inspector');
  });
});
