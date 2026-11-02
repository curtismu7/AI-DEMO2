import { navItemMatches, navSearchTerms, navSearchText } from '../navSearch';

const gw = { label: 'Gateway v1.261024, v1.261027, v1.261028, v1.261029, v1.261030 and v1.261102: Claims', path: '/gateway-claims', searchAlias: 'mcpgw nested claim act.sub Cedar' };

describe('navSearch', () => {
  it('splits a query into lower-case words and ignores punctuation', () => {
    expect(navSearchTerms('  ID-JAG  Diagram ')).toEqual(['id', 'jag', 'diagram']);
    expect(navSearchTerms('v1.261028')).toEqual(['v1.261028']);
    expect(navSearchTerms('')).toEqual([]);
    expect(navSearchTerms('---')).toEqual([]);
  });

  it('matches every word in any order, as substrings', () => {
    expect(navItemMatches(gw, 'gateway v1.261027')).toBe(true);
    expect(navItemMatches(gw, 'claims gateway')).toBe(true);
    expect(navItemMatches(gw, 'nested cedar')).toBe(true);
    expect(navItemMatches(gw, 'gate')).toBe(true);
  });

  it('requires every word: one missing word is no match', () => {
    expect(navItemMatches(gw, 'gateway okta')).toBe(false);
    expect(navItemMatches(gw, 'v1.261099')).toBe(false);
  });

  it('searches the URL words, so a slug finds the page', () => {
    expect(navSearchText({ label: 'X', path: '/pingfederate-id-jag/diagram' })).toContain('pingfederate id jag diagram');
    expect(navItemMatches({ label: 'Identity flow', path: '/token-chain' }, 'token chain')).toBe(true);
    expect(navItemMatches({ label: 'Identity flow', path: '/token-chain' }, 'token-chain')).toBe(true);
  });

  it('treats an empty or punctuation-only query as everything, and survives a missing label', () => {
    expect(navItemMatches(gw, '')).toBe(true);
    expect(navItemMatches(gw, ' - ')).toBe(true);
    expect(navItemMatches({}, 'x')).toBe(false);
    expect(navItemMatches(undefined, '')).toBe(true);
  });

  it('keeps version numbers whole: a dotted version does not match a different one', () => {
    expect(navItemMatches({ label: 'v1.261024' }, 'v1.261024')).toBe(true);
    expect(navItemMatches({ label: 'v1.261024' }, 'v1.261027')).toBe(false);
  });
});
