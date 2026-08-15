'use strict';

const {
  searchPublicBranches,
  formatBranchCatalogReply,
  BRANCHES,
} = require('../data/publicBranchCatalog');

describe('publicBranchCatalog', () => {
  it('returns all branches when no city filter is given', () => {
    const result = searchPublicBranches({});
    expect(result.branches).toHaveLength(BRANCHES.length);
    expect(result.query).toBeNull();
  });

  it('filters branches by city substring', () => {
    const result = searchPublicBranches({ city: 'Austin' });
    expect(result.branches.length).toBeGreaterThan(0);
    expect(result.branches.every((b) => b.city === 'Austin')).toBe(true);
  });

  it('formats a readable reply for the agent', () => {
    const reply = formatBranchCatalogReply(searchPublicBranches({ city: 'Dallas' }));
    expect(reply).toContain('Dallas');
    expect(reply).toContain('Hours:');
  });

  // Important fix: branch_hours' reply text duplicated the same location detail
  // AIAgent.js's locationCards rendering already shows as cards. { short: true }
  // is the heading-only mode that lets the cards carry the detail instead.
  it('short mode returns a heading only — no per-branch address/hours detail', () => {
    const result = searchPublicBranches({ city: 'Dallas' });
    const reply = formatBranchCatalogReply(result, { short: true });
    expect(reply).toContain('Dallas');
    expect(reply).not.toContain('Hours:');
    expect(reply).not.toContain(result.branches[0].address);
  });

  it('short mode still names a no-match result correctly', () => {
    const result = searchPublicBranches({ city: 'Nowhereville' });
    const reply = formatBranchCatalogReply(result, { short: true });
    expect(reply).toMatch(/No .* matched "Nowhereville"/);
  });
});

describe('vertical-aware catalog', () => {
  test('banking is unchanged and is the fallback', () => {
    const without = searchPublicBranches({});
    const explicit = searchPublicBranches({ vertical: 'banking' });
    expect(without.branches).toEqual(explicit.branches);
    expect(explicit.branches[0].name).toMatch(/Super Banking/);
  });

  test('an unknown vertical falls back to banking rather than returning nothing', () => {
    const result = searchPublicBranches({ vertical: 'not-a-vertical' });
    expect(result.branches.length).toBeGreaterThan(0);
    expect(result.branches[0].name).toMatch(/Super Banking/);
  });

  test.each([
    ['healthcare', /clinic|health|medical/i],
    ['retail', /store/i],
    ['government', /office|city|county/i],
    ['university', /campus|hall|library/i],
    ['workforce', /office/i],
    ['sporting-goods', /store|outfitter/i],
    ['manufacturing', /plant|facility/i],
    ['investment', /branch|office/i],
    ['airlines', /airport|terminal/i],
  ])('%s returns its own locations', (vertical, namePattern) => {
    const result = searchPublicBranches({ vertical });
    expect(result.branches.length).toBeGreaterThan(0);
    expect(result.branches[0].name).toMatch(namePattern);
    expect(result.branches[0].name).not.toMatch(/Super Banking/);
  });

  test('the city filter still works inside a vertical', () => {
    const result = searchPublicBranches({ vertical: 'airlines', city: 'Denver' });
    expect(result.branches.length).toBeGreaterThan(0);
    expect(result.branches.every((b) => b.city === 'Denver')).toBe(true);
  });

  test('the reply heading matches the vertical, not the bank', () => {
    const reply = formatBranchCatalogReply(searchPublicBranches({ vertical: 'airlines' }));
    expect(reply).not.toMatch(/Super Banking/);
    expect(reply).toMatch(/airport/i);
  });

  test('a no-match reply names the vertical, not Super Banking branches', () => {
    const reply = formatBranchCatalogReply(
      searchPublicBranches({ vertical: 'healthcare', city: 'Nowhereville' }),
    );
    expect(reply).not.toMatch(/Super Banking/);
  });
});
