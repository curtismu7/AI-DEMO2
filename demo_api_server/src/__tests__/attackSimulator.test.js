'use strict';
/**
 * Real-API tests for A6.1 + A6.2 Attack Simulator.
 * Skipped unless ATTACK_SIM_REAL_API=true (requires live PingOne session + gateway).
 *
 * Run:
 *   ATTACK_SIM_REAL_API=true ATTACK_SIM_USER_TOKEN=<token> \
 *     npx jest --testPathPattern attackSimulator '--testPathIgnorePatterns=[]'
 *
 * The tests assert REASON-DISTINCT error codes, not just HTTP status.
 * Each sim must return the exact code from the gateway, not a generic fallback.
 */

const realApi = process.env.ATTACK_SIM_REAL_API === 'true';
const describeIf = realApi ? describe : describe.skip;

const { runAttackSim } = require('../../services/attackSimulatorService');

/**
 * Build a synthetic session-like req with a real access token from env.
 * Only called when realApi=true (skip guard ensures it).
 */
function makeReq() {
  const token = process.env.ATTACK_SIM_USER_TOKEN;
  if (!token) throw new Error('ATTACK_SIM_USER_TOKEN env var required for real-API tests');
  return {
    session: { oauthTokens: { accessToken: token } },
    useCaseId: undefined,
  };
}

// ─── Structural unit tests (always run) ──────────────────────────────────────

describe('AttackSimulator — structural (no creds needed)', () => {
  test('runAttackSim returns no_session_token when session is missing', async () => {
    const result = await runAttackSim('insufficient-scope', {
      session: { oauthTokens: {} },
    });
    expect(result.sim).toBe('insufficient-scope');
    expect(result.errorCode).toBe('no_session_token');
    expect(result.status).toBe(401);
    expect(result.tokenChainEvents).toBeInstanceOf(Array);
  });

  test('runAttackSim returns no_session_token when session is absent', async () => {
    const result = await runAttackSim('wrong-aud', { session: null });
    expect(result.errorCode).toBe('no_session_token');
  });

  test('runAttackSim returns unknown_sim for an unrecognised sim id', async () => {
    const result = await runAttackSim('not-a-real-sim', {
      session: { oauthTokens: { accessToken: 'tok' } },
    });
    expect(result.errorCode).toBe('unknown_sim');
    expect(result.status).toBe(400);
  });

  test('tokenChainEvents is always an array on error paths', async () => {
    const result = await runAttackSim('insufficient-scope', {});
    expect(Array.isArray(result.tokenChainEvents)).toBe(true);
  });

  const A62_SIM_USE_CASE_IDS = {
    'cross-owner-account': 'cross-owner-account',
    'replayed-token': 'token-theft-replay',
    'rogue-actor': 'confused-deputy-actor-injection',
    'rar-exceeded': 'rar-intent-violation',
    'tampered-intent-token': 'intent-token-tampering',
    'impersonation-no-act': 'impersonation-blocked',
    'rate-limit-burst': 'rate-limit-defense',
  };

  test.each(Object.entries(A62_SIM_USE_CASE_IDS))(
    'A6.2 sim %s is recognised and maps to catalog slug %s',
    async (sim, expectedSlug) => {
      const result = await runAttackSim(sim, {
        session: { oauthTokens: { accessToken: 'not-a-real-jwt' } },
      });
      expect(result.sim).toBe(sim);
      expect(result.useCaseId).toBe(expectedSlug);
      expect(result.errorCode).not.toBe('unknown_sim');
      expect(Array.isArray(result.tokenChainEvents)).toBe(true);
    },
  );
});

// ─── Real-API tests (skipped unless ATTACK_SIM_REAL_API=true) ────────────────

describeIf('AttackSimulator — real-API (insufficient-scope)', () => {
  test('returns errorCode insufficient_scope on the gateway rejection', async () => {
    const result = await runAttackSim('insufficient-scope', makeReq());

    expect(result.sim).toBe('insufficient-scope');
    // The gateway MUST return 403 with error code 'insufficient_scope'.
    // NOT a generic 'invalid_token' (reason-distinctness requirement).
    expect(result.errorCode).toBe('insufficient_scope');
    expect(result.status).toBe(403);
    expect(result.tokenChainEvents).toBeInstanceOf(Array);
    expect(result.tokenChainEvents.length).toBeGreaterThan(0);
    // At least one step must carry status 'error' (the deny step).
    const denyStep = result.tokenChainEvents.find((e) => e.status === 'error');
    expect(denyStep).toBeDefined();
    // useCaseId is the catalog slug (UC5.useCaseId), not the id
    expect(result.useCaseId).toBe('insufficient-scope');
    // Every token chain event must be stamped with the useCaseId
    result.tokenChainEvents.forEach((ev) => {
      expect(ev.useCaseId).toBe('insufficient-scope');
    });
  }, 30000);
});

describeIf('AttackSimulator — real-API (wrong-aud)', () => {
  test('returns errorCode invalid_aud on the gateway rejection', async () => {
    const result = await runAttackSim('wrong-aud', makeReq());

    expect(result.sim).toBe('wrong-aud');
    // The gateway tokenValidator throws TokenValidationError code 'invalid_aud'.
    // NOT a generic 'invalid_token' (reason-distinctness requirement).
    expect(result.errorCode).toBe('invalid_aud');
    expect(result.status).toBe(401);
    expect(result.tokenChainEvents).toBeInstanceOf(Array);
    expect(result.tokenChainEvents.length).toBeGreaterThan(0);
    const denyStep = result.tokenChainEvents.find((e) => e.status === 'error');
    expect(denyStep).toBeDefined();
    // useCaseId is the catalog slug (UC11.useCaseId), not the id
    expect(result.useCaseId).toBe('bad-client-gateway');
    // Every token chain event must be stamped with the useCaseId
    result.tokenChainEvents.forEach((ev) => {
      expect(ev.useCaseId).toBe('bad-client-gateway');
    });
  }, 30000);
});
