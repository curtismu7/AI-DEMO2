'use strict';

/**
 * Phase B: centralized revocation.
 *
 * Two things make revocation unprovable without this change — the 5-minute
 * policy cache, and the access token the session is already holding. Denying
 * the NEXT mint does nothing about a token already in hand.
 */

jest.mock('../../services/configStore', () => ({ getEffective: jest.fn() }));
jest.mock('../../services/appEventService', () => ({ logEvent: jest.fn(), logAppEvent: jest.fn() }));
jest.mock('../../services/pingOneUserService', () => ({
  environmentId: 'env-1', initialize: jest.fn(), makeRequest: jest.fn(),
}));
jest.mock('../../services/groupPolicy', () => ({ groupsForUserSync: jest.fn(() => []) }));
jest.mock('../../services/scopeTopology', () => ({
  audiences: jest.fn(() => ({ mcpServer: 'https://mcpserver.ping.demo', mcpGateway: 'https://mcpgw.ping.demo' })),
}));
jest.mock('axios');

// Re-required per test, NOT at module scope. setup.js's afterEach calls
// jest.resetModules(), and checkPolicy reaches pingOneUserService through a
// lazy require() — so a module-scope handle would configure a stale instance
// while production resolved a fresh one, and every PERMIT would read as DENY.
let axios;
let configStore;
let pingOneUserService;
let policy;

function loadModules() {
  axios = require('axios');
  configStore = require('../../services/configStore');
  pingOneUserService = require('../../services/pingOneUserService');
  policy = require('../../services/enterpriseMcpPolicyService');
}

function withConfig(overrides = {}) {
  const base = {
    ff_enterprise_managed_mcp_auth: 'true',
    enterprise_mcp_allowed_groups: 'banking-agents',
    enterprise_mcp_policy_cache_ttl_ms: '0',
    enterprise_mcp_as_token_url: 'https://mcpserver.ping.demo:8080/token',
  };
  const merged = { ...base, ...overrides };
  configStore.getEffective.mockImplementation((k) => (k in merged ? merged[k] : ''));
}

function req(extraSession = {}) {
  return { session: { user: { oauthId: 'user-123', username: 'alice' }, ...extraSession } };
}

describe('enterprise MCP revocation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    loadModules();
    withConfig();
  });

  test('cache TTL is configurable and still defaults to 5 minutes', () => {
    expect(policy.getCacheTtlMs()).toBe(0);

    withConfig({ enterprise_mcp_policy_cache_ttl_ms: '' });
    expect(policy.getCacheTtlMs()).toBe(300000);

    withConfig({ enterprise_mcp_policy_cache_ttl_ms: 'nonsense' });
    expect(policy.getCacheTtlMs()).toBe(300000);

    withConfig({ enterprise_mcp_policy_cache_ttl_ms: '1500' });
    expect(policy.getCacheTtlMs()).toBe(1500);
  });

  test('group removal denies the very next check when the TTL is 0', async () => {
    const r = req();
    pingOneUserService.makeRequest.mockResolvedValueOnce({ _embedded: { groups: [{ name: 'banking-agents' }] } });
    expect((await policy.checkPolicy(r)).allowed).toBe(true);

    pingOneUserService.makeRequest.mockResolvedValueOnce({ _embedded: { groups: [] } });
    const after = await policy.checkPolicy(r);
    expect(after.allowed).toBe(false);
    expect(after.code).toBe('enterprise_mcp_policy_denied');
  });

  test('the cache still shields repeat checks when a TTL is set', async () => {
    withConfig({ enterprise_mcp_policy_cache_ttl_ms: '300000' });
    const r = req();
    pingOneUserService.makeRequest.mockResolvedValueOnce({ _embedded: { groups: [{ name: 'banking-agents' }] } });
    expect((await policy.checkPolicy(r)).allowed).toBe(true);

    pingOneUserService.makeRequest.mockResolvedValueOnce({ _embedded: { groups: [] } });
    expect((await policy.checkPolicy(r)).allowed).toBe(true);
    expect(pingOneUserService.makeRequest).toHaveBeenCalledTimes(1);
  });

  test('a DENY revokes an MCP access token the session still holds', async () => {
    axios.post.mockResolvedValue({ data: {} });
    pingOneUserService.makeRequest.mockResolvedValue({ _embedded: { groups: [] } });
    const r = req({ mcpAccessToken: 'mcp.access.token' });

    await policy.checkPolicy(r);

    expect(axios.post).toHaveBeenCalled();
    const [url, body] = axios.post.mock.calls[0];
    expect(url).toContain('/revoke');
    expect(new URLSearchParams(body).get('token')).toBe('mcp.access.token');
    expect(r.session.mcpAccessToken).toBeNull();
  });

  test('a PERMIT never revokes anything', async () => {
    pingOneUserService.makeRequest.mockResolvedValue({ _embedded: { groups: [{ name: 'banking-agents' }] } });
    const r = req({ mcpAccessToken: 'mcp.access.token' });

    await policy.checkPolicy(r);

    expect(axios.post).not.toHaveBeenCalled();
    expect(r.session.mcpAccessToken).toBe('mcp.access.token');
  });

  test('a revoke endpoint failure still denies — best effort, fail closed', async () => {
    axios.post.mockRejectedValue(new Error('connection refused'));
    pingOneUserService.makeRequest.mockResolvedValue({ _embedded: { groups: [] } });
    const r = req({ mcpAccessToken: 'mcp.access.token' });

    const result = await policy.checkPolicy(r);

    expect(result.allowed).toBe(false);
    expect(result.code).toBe('enterprise_mcp_policy_denied');
  });

  test('no held token means no revoke call', async () => {
    pingOneUserService.makeRequest.mockResolvedValue({ _embedded: { groups: [] } });
    await policy.checkPolicy(req());
    expect(axios.post).not.toHaveBeenCalled();
  });
});
