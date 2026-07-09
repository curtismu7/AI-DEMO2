'use strict';

jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn(),
}));

jest.mock('../../services/appEventService', () => ({
  logEvent: jest.fn(),
}));

jest.mock('../../services/pingOneUserService', () => ({
  environmentId: null,
  initialize: jest.fn(),
  makeRequest: jest.fn(),
}));

const configStore = require('../../services/configStore');
const pingOneUserService = require('../../services/pingOneUserService');
const enterpriseMcpPolicy = require('../../services/enterpriseMcpPolicyService');

describe('enterpriseMcpPolicyService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    configStore.getEffective.mockImplementation((key) => {
      if (key === 'ff_enterprise_managed_mcp_auth') return 'false';
      if (key === 'enterprise_mcp_allowed_groups') return 'banking-agents,employees';
      return '';
    });
  });

  test('isEnabled reflects feature flag', () => {
    expect(enterpriseMcpPolicy.isEnabled()).toBe(false);
    configStore.getEffective.mockImplementation((key) =>
      key === 'ff_enterprise_managed_mcp_auth' ? 'true' : ''
    );
    expect(enterpriseMcpPolicy.isEnabled()).toBe(true);
  });

  test('checkPolicy returns not_enabled when flag is off', async () => {
    const req = { session: {} };
    const result = await enterpriseMcpPolicy.checkPolicy(req);
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('enterprise_mcp_not_enabled');
  });

  test('checkPolicy permits user in allowed group via PingOne API', async () => {
    configStore.getEffective.mockImplementation((key) => {
      if (key === 'ff_enterprise_managed_mcp_auth') return 'true';
      if (key === 'enterprise_mcp_allowed_groups') return 'banking-agents';
      return '';
    });
    const req = {
      session: {
        populationId: 'banking-agents',
        user: { oauthId: 'user-1', username: 'demoUser' },
      },
    };

    const result = await enterpriseMcpPolicy.checkPolicy(req);
    expect(result.allowed).toBe(true);
    expect(result.matchDetail).toMatch(/^population:banking-agents/);
  });

  test('checkPolicy denies user with no matching groups', async () => {
    configStore.getEffective.mockImplementation((key) => {
      if (key === 'ff_enterprise_managed_mcp_auth') return 'true';
      if (key === 'enterprise_mcp_allowed_groups') return 'banking-agents';
      return '';
    });
    pingOneUserService.makeRequest.mockResolvedValue({
      _embedded: { groups: [{ name: 'other-group' }] },
    });

    const req = {
      session: {
        user: { oauthId: 'user-2', username: 'guest' },
      },
    };

    const result = await enterpriseMcpPolicy.checkPolicy(req);
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('enterprise_mcp_policy_denied');
    expect(result.httpStatus).toBe(403);
  });
});
