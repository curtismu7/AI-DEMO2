'use strict';

// Mock configStore before requiring the service
const _cfg = { ff_authorize_fail_open: 'true' };
jest.mock('../services/configStore', () => ({
  get: jest.fn((k) => _cfg[k] ?? null),
  getEffective: jest.fn((k) => _cfg[k] ?? null),
}));

// Mock token resolver — returns a fake MCP token
jest.mock('../services/agentMcpTokenService', () => ({
  resolveMcpAccessTokenWithEvents: jest.fn(async () => ({
    token: 'mock-mcp-token',
    tokenEvents: [],
    userSub: 'user-123',
  })),
  decodeJwtClaims: jest.fn(() => ({ claims: { sub: 'agent-client-id' } })),
}));

// Mock the gate — controls all test outcomes
jest.mock('../services/mcpToolAuthorizationService', () => ({
  evaluateMcpFirstToolGate: jest.fn(),
}));

// Mock HITL service client
jest.mock('../services/hitlServiceClient', () => ({
  createChallenge: jest.fn(async () => ({
    challengeId: 'challenge-abc',
    expiresAt: '2099-01-01T00:00:00Z',
  })),
  getChallengeStatus: jest.fn(async (id) => {
    if (id === 'valid-challenge-id') {
      return { status: 'approved', userId: 'user-123', agentId: 'agent-client-id', tool: 'create_transfer', expiresAt: '2099-01-01T00:00:00Z' };
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
  correlationId: 'corr-1',
});

describe('agentPreflightService.evaluate()', () => {
  beforeEach(() => jest.clearAllMocks());

  test('PERMIT: gate returns permit → decision is PERMIT', async () => {
    evaluateMcpFirstToolGate.mockResolvedValueOnce({
      ran: true,
      permit: true,
      evaluation: { engine: 'simulated', decision: 'PERMIT', decisionId: 'dec-1' },
    });
    const result = await evaluate({ req: fakeReq(), tool: 'get_accounts', params: {} });
    expect(result.decision).toBe('PERMIT');
    expect(result.engine).toBe('simulated');
  });

  test('DENY: gate returns deny block → decision is DENY with reason', async () => {
    evaluateMcpFirstToolGate.mockResolvedValueOnce({
      ran: true,
      block: {
        status: 403,
        body: {
          error: 'mcp_authorization_denied',
          error_description: 'Policy denied',
          authorize_engine: 'simulated',
          decisionId: 'dec-2',
          deny_reason: 'transfer_limit_exceeded',
        },
      },
    });
    const result = await evaluate({ req: fakeReq(), tool: 'create_transfer', params: { amount: 9999 } });
    expect(result.decision).toBe('DENY');
    expect(result.reason).toBe('transfer_limit_exceeded');
  });

  test('HITL: gate returns hitl block → decision HITL with challengeId', async () => {
    evaluateMcpFirstToolGate.mockResolvedValueOnce({
      ran: true,
      block: {
        status: 428,
        body: {
          error: 'mcp_hitl_required',
          error_description: 'Approval required',
          authorize_engine: 'simulated',
          decisionId: 'dec-3',
        },
      },
    });
    const result = await evaluate({ req: fakeReq(), tool: 'create_transfer', params: { amount: 600 } });
    expect(result.decision).toBe('HITL');
    expect(result.type).toBe('consent');
    expect(result.challengeId).toBe('challenge-abc');
    expect(result.expiresAt).toBeDefined();
    expect(result.directives).toMatchObject({ challengeId: 'challenge-abc', type: 'consent' });
  });

  test('STEP_UP: gate returns step-up block → decision STEP_UP', async () => {
    evaluateMcpFirstToolGate.mockResolvedValueOnce({
      ran: true,
      block: {
        status: 428,
        body: {
          error: 'mcp_step_up_required',
          error_description: 'MFA required',
          authorize_engine: 'simulated',
          decisionId: 'dec-4',
        },
      },
    });
    const result = await evaluate({ req: fakeReq(), tool: 'get_sensitive_account_details', params: {} });
    expect(result.decision).toBe('STEP_UP');
    expect(result.type).toBe('step_up');
  });

  test('gate did not run (admin exempt) → PERMIT with fallback flag', async () => {
    evaluateMcpFirstToolGate.mockResolvedValueOnce({ ran: false, reason: 'admin_role_exempt' });
    const result = await evaluate({ req: fakeReq(), tool: 'get_accounts', params: {} });
    expect(result.decision).toBe('PERMIT');
    expect(result.fallback).toBe(true);
  });

  test('hitlChallengeId with verified receipt → PERMIT, gate not called', async () => {
    const result = await evaluate({ req: fakeReq(), tool: 'create_transfer', params: {}, hitlChallengeId: 'valid-challenge-id' });
    expect(result.decision).toBe('PERMIT');
    expect(result.reason).toBe('hitl_receipt_verified');
    expect(evaluateMcpFirstToolGate).not.toHaveBeenCalled();
  });

  test('hitlChallengeId with invalid/unknown receipt → falls through to gate (re-challenge)', async () => {
    evaluateMcpFirstToolGate.mockResolvedValueOnce({
      ran: true,
      block: { status: 428, body: { error: 'mcp_hitl_required', error_description: 'Approval required', authorize_engine: 'simulated', decisionId: 'dec-retry' } },
    });
    const result = await evaluate({ req: fakeReq(), tool: 'create_transfer', params: {}, hitlChallengeId: 'bad-challenge-id' });
    expect(result.decision).toBe('HITL');
    expect(evaluateMcpFirstToolGate).toHaveBeenCalledTimes(1);
  });

  test('token exchange fails + fail_open=true → PERMIT with fallback', async () => {
    const { resolveMcpAccessTokenWithEvents } = require('../services/agentMcpTokenService');
    resolveMcpAccessTokenWithEvents.mockRejectedValueOnce(new Error('exchange failed'));
    const result = await evaluate({ req: fakeReq(), tool: 'create_transfer', params: {} });
    expect(result.decision).toBe('PERMIT');
    expect(result.fallback).toBe(true);
    expect(result.reason).toBe('token_exchange_failed');
  });

  test('token exchange fails + fail_open unset/false → DENY (default fail-closed)', async () => {
    const prev = _cfg.ff_authorize_fail_open;
    _cfg.ff_authorize_fail_open = 'false';
    const { resolveMcpAccessTokenWithEvents } = require('../services/agentMcpTokenService');
    resolveMcpAccessTokenWithEvents.mockRejectedValueOnce(new Error('exchange failed'));
    try {
      const result = await evaluate({ req: fakeReq(), tool: 'create_transfer', params: {} });
      expect(result.decision).toBe('DENY');
      expect(result.reason).toBe('token_exchange_failed');
      expect(result.fallback).toBeUndefined();
    } finally {
      _cfg.ff_authorize_fail_open = prev;
    }
  });

  test('blocked resolution (ff_skip_token_exchange deny) → DENY immediately, gate never called, even with fail_open=true', async () => {
    const { resolveMcpAccessTokenWithEvents } = require('../services/agentMcpTokenService');
    resolveMcpAccessTokenWithEvents.mockResolvedValueOnce({
      token: null,
      tokenEvents: [{ id: 'exchange-skipped', status: 'failed' }],
      userSub: null,
      blocked: true,
      blockCode: 'user_token_forwarding_disabled',
      blockMessage: 'Raw user-token forwarding to MCP is disabled. Use RFC 8693 token exchange instead.',
      blockHttpStatus: 403,
    });
    const result = await evaluate({ req: fakeReq(), tool: 'create_transfer', params: {} });
    expect(result.decision).toBe('DENY');
    expect(result.reason).toBe('user_token_forwarding_disabled');
    expect(result.message).toBe('Raw user-token forwarding to MCP is disabled. Use RFC 8693 token exchange instead.');
    // Must short-circuit before the gate — a blocked resolution must never reach
    // the `!gate.ran` PERMIT fallback (gate not called with an empty token).
    expect(evaluateMcpFirstToolGate).not.toHaveBeenCalled();
  });
});
