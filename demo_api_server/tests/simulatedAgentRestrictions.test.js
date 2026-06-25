'use strict';

jest.mock('../services/configStore', () => ({
  get: jest.fn(() => null),
  getEffective: jest.fn(() => null),
}));

process.env.NODE_ENV = 'test';

const { evaluateAgentRestrictions } = require('../services/simulatedAuthorizeService');

describe('evaluateAgentRestrictions (simulated)', () => {
  test('PERMIT when agentRestrictions is write', () => {
    const result = evaluateAgentRestrictions({ agentRestrictions: 'write', requiredTier: 'write', userId: 'u1', agentSub: 'agent-1', tool: 'create_transfer' });
    expect(result.decision).toBe('PERMIT');
  });

  test('PERMIT when agentRestrictions is read and requiredTier is read', () => {
    const result = evaluateAgentRestrictions({ agentRestrictions: 'read', requiredTier: 'read', userId: 'u1', agentSub: 'agent-1', tool: 'get_my_accounts' });
    expect(result.decision).toBe('PERMIT');
  });

  test('DENY when agentRestrictions is read and requiredTier is write', () => {
    const result = evaluateAgentRestrictions({ agentRestrictions: 'read', requiredTier: 'write', userId: 'u1', agentSub: 'agent-1', tool: 'create_transfer' });
    expect(result.decision).toBe('DENY');
    expect(result.reason).toBe('agent_restrictions_write_blocked');
  });

  test('DENY when agentRestrictions is none', () => {
    const result = evaluateAgentRestrictions({ agentRestrictions: 'none', requiredTier: 'read', userId: 'u1', agentSub: 'agent-1', tool: 'get_my_accounts' });
    expect(result.decision).toBe('DENY');
    expect(result.reason).toBe('agent_restrictions_none');
  });
});
