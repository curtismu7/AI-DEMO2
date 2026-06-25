'use strict';

/**
 * Phase 2 Gateway CR-01 — HITL receipt-replay protection.
 *
 * The gateway must verify that an approved `_hitl_challenge_id` retry
 * belongs to the same user / agent / tool that the challenge was issued for
 * — otherwise an approved receipt from {userA, agentA, toolA, args=$10}
 * could be replayed for {userB, agentB, toolB, args=$5000}.
 *
 * These tests exercise the pure `verifyHitlReceipt` helper that the WS
 * handler in src/index.ts calls before forwarding the retry.
 */

import { verifyHitlReceipt, HitlChallenge } from '../src/hitlClient';

function makeApproved(overrides: Partial<HitlChallenge> = {}): HitlChallenge {
  return {
    challengeId: 'c-1',
    status: 'approved',
    expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    userId: 'user-a',
    agentId: 'agent-a',
    tool: 'create_deposit',
    ...overrides,
  };
}

describe('verifyHitlReceipt — CR-01 caller/agent/tool binding', () => {
  test('approved challenge with matching userId/agentId/tool — proceeds', () => {
    const result = verifyHitlReceipt(
      makeApproved(),
      'user-a',
      'agent-a',
      'create_deposit',
    );
    expect(result.ok).toBe(true);
  });

  test('non-approved status (pending) — rejected', () => {
    const result = verifyHitlReceipt(
      makeApproved({ status: 'pending' }),
      'user-a',
      'agent-a',
      'create_deposit',
    );
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/not approved/i);
    expect(result.message).toMatch(/pending/);
  });

  test('approved challenge with mismatched userId — rejected', () => {
    const result = verifyHitlReceipt(
      makeApproved({ userId: 'user-a' }),
      'user-b',                  // different caller
      'agent-a',
      'create_deposit',
    );
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/different user/i);
  });

  test('approved challenge with mismatched agentId — rejected', () => {
    const result = verifyHitlReceipt(
      makeApproved({ agentId: 'agent-a' }),
      'user-a',
      'agent-b',                 // different agent
      'create_deposit',
    );
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/different agent/i);
  });

  test('approved challenge with mismatched tool — rejected', () => {
    const result = verifyHitlReceipt(
      makeApproved({ tool: 'create_deposit' }),
      'user-a',
      'agent-a',
      'create_transfer',         // different tool
    );
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/different tool/i);
  });

  test('approved-but-expired challenge — rejected', () => {
    const result = verifyHitlReceipt(
      makeApproved({
        expiresAt: new Date(Date.now() - 60_000).toISOString(),  // expired 1 min ago
      }),
      'user-a',
      'agent-a',
      'create_deposit',
    );
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/expired/i);
  });

  test('missing userId in receipt — lenient, does not reject on userId', () => {
    // Older HITL service may not echo userId. The check is bind-on-presence:
    // we don't reject for ABSENT fields, only for MISMATCHED fields.
    const result = verifyHitlReceipt(
      makeApproved({ userId: null }),
      'user-a',
      'agent-a',
      'create_deposit',
    );
    expect(result.ok).toBe(true);
  });

  test('missing agentId in receipt — lenient, does not reject on agentId', () => {
    const result = verifyHitlReceipt(
      makeApproved({ agentId: null }),
      'user-a',
      'agent-a',
      'create_deposit',
    );
    expect(result.ok).toBe(true);
  });

  test('missing expectedAgentId (unactored token) — lenient', () => {
    const result = verifyHitlReceipt(
      makeApproved({ agentId: 'agent-a' }),
      'user-a',
      undefined,                 // decoded.act?.sub may be undefined
      'create_deposit',
    );
    // The check skips when either side is missing; the receipt was issued
    // with an agentId but the retry presents none — accept rather than
    // strict-reject, to preserve back-compat with unactored bearer tokens.
    expect(result.ok).toBe(true);
  });

  test('denied challenge — rejected with status message', () => {
    const result = verifyHitlReceipt(
      makeApproved({ status: 'denied' }),
      'user-a',
      'agent-a',
      'create_deposit',
    );
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/denied/);
  });
});
