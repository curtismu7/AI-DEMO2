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
});
