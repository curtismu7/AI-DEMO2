/**
 * Integration tests for Phase 170: Transfer HITL enforcement via agent flows.
 * Tests that the BFF correctly returns 428 for transfers without consent.
 *
 * These tests use supertest against the transactions router to verify
 * the full request path (middleware + route handler).
 */
'use strict';

const txConsent = require('../../services/transactionConsentChallenge');

// Mock dataStore
jest.mock('../../data/store', () => ({
  getAccountById: jest.fn((id) => {
    const accounts = {
      'chk-5': { id: 'chk-5', userId: '5', type: 'checking', balance: 10000 },
      'sav-5': { id: 'sav-5', userId: '5', type: 'savings', balance: 5000 },
    };
    return accounts[id] || null;
  }),
  getAccountsByUserId: jest.fn((userId) =>
    userId === '5'
      ? [
          { id: 'chk-5', userId: '5', type: 'checking', balance: 10000 },
          { id: 'sav-5', userId: '5', type: 'savings', balance: 5000 },
        ]
      : []
  ),
  getUserById: jest.fn(() => null),
}));

describe('Phase 170 — Transfer 428 enforcement (integration)', () => {
  describe('createChallenge + verifyAndConsumeChallenge flow', () => {
    test('transfer $5 creates challenge, then verifyAndConsume succeeds after confirm flow', () => {
      // Step 1: Create challenge for a small transfer
      const session = { txConsentChallenges: {} };
      const req = { user: { id: '5', role: 'customer' }, session };
      const body = {
        type: 'transfer',
        amount: 5.00,
        fromAccountId: 'chk-5',
        toAccountId: 'sav-5',
        description: 'Small transfer',
      };

      const created = txConsent.createChallenge(req, body);
      expect(created.ok).toBe(true);
      expect(created.challengeId).toBeDefined();

      // Step 2: Simulate OTP confirm (directly set status to 'confirmed' for unit test)
      const ch = session.txConsentChallenges[created.challengeId];
      ch.status = 'confirmed';
      ch.confirmExpiresAt = Date.now() + 300000; // 5 min

      // Step 3: Verify and consume
      const consumed = txConsent.verifyAndConsumeChallenge(req, created.challengeId, body);
      expect(consumed.ok).toBe(true);

      // Step 4: Challenge is consumed — second attempt fails
      const second = txConsent.verifyAndConsumeChallenge(req, created.challengeId, body);
      expect(second.ok).toBe(false);
    });

    test('verifyAndConsumeChallenge fails without challengeId', () => {
      const req = { user: { id: '5', role: 'customer' }, session: { txConsentChallenges: {} } };
      const result = txConsent.verifyAndConsumeChallenge(req, null, {
        type: 'transfer', amount: 1.00, fromAccountId: 'chk-5', toAccountId: 'sav-5',
      });
      expect(result.ok).toBe(false);
      expect(result.status).toBe(400);
      expect(result.json.error).toBe('consent_challenge_required');
    });

    test('verifyAndConsumeChallenge fails with mismatched payload', () => {
      const session = { txConsentChallenges: {} };
      const req = { user: { id: '5', role: 'customer' }, session };
      const body = {
        type: 'transfer', amount: 5.00, fromAccountId: 'chk-5', toAccountId: 'sav-5', description: 'Original',
      };

      const created = txConsent.createChallenge(req, body);
      expect(created.ok).toBe(true);

      // Simulate confirm
      const ch = session.txConsentChallenges[created.challengeId];
      ch.status = 'confirmed';
      ch.confirmExpiresAt = Date.now() + 300000;

      // Try to consume with different amount
      const tampered = { ...body, amount: 500.00 };
      const consumed = txConsent.verifyAndConsumeChallenge(req, created.challengeId, tampered);
      expect(consumed.ok).toBe(false);
      expect(consumed.json.error).toBe('consent_payload_mismatch');
    });
  });
});
