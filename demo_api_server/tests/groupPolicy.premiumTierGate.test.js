'use strict';
const { verticalManifest } = require('../services/verticalManifest');

const ELIGIBLE = [
  'banking', 'sporting-goods', 'healthcare', 'retail', 'abercrombie-fitch',
  'investment', 'manufacturing', 'government', 'university', 'workforce',
  'admin', 'airlines',
];

describe('premiumTier is the gate in every eligible vertical', () => {
  beforeAll(() => { verticalManifest.init(); });

  test.each(ELIGIBLE)('%s declares premiumTier and gates its sensitive tool on it', (v) => {
    const groups = verticalManifest.resolver.resolve(v)?.groups;
    expect(groups).toBeTruthy();
    expect(groups.categories.premiumTier).toBeTruthy();
    expect(typeof groups.categories.premiumTier.name).toBe('string');
    expect(groups.categories.premiumTier.name).toMatch(/_PremiumTier$/);

    const restricted = Object.entries(groups.restrictedTools || {});
    expect(restricted.length).toBeGreaterThan(0);
    for (const [tool, category] of restricted) {
      expect(`${tool}:${category}`).toBe(`${tool}:premiumTier`);
    }
  });

  // Per-vertical, not shared: a shared group would make a UC9 run in one vertical
  // deny the sensitive tool in all twelve until restore ran.
  test('every eligible vertical has its OWN premiumTier group', () => {
    const names = ELIGIBLE.map(
      (v) => verticalManifest.resolver.resolve(v).groups.categories.premiumTier.name,
    );
    expect(new Set(names).size).toBe(ELIGIBLE.length);
  });

  // Load-bearing: sensitive_membership_details is also UC2/UC37's primaryTool.
  // Re-pointing the gate without seeding membership makes those A2A cards deny.
  test.each(ELIGIBLE)('%s seeds demoUser into premiumTier', (v) => {
    const groups = verticalManifest.resolver.resolve(v)?.groups;
    expect(groups.userMemberships.demoUser).toContain('premiumTier');
  });
});
