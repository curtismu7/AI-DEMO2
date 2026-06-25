'use strict';

/**
 * hitlBypass.regression.test.js
 *
 * Regression lock for Attack 2 — the consentGiven=true HITL bypass.
 * Four cases must hold forever:
 *  (a) No hitlChallengeId on a tool that requires HITL → decision is HITL, not PERMIT
 *  (b) Fake/unknown hitlChallengeId                  → decision is HITL (re-challenge), not PERMIT
 *  (c) Valid verified hitlChallengeId                 → decision is PERMIT with reason 'hitl_receipt_verified'
 *  (d) Legacy consentGiven=true body field            → silently ignored → HITL (not PERMIT)
 */

const _cfg = { ff_authorize_fail_open: 'true' };
jest.mock('../services/configStore', () => ({
  get: jest.fn((k) => _cfg[k] ?? null),
  getEffective: jest.fn((k) => _cfg[k] ?? null),
}));

jest.mock('../services/agentMcpTokenService', () => ({
  resolveMcpAccessTokenWithEvents: jest.fn(async () => ({
    token: 'fake-token',
    userSub: 'user-sub',
    tokenEvents: [],
  })),
  decodeJwtClaims: jest.fn(() => ({ claims: { sub: 'user-sub' } })),
}));

jest.mock('../services/mcpToolAuthorizationService', () => ({
  evaluateMcpFirstToolGate: jest.fn(async () => ({
    ran: true,
    block: { status: 428, body: { error: 'mcp_hitl_required' } },
  })),
}));

jest.mock('../services/hitlServiceClient', () => ({
  createChallenge: jest.fn(async () => ({
    challengeId: 'ch-001',
    expiresAt: '2099-01-01T00:00:00Z',
  })),
  getChallengeStatus: jest.fn(async (id) => {
    if (id === 'valid-ch-001') {
      return {
        status: 'approved',
        userId: 'user-sub',
        agentId: '',
        tool: 'create_transfer',
        expiresAt: '2099-01-01T00:00:00Z',
      };
    }
    const err = new Error('not found');
    err.status = 404;
    throw err;
  }),
  verifyHitlReceipt: jest.fn((status) =>
    status.status === 'approved' ? { ok: true } : { ok: false, message: 'not approved' }
  ),
}));

const { evaluateMcpFirstToolGate } = require('../services/mcpToolAuthorizationService');
const { evaluate } = require('../services/agentPreflightService');

const fakeReq = () => ({
  session: { user: { role: 'user', acr: 'urn:acme:Bronze', email: 'test@example.com' } },
  correlationId: 'corr-bypass-test',
});

beforeEach(() => jest.clearAllMocks());

describe('Attack 2 — HITL Bypass regression', () => {
  test('(a) No hitlChallengeId → gate triggers HITL, not PERMIT', async () => {
    const result = await evaluate({ req: fakeReq(), tool: 'create_transfer', params: { amount: 1000 } });
    expect(result.decision).toBe('HITL');
    expect(result.reason).toBeUndefined();
    expect(evaluateMcpFirstToolGate).toHaveBeenCalledTimes(1);
  });

  test('(b) Fake / unknown hitlChallengeId → falls through to gate, HITL re-issued, never PERMIT', async () => {
    const result = await evaluate({
      req: fakeReq(),
      tool: 'create_transfer',
      params: { amount: 1000 },
      hitlChallengeId: 'attacker-invented-id',
    });
    expect(result.decision).toBe('HITL');
    expect(evaluateMcpFirstToolGate).toHaveBeenCalledTimes(1);
  });

  test('(c) Valid verified hitlChallengeId → PERMIT with hitl_receipt_verified, gate not called', async () => {
    const result = await evaluate({
      req: fakeReq(),
      tool: 'create_transfer',
      params: { amount: 1000 },
      hitlChallengeId: 'valid-ch-001',
    });
    expect(result.decision).toBe('PERMIT');
    expect(result.reason).toBe('hitl_receipt_verified');
    expect(evaluateMcpFirstToolGate).not.toHaveBeenCalled();
  });

  test('(d) Legacy consentGiven=true body field is ignored — evaluate() does not accept it', async () => {
    const result = await evaluate({
      req: fakeReq(),
      tool: 'create_transfer',
      params: { amount: 1000 },
      consentGiven: true,   // silently ignored after hardening
    });
    expect(result.decision).toBe('HITL');
    expect(evaluateMcpFirstToolGate).toHaveBeenCalledTimes(1);
  });
});
