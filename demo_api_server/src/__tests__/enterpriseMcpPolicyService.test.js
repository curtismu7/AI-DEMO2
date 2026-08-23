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
    // Real PingOne shape (GET /users/{id}/memberOfGroups -> _embedded.groupMemberships),
    // not _embedded.groups — see the PERMIT test below for why the distinction matters.
    pingOneUserService.makeRequest.mockResolvedValue({
      _embedded: { groupMemberships: [{ name: 'other-group' }] },
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

  // Found live 2026-08-23 against env 01d89b06: a real PingOne group member
  // (demoUser, added to banking-agents) still got DENY. listPingOneGroupNames
  // read _embedded.groups, but PingOne's memberOfGroups endpoint returns
  // _embedded.groupMemberships — the call succeeded and silently returned [],
  // so this PERMIT path was unreachable for every user, always. The population
  // shortcut test above never exercises listPingOneGroupNames at all, so this
  // is the first test that actually proves the PingOne group lookup works.
  test('checkPolicy permits a user whose real PingOne group membership matches', async () => {
    configStore.getEffective.mockImplementation((key) => {
      if (key === 'ff_enterprise_managed_mcp_auth') return 'true';
      if (key === 'enterprise_mcp_allowed_groups') return 'banking-agents,employees';
      return '';
    });
    pingOneUserService.makeRequest.mockResolvedValue({
      _embedded: { groupMemberships: [{ name: 'Sample Group' }, { name: 'banking-agents' }] },
    });

    const req = {
      session: {
        user: { oauthId: 'user-3', username: 'demoUser' },
      },
    };

    const result = await enterpriseMcpPolicy.checkPolicy(req);
    expect(result.allowed).toBe(true);
    expect(result.matchDetail).toBe('group:banking-agents');
  });
});
