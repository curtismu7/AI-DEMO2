/**
 * killSwitchService.test.js
 * 
 * Tests for AI Safety Red Button kill switch service
 */

const killSwitchService = require('../../services/killSwitchService');
const auditLogService = require('../../services/auditLogService');

// Mock dependencies
jest.mock('../../services/auditLogService');
jest.mock('axios');
jest.mock('../../middleware/sessionConfig', () => ({
  store: {
    client: {
      get: jest.fn().mockResolvedValue('mock-refresh-token-for-agent'),
    },
  },
}), { virtual: true });
jest.mock('../../services/configStore', () => {
  const actual = jest.requireActual('../../services/configStore');
  return {
    ...actual,
    get: jest.fn((key) => {
      if (key === 'admin_client_id') return 'test-admin-id';
      if (key === 'admin_client_secret') return 'test-admin-secret';
      return null;
    }),
    getEffective: jest.fn(() => null),
  };
});

const axios = require('axios');

describe('killSwitchService', () => {
  
  beforeEach(() => {
    jest.clearAllMocks();
    auditLogService.recordKillEvent.mockResolvedValue('audit-id-123');
    auditLogService.recordKillFailure.mockResolvedValue('audit-fail-123');
    // Restore default session config mock — provides a refresh token so revocation tests work
    const sessionConfigMock = require('../../middleware/sessionConfig');
    sessionConfigMock.store.client.get.mockResolvedValue('mock-refresh-token-for-agent');
  });

  describe('captureAgentState', () => {
    test('should return populated state snapshot', async () => {
      const agentId = 'mcp-agent-001';
      const state = await killSwitchService.captureAgentState(agentId);

      expect(state).toBeDefined();
      expect(state.timestamp).toBeDefined();
      expect(state.agent_id).toBe(agentId);
      expect(state.token).toBeDefined();
      expect(state.token.claims).toBeDefined();
      expect(state.config).toBeDefined();
      expect(state.metrics).toBeDefined();
      expect(state.active_sessions).toEqual([]);
      expect(state.last_requests).toEqual([]);
      expect(state.actions).toEqual([]);
    });

    test('should populate config from configStore if available', async () => {
      const agentId = 'mcp-agent-001';
      const state = await killSwitchService.captureAgentState(agentId);

      expect(state.config).toHaveProperty('max_requests_per_minute');
      expect(state.config).toHaveProperty('approved_resources');
      expect(state.config).toHaveProperty('max_transaction_amount');
      expect(state.config).toHaveProperty('expires_at');
    });

    test('should include metrics in state snapshot', async () => {
      const agentId = 'mcp-agent-001';
      const state = await killSwitchService.captureAgentState(agentId);

      expect(state.metrics).toHaveProperty('requests_last_5m');
      expect(state.metrics).toHaveProperty('errors_last_5m');
      expect(state.metrics).toHaveProperty('rate_limit_violations');
      expect(state.metrics).toHaveProperty('avg_latency_ms');
    });
  });

  describe('isAgentRevoked', () => {
    test('should return false for non-revoked agent', async () => {
      const agentId = 'mcp-agent-001';
      const isRevoked = await killSwitchService.isAgentRevoked(agentId);

      expect(typeof isRevoked).toBe('boolean');
      expect(isRevoked).toBe(false);
    });
  });

  describe('killAgent', () => {
    test('should revoke token and return success', async () => {
      const agentId = 'mcp-agent-001';
      
      axios.post.mockResolvedValue({ status: 200, data: {} });

      const result = await killSwitchService.killAgent(agentId, 'manual_red_button');

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.revoked_at).toBeDefined();
      expect(result.state_snapshot_id).toBeDefined();
      expect(result.time_to_revoke_ms).toBeGreaterThanOrEqual(0);
      
      // Verify audit log was called
      expect(auditLogService.recordKillEvent).toHaveBeenCalled();
      const callArgs = auditLogService.recordKillEvent.mock.calls[0];
      expect(callArgs[0]).toBe(agentId);
      expect(callArgs[1]).toBe('manual_red_button');
    });

    test('should handle revocation error', async () => {
      const agentId = 'mcp-agent-001';

      // No oauthTokens passed — revokeAllTokens returns {revoked:false, error:'no_tokens'}.
      // killAgent does NOT throw on revocation failure; it proceeds with session invalidation.
      const result = await killSwitchService.killAgent(agentId, 'test_error');
      expect(result.success).toBe(true);
    });

    test('should include reason in audit log', async () => {
      const agentId = 'mcp-agent-001';
      const reason = 'Misbehaving';
      
      axios.post.mockResolvedValue({ status: 200, data: {} });

      await killSwitchService.killAgent(agentId, reason);

      expect(auditLogService.recordKillEvent).toHaveBeenCalledWith(
        agentId,
        reason,
        expect.objectContaining({
          agent_id: agentId,
        }),
        expect.any(Number),
        expect.any(String)
      );
    });

    test('should capture state before invalidating sessions', async () => {
      const agentId = 'mcp-agent-001';
      
      axios.post.mockResolvedValue({ status: 200, data: {} });

      const result = await killSwitchService.killAgent(agentId, 'test');

      // State snapshot should be passed to audit log
      expect(auditLogService.recordKillEvent).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({
          timestamp: expect.any(String),
          agent_id: agentId,
          token: expect.any(Object),
          metrics: expect.any(Object),
        }),
        expect.any(Number),
        expect.any(String)
      );
    });
  });

  describe('revokeTokenAtPingOne', () => {
    test('should return revoked=true on success', async () => {
      axios.post.mockResolvedValue({ status: 200, data: {} });

      const result = await killSwitchService.revokeTokenAtPingOne('mcp-agent-001');

      expect(result).toBeDefined();
      expect(result.revoked).toBe(true);
    });

    test('should throw on revocation failure', async () => {
      axios.post.mockRejectedValue(new Error('Network error'));

      await expect(killSwitchService.revokeTokenAtPingOne('mcp-agent-001'))
        .rejects
        .toThrow('Network error');
    });

    test('should use correct PingOne endpoint', async () => {
      axios.post.mockResolvedValue({ status: 200, data: {} });

      await killSwitchService.revokeTokenAtPingOne('mcp-agent-001');

      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining('/revoke'),
        expect.stringContaining('token='),
        expect.any(Object)
      );
    });
  });

  describe('invalidateSessionsInRedis', () => {
    test('should return invalidated count', async () => {
      const result = await killSwitchService.invalidateSessionsInRedis('mcp-agent-001');

      expect(result).toBeDefined();
      expect(result).toHaveProperty('invalidated');
      expect(typeof result.invalidated).toBe('number');
    });
  });

  describe('Error handling and recovery', () => {
    test('should retry revocation on first failure', async () => {
      const agentId = 'mcp-agent-001';
      
      // revokeTokenAtPingOne returns {revoked: false} when no refresh token found.
      // killAgent retries once if first attempt returns revoked=false.
      const sessionConfigMock = require('../../middleware/sessionConfig');
      sessionConfigMock.store.client.get
        .mockResolvedValueOnce(null)   // First call: no token → {revoked: false}
        .mockResolvedValueOnce('retry-refresh-token'); // Retry: has token → calls axios

      axios.post.mockResolvedValueOnce({ status: 200, data: {} });

      const result = await killSwitchService.killAgent(agentId, 'test_retry');

      expect(result.success).toBe(true);
    });

    test('should succeed even when no tokens to revoke', async () => {
      const agentId = 'mcp-agent-001';

      // No oauthTokens passed → revokeAllTokens returns {revoked:false, error:'no_tokens'}.
      // killAgent does not retry or throw; it continues with session cleanup and returns success.
      const result = await killSwitchService.killAgent(agentId, 'test_no_tokens');
      expect(result.success).toBe(true);
    });
  });

  describe('Concurrency', () => {
    test('should handle concurrent kill requests for same agent', async () => {
      const agentId = 'mcp-agent-001';
      
      axios.post.mockResolvedValue({ status: 200, data: {} });

      const promise1 = killSwitchService.killAgent(agentId, 'kill1');
      const promise2 = killSwitchService.killAgent(agentId, 'kill2');

      const results = await Promise.all([promise1, promise2]);

      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(true);
      // Both should have different audit IDs
      expect(results[0].state_snapshot_id).not.toBe(results[1].state_snapshot_id);
    });
  });
});
