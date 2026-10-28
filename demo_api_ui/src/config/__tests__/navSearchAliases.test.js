import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NAV_SEARCH_ALIASES } from '../navSearchAliases';
import { navItemMatches } from '../../utils/navSearch';

const navSource = readFileSync(path.resolve(__dirname, '../../components/AdminSideNav.jsx'), 'utf8');
const navPaths = new Set([...navSource.matchAll(/path:\s*"([^"]+)"/g)].map((m) => m[1]));

describe('navSearchAliases', () => {
  it('lists terms only for paths that exist in the side nav (no stale keys)', () => {
    const stale = Object.keys(NAV_SEARCH_ALIASES).filter((p) => !navPaths.has(p));
    expect(stale).toEqual([]);
  });

  it('keeps each entry short, lower-case and free of repeated words', () => {
    for (const [p, terms] of Object.entries(NAV_SEARCH_ALIASES)) {
      expect(terms.length, p).toBeLessThanOrEqual(180);
      expect(terms, p).toBe(terms.toLowerCase());
      const words = terms.split(' ');
      expect(new Set(words).size, p).toBe(words.length);
    }
  });

  it('covers nearly every nav path (new entries should add terms)', () => {
    const missing = [...navPaths].filter((p) => !NAV_SEARCH_ALIASES[p]);
    // Every entry had terms when this was written; allow a few new ones before the list is refreshed.
    expect(missing.length).toBeLessThanOrEqual(5);
  });

  it.each([
    ['/token-compliance', 'rfc 8693'],
    ['/pingfederate-id-jag/playground', 'negative tests'],
    ['/ai-products/authorize', 'abac'],
    ['/p1-third-party-exchange', 'okta'],
    ['/mcp-scanner', 'poisoned tool'],
    ['/gateway-claims', 'requiredclaims'],
    ['/owasp', 'agentic threats'],
    ['/samples/mfa-demo', 'otp'],
  ])('%s is found by "%s"', (p, query) => {
    expect(navItemMatches({ label: 'x', path: p }, query)).toBe(true);
  });

  it('does not match an unrelated term', () => {
    expect(navItemMatches({ label: 'MCP Scanner', path: '/mcp-scanner' }, 'okta')).toBe(false);
  });
});
