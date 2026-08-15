/**
 * 2026-08-10 final-review fix: killAgent sets `agent:<agentId>:revoked` with
 * a 24h TTL and, until now, nothing ever cleared it early. This test proves
 * the new unrevokeAgent() inverse actually clears the flag that
 * isAgentRevoked() (and therefore the kill check in runMcpToolPipeline)
 * reads, using the same mocked session-store pattern as
 * killSwitchKeyAlignment.integration.test.js — a Map-backed store standing
 * in for the real LmdbSessionStore, extended with destroy() since that's
 * the method unrevokeAgent relies on.
 */
jest.mock('../middleware/sessionConfig', () => {
  const store = new Map();
  return {
    store: {
      get(key, cb) { cb(null, store.get(key) || null); },
      set(key, value, cb) { store.set(key, value); cb(null); },
      destroy(key, cb) { store.delete(key); cb(null); },
    },
  };
});

const killSwitchService = require('../services/killSwitchService');

describe('unrevokeAgent', () => {
  test('clears a revoked flag so isAgentRevoked flips back to false', async () => {
    const agentId = 'agent-unrevoke-test';
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;

    // Mirror the exact write killAgent performs (killSwitchService.js ~508-521).
    const sessionStore = require('../middleware/sessionConfig').store;
    await new Promise((resolve, reject) => {
      sessionStore.set(
        `agent:${agentId}:revoked`,
        { revoked: true, cookie: { maxAge: ONE_DAY_MS } },
        (err) => (err ? reject(err) : resolve()),
      );
    });

    expect(await killSwitchService.isAgentRevoked(agentId)).toBe(true);

    const cleared = await killSwitchService.unrevokeAgent(agentId);

    expect(cleared).toBe(true);
    expect(await killSwitchService.isAgentRevoked(agentId)).toBe(false);
  });

  test('returns true even when there was nothing to clear', async () => {
    const cleared = await killSwitchService.unrevokeAgent('agent-never-killed');
    expect(cleared).toBe(true);
    expect(await killSwitchService.isAgentRevoked('agent-never-killed')).toBe(false);
  });
});
