'use strict';

jest.mock('../services/configStore', () => ({
  get: jest.fn((key) => {
    if (key === 'ff_agent_restrictions') return 'true';
    return null;
  }),
  getEffective: jest.fn((key) => {
    if (key === 'ff_agent_restrictions') return 'true';
    return null;
  }),
}));

const scopeTopology = require('../../scope-topology.json');
const { getRequiredTier, isAgentRestricted } = require('../services/agentRestrictionsService');

describe('getRequiredTier', () => {
  test('returns write for a tool with high riskLevel scope', () => {
    // 'write' scope has riskLevel 'high' in scope-topology.json
    expect(getRequiredTier('create_transfer')).toBe('write');
  });

  test('returns read for a tool with low riskLevel scope', () => {
    // 'read' scope has riskLevel 'low' in scope-topology.json
    expect(getRequiredTier('get_my_accounts')).toBe('read');
  });

  test('returns read for unknown tool (fail open)', () => {
    expect(getRequiredTier('unknown_tool_xyz')).toBe('read');
  });
});

describe('isAgentRestricted', () => {
  test('none blocks all calls', () => {
    expect(isAgentRestricted('none', 'read')).toBe(true);
    expect(isAgentRestricted('none', 'write')).toBe(true);
  });

  test('read blocks write calls', () => {
    expect(isAgentRestricted('read', 'write')).toBe(true);
  });

  test('read permits read calls', () => {
    expect(isAgentRestricted('read', 'read')).toBe(false);
  });

  test('write permits all calls', () => {
    expect(isAgentRestricted('write', 'read')).toBe(false);
    expect(isAgentRestricted('write', 'write')).toBe(false);
  });
});
