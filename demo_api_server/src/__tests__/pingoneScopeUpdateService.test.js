/**
 * Unit tests for PingOneScopeUpdateService.fixScopeConfiguration.
 * Verifies SSOT add-only behavior — never deletes agent:invoke.
 */

jest.mock('axios', () => ({ post: jest.fn(), get: jest.fn(), delete: jest.fn() }));

jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn((key) => {
    const map = {
      pingone_worker_client_id: 'worker-id',
      pingone_authorize_worker_client_secret: 'worker-secret',
      pingone_audience_enduser: 'api.ping.demo',
      pingone_resource_agent_gateway_uri: 'agentgateway.ping.demo',
      pingone_resource_mcp_server_uri: 'mcpserver.ping.demo',
    };
    return map[key] || null;
  }),
}));

const PingOneScopeUpdateService = require('../../services/pingoneScopeUpdateService');
const { findResourceForTarget } = PingOneScopeUpdateService;

describe('PingOneScopeUpdateService.fixScopeConfiguration', () => {
  it('findResourceForTarget matches by audience first', () => {
    const resources = [
      { id: '1', name: 'Wrong', audience: 'other' },
      { id: '2', name: 'Demo API', audience: 'api.ping.demo' },
    ];
    const found = findResourceForTarget(resources, {
      key: 'api',
      label: 'Demo API',
      audience: 'api.ping.demo',
    });
    expect(found.id).toBe('2');
  });

  it('adds only missing scopes and never deletes', async () => {
    const service = new PingOneScopeUpdateService();
    service.envId = 'env-1';
    service.region = 'com';
    service.workerToken = 'tok';
    service.tokenCache = { token: 'tok', expiresAt: Date.now() + 60_000, ttl: 60_000 };
    service.baseURL = 'https://api.pingone.com/env-1';

    const created = [];
    service.makeRequest = jest.fn(async (method, endpoint) => {
      if (method === 'GET' && endpoint === '/resources') {
        return {
          data: {
            _embedded: {
              resources: [
                { id: 'rs-api', name: 'Demo API', audience: 'api.ping.demo' },
                { id: 'rs-gw', name: 'Demo Agent Gateway', audience: 'agentgateway.ping.demo' },
                { id: 'rs-mcp', name: 'Demo MCP Server', audience: 'mcpserver.ping.demo' },
              ],
            },
          },
        };
      }
      throw new Error(`unexpected ${method} ${endpoint}`);
    });
    service.getResourceScopes = jest.fn(async (resourceId) => {
      if (resourceId === 'rs-api') return [{ name: 'read' }, { name: 'write' }];
      if (resourceId === 'rs-gw') return [{ name: 'agent:invoke' }];
      return [{ name: 'mcp:invoke' }];
    });
    service.createScope = jest.fn(async (_id, scopeName) => {
      created.push(scopeName);
      return { success: true, scopeName, message: `Created scope '${scopeName}'` };
    });
    service.deleteScope = jest.fn();

    const result = await service.fixScopeConfiguration();

    expect(result.success).toBe(true);
    expect(service.deleteScope).not.toHaveBeenCalled();
    expect(created).not.toContain('agent:invoke');
    expect(created.length).toBeGreaterThan(0);
    expect(result.summary).toMatch(/Added \d+ missing PingOne scope/);
    expect(result.steps.some((s) => /adding \d+ missing scope/.test(s.message))).toBe(true);
  });

  it('reports success when every expected scope is already present', async () => {
    const service = new PingOneScopeUpdateService();
    service.envId = 'env-1';
    service.region = 'com';
    service.workerToken = 'tok';
    service.tokenCache = { token: 'tok', expiresAt: Date.now() + 60_000, ttl: 60_000 };
    service.baseURL = 'https://api.pingone.com/env-1';

    const scopeTopology = require('../../services/scopeTopology');
    const apiScopes = scopeTopology.resourceScopes('Super Banking API');
    const gwScopes = scopeTopology.resourceScopes('Super Banking Agent Gateway');
    const mcpScopes = scopeTopology.resourceScopes('Super Banking MCP Server');

    service.makeRequest = jest.fn(async () => ({
      data: {
        _embedded: {
          resources: [
            { id: 'rs-api', name: 'Demo API', audience: 'api.ping.demo' },
            { id: 'rs-gw', name: 'Demo Agent Gateway', audience: 'agentgateway.ping.demo' },
            { id: 'rs-mcp', name: 'Demo MCP Server', audience: 'mcpserver.ping.demo' },
          ],
        },
      },
    }));
    service.getResourceScopes = jest.fn(async (resourceId) => {
      const map = {
        'rs-api': apiScopes,
        'rs-gw': gwScopes,
        'rs-mcp': mcpScopes,
      };
      return (map[resourceId] || []).map((name) => ({ name }));
    });
    service.createScope = jest.fn();
    service.deleteScope = jest.fn();

    const result = await service.fixScopeConfiguration();

    expect(result.success).toBe(true);
    expect(service.createScope).not.toHaveBeenCalled();
    expect(service.deleteScope).not.toHaveBeenCalled();
    expect(result.summary).toBe('✅ All expected PingOne scopes already present');
  });
});
