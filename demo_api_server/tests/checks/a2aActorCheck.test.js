'use strict';

const { auditRegisteredActors } = require('../../services/checks/a2aActorCheck');

/**
 * The incident this guards: HasValidActorChain held 7 registered actors while
 * the tenant had 9 A2A specialists. The four missing (tax, finaid, supplier,
 * holdings) denied a CORRECT two-hop chain as mcp-invalid-actor — which on the
 * ProofStrip reads as the delegation control working, because a DENY is what
 * UC2 is supposed to produce. Four verticals silently broken behind a green
 * screen.
 */
describe('a2a.registered_actors', () => {
  const saved = {};
  const KEYS = ['PINGONE_A2A_TESTONE_AGENT_CLIENT_ID', 'PINGONE_A2A_TESTTWO_AGENT_CLIENT_ID'];

  beforeEach(() => {
    for (const k of Object.keys(process.env)) {
      if (/^PINGONE_A2A_[A-Z0-9]+_AGENT_CLIENT_ID$/.test(k)) { saved[k] = process.env[k]; delete process.env[k]; }
    }
  });
  afterEach(() => {
    for (const k of KEYS) delete process.env[k];
    Object.entries(saved).forEach(([k, v]) => { process.env[k] = v; });
  });

  test('reads the registered actor list out of the committed snapshot', () => {
    const { registered, error } = auditRegisteredActors();
    expect(error).toBeUndefined();
    // The list is a union that only grows, so a lower bound is the honest
    // assertion — pinning the exact count would break every time a specialist
    // is added, which is the behaviour we WANT to be easy.
    expect(registered.length).toBeGreaterThanOrEqual(7);
  });

  test('a specialist that is NOT a registered actor is reported missing', () => {
    process.env.PINGONE_A2A_TESTONE_AGENT_CLIENT_ID = '00000000-0000-4000-8000-00000000dead';
    const { missing } = auditRegisteredActors();
    expect(missing.map((m) => m.id)).toContain('00000000-0000-4000-8000-00000000dead');
    expect(missing.map((m) => m.key)).toContain('TESTONE');
  });

  test('a specialist that IS registered is not reported missing', () => {
    const { registered } = auditRegisteredActors();
    process.env.PINGONE_A2A_TESTTWO_AGENT_CLIENT_ID = registered[0];
    const { missing } = auditRegisteredActors();
    expect(missing.map((m) => m.id)).not.toContain(registered[0]);
  });

  test('no configured specialists yields no false failure', () => {
    // demo_api_server/.env is gitignored, so CI and fresh clones have no ids.
    // The check must not fail a checkout it cannot judge — it warns instead.
    const { configured, missing } = auditRegisteredActors();
    expect(configured).toEqual([]);
    expect(missing).toEqual([]);
  });
});
