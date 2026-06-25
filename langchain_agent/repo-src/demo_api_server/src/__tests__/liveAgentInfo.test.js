'use strict';

// NOTE: setup.js calls jest.resetModules() between tests, so require the modules
// under test INSIDE each test to keep liveAgentInfo and its configStore mock on
// the same (post-reset) module instance.
jest.mock('../../services/configStore', () => ({ getEffective: jest.fn(() => 'helix_google') }));
jest.mock('../../services/verticalManifest', () => ({
  verticalManifest: {
    resolver: {
      activeIdFor: jest.fn(() => 'banking'),
      resolve: jest.fn(() => ({ identity: { displayName: 'Super Banking' } })),
    },
  },
}));

describe('getLiveAgentRow', () => {
  it('builds the live row from mode + vertical', () => {
    const { getLiveAgentRow } = require('../../services/controlPlane/liveAgentInfo');
    const row = getLiveAgentRow({ session: {} });
    expect(row.kind).toBe('live');
    expect(row.id).toBe('demo-agent');
    expect(row.label).toBe('Live Agent (Super Banking)');
    expect(row.provider).toBe('helix');
    expect(row.providerLabel).toBe('Helix only');
    expect(row.status).toBe('active');
  });

  it('falls back to defaults if mode resolution throws', () => {
    const cs = require('../../services/configStore');
    const { getLiveAgentRow } = require('../../services/controlPlane/liveAgentInfo');
    cs.getEffective.mockImplementation(() => { throw new Error('boom'); });
    const row = getLiveAgentRow({ session: {} });
    expect(row.provider).toBeNull();
    expect(row.providerLabel).toBe('Heuristics only');
    // vertical still resolves
    expect(row.label).toBe('Live Agent (Super Banking)');
  });
});
