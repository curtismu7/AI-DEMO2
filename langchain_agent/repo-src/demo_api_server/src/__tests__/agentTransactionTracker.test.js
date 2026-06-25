/**
 * @file agentTransactionTracker.test.js
 * @description Tests for agent transaction limit enforcement
 */

const agentTransactionTracker = require('../../services/agentTransactionTracker');
const runtimeSettings = require('../../config/runtimeSettings');

describe('agentTransactionTracker', () => {
  beforeEach(() => {
    // Reset runtimeSettings to defaults
    runtimeSettings.update(
      {
        agentTransactionCountLimit: 3,   // 3 transactions per approval
        agentTransactionValueLimit: 5000, // $5000 total per approval
      },
      'test-setup',
    );
  });

  describe('checkAgentTransactionBudget', () => {
    // Scenario A: Delegated agent within budget
    test('should allow delegated agent within count budget', () => {
      const req = {
        user: { isDelegated: true, id: 'agent-123', role: 'agent' },
        session: {
          agentTransactionTracker: {
            consumedCount: 1,   // 1 of 3
            consumedValue: 1000, // $1000 of $5000
            lastResetAt: new Date(),
            approvalTokenId: 'approval-001',
          },
        },
      };

      const result = agentTransactionTracker.checkAgentTransactionBudget(req, 2000, 'transfer');

      expect(result.ok).toBe(true);
      expect(result.consumed).toEqual({ count: 2, value: 3000 });
      expect(result.remaining).toEqual({ count: 1, value: 2000 });
    });

    // Scenario B: Delegated agent exceeds count limit
    test('should block agent transaction when count limit exceeded', () => {
      const req = {
        user: { isDelegated: true, id: 'agent-123', role: 'agent' },
        session: {
          agentTransactionTracker: {
            consumedCount: 3, // 3 of 3 (limit reached)
            consumedValue: 2000,
            lastResetAt: new Date(),
            approvalTokenId: 'approval-001',
          },
        },
      };

      const result = agentTransactionTracker.checkAgentTransactionBudget(req, 500, 'transfer');

      expect(result.ok).toBe(false);
      expect(result.error.status).toBe(429);
      expect(result.error.json.error).toBe('agent_transaction_limit_exceeded');
      expect(result.error.json.limit_type).toBe('count');
      expect(result.error.json.consumed).toBe(3);
    });

    // Scenario C: Delegated agent exceeds value limit
    test('should block agent transaction when value limit would be exceeded', () => {
      const req = {
        user: { isDelegated: true, id: 'agent-123', role: 'agent' },
        session: {
          agentTransactionTracker: {
            consumedCount: 1,      // 1 of 3
            consumedValue: 4500,   // $4500 of $5000
            lastResetAt: new Date(),
            approvalTokenId: 'approval-001',
          },
        },
      };

      const result = agentTransactionTracker.checkAgentTransactionBudget(req, 1000, 'transfer');

      expect(result.ok).toBe(false);
      expect(result.error.status).toBe(429);
      expect(result.error.json.error).toBe('agent_transaction_limit_exceeded');
      expect(result.error.json.limit_type).toBe('value');
      expect(result.error.json.remaining).toBe(500);
    });

    // Scenario D: Non-delegated user bypasses agent limit
    test('should bypass agent limit for non-delegated user', () => {
      const req = {
        user: { isDelegated: false, id: 'user-456', role: 'user' },
        session: { agentTransactionTracker: { consumedCount: 100 } }, // Bogus state
      };

      const result = agentTransactionTracker.checkAgentTransactionBudget(req, 999999, 'transfer');

      expect(result.ok).toBe(true); // No error despite being over limit
    });

    // Scenario E: Admin user bypasses agent limit
    test('should bypass agent limit for admin user', () => {
      const req = {
        user: { isDelegated: true, id: 'admin-789', role: 'admin' },
        session: { agentTransactionTracker: { consumedCount: 100 } }, // Bogus state
      };

      const result = agentTransactionTracker.checkAgentTransactionBudget(req, 999999, 'transfer');

      expect(result.ok).toBe(true); // No error despite being over limit
    });
  });

  describe('consumeAgentTransaction', () => {
    test('should decrement count and add value', () => {
      const req = {
        user: { isDelegated: true, id: 'agent-123', role: 'agent' },
        session: {
          agentTransactionTracker: {
            consumedCount: 1,
            consumedValue: 1000,
            lastResetAt: new Date(),
            approvalTokenId: 'approval-001',
          },
        },
      };

      agentTransactionTracker.consumeAgentTransaction(req, 2000, 'transfer');

      expect(req.session.agentTransactionTracker.consumedCount).toBe(2);
      expect(req.session.agentTransactionTracker.consumedValue).toBe(3000);
    });
  });

  describe('resetAgentBudget', () => {
    test('should reset counters to zero and set new approval token', () => {
      const req = {
        user: { id: 'agent-123' },
        session: {
          agentTransactionTracker: {
            consumedCount: 5,
            consumedValue: 3000,
            lastResetAt: new Date('2026-01-01'),
            approvalTokenId: 'old-approval',
          },
        },
      };

      agentTransactionTracker.resetAgentBudget(req, 'new-approval-001');

      expect(req.session.agentTransactionTracker.consumedCount).toBe(0);
      expect(req.session.agentTransactionTracker.consumedValue).toBe(0);
      expect(req.session.agentTransactionTracker.approvalTokenId).toBe('new-approval-001');
    });
  });
});
