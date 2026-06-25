'use strict';

/**
 * Slice 3 integration test: the generic A2A overlay merges into any vertical that
 * has a specialist when ff_a2a_delegation is on, and is absent otherwise. Verifies
 * verticalDispatch + the config/verticals/a2a overlay without a live PingOne tenant.
 */

// Toggle A2A on/off by mocking isA2aEnabled (verticalDispatch imports it).
jest.mock('../../services/a2aDelegationService', () => ({
  isA2aEnabled: jest.fn(() => true),
}));

const a2a = require('../../services/a2aDelegationService');
const verticalDispatch = require('../../services/verticalDispatch');

const toolNames = (vertical) =>
  verticalDispatch.toolSchemasFor(vertical, {}, () => []).map((t) => t.name);

describe('A2A overlay dispatch merge', () => {
  beforeEach(() => a2a.isA2aEnabled.mockReturnValue(true));

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

  test('omits the tool when A2A is disabled', () => {
    a2a.isA2aEnabled.mockReturnValue(false);
    expect(toolNames('banking')).not.toContain('delegate_to_specialist');
  });

  test('omits the tool for a vertical with no specialist (oauth-teaching)', () => {
    expect(toolNames('oauth-teaching')).not.toContain('delegate_to_specialist');
  });
});
