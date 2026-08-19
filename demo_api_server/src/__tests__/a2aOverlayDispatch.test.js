'use strict';

/**
 * Slice 3 integration test: the generic A2A overlay merges into any vertical that
 * has a specialist (always on — ff_a2a_delegation was removed), and is absent for
 * verticals without one. Verifies verticalDispatch + the config/verticals/a2a
 * overlay without a live PingOne tenant.
 */

const verticalDispatch = require('../../services/verticalDispatch');

const toolNames = (vertical) =>
  verticalDispatch.toolSchemasFor(vertical, {}, () => []).map((t) => t.name);

describe('A2A overlay dispatch merge', () => {
  test('merges delegate_to_specialist into a specialist vertical when enabled', () => {
    expect(toolNames('banking')).toContain('delegate_to_specialist');

    const heuristics = verticalDispatch.heuristicsFor('banking', () => []);
    expect(heuristics.some((h) => h.action === 'delegate_to_specialist')).toBe(true);

    const authz = verticalDispatch.authzFor('banking', {}, () => ({}));
    expect(authz).toHaveProperty('delegate_to_specialist');

    const prompt = verticalDispatch.systemPromptFor('banking', {}, () => 'base');
    expect(prompt).toMatch(/delegate_to_specialist/);
  });

  test('merges for every vertical that has a specialist', () => {
    for (const v of ['banking', 'healthcare', 'retail', 'sporting-goods', 'workforce']) {
      expect(toolNames(v)).toContain('delegate_to_specialist');
    }
  });

  test('omits the tool for a vertical with no specialist (oauth-teaching)', () => {
    expect(toolNames('oauth-teaching')).not.toContain('delegate_to_specialist');
  });
});
