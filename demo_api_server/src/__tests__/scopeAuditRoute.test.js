/**
 * Tests for routes/scopeAudit.js — GET /resources expected-scope derivation.
 *
 * Uses the REAL scope-topology.json (no scopeTopology mock) so these tests
 * fail if the route ever drifts from the SoT again. Only PingOne HTTP and
 * config are mocked.
 */

const express = require('express');
const request = require('supertest');
const axios = require('axios');
const scopeTopology = require('../../services/scopeTopology');
const configStore = require('../../services/configStore');

jest.mock('axios');
jest.mock('../../services/configStore');
jest.mock('../../services/pingOneClientService', () => ({
  getManagementToken: jest.fn().mockResolvedValue('mock-bearer-token'),
}));

const scopeAuditRouter = require('../../routes/scopeAudit');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/scope-audit', scopeAuditRouter);
  return app;
}

/** Mock the two PingOne Management API calls the route makes. */
function mockPingOne(resources, scopesByResourceId) {
  axios.get.mockImplementation((url) => {
    const scopesMatch = url.match(/\/resources\/([^/]+)\/scopes$/);
    if (scopesMatch) {
      const names = scopesByResourceId[scopesMatch[1]] || [];
      return Promise.resolve({
        data: { _embedded: { scopes: names.map((name, i) => ({ id: `s-${i}`, name })) } },
      });
    }
    return Promise.resolve({ data: { _embedded: { resources } } });
  });
}

describe('GET /api/admin/scope-audit/resources', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    configStore.getEffective.mockImplementation((key) => {
      const k = key.toLowerCase();
      if (k === 'pingone_environment_id') return 'env-123';
      if (k === 'pingone_region') return 'com';
      return null;
    });
  });

  it('matches provisioned "Demo API" name and derives expected scopes from the topology', async () => {
    const expectedScopes = scopeTopology.resourceScopes('Super Banking API');
    mockPingOne(
      [{ id: 'r1', name: 'Demo API', audience: 'enduser.ping.demo', type: 'CUSTOM' }],
      { r1: expectedScopes }
    );

    const res = await request(buildApp()).get('/api/admin/scope-audit/resources');

    expect(res.status).toBe(200);
    const [r] = res.body.resources;
    expect(r.expected).not.toBeNull();
    expect(r.expected.sotResource).toBe('Super Banking API');
    expect(r.expected.requiredScopes).toEqual(expectedScopes);
    expect(r.expected.missingRequired).toEqual([]);
    expect(r.expected.allRequiredPresent).toBe(true);
  });

  it('expected scopes track the SoT, not the retired hardcoded model', () => {
    const apiScopes = scopeTopology.resourceScopes('Super Banking API');
    // Scopes the old hardcoded table missed entirely
    expect(apiScopes).toEqual(expect.arrayContaining(['transfer', 'mortgage:read', 'admin:read']));
    // Scopes the old table expected but the SoT no longer defines
    expect(apiScopes).not.toContain('transfer:execute');
    expect(apiScopes).not.toContain('sensitive');
    // T-10: gateway expectations include mirrored exchange-hop scopes
    const gwScopes = scopeTopology.resourceScopes('Super Banking MCP Gateway');
    expect(gwScopes).toEqual(expect.arrayContaining(['mcp:invoke', 'read', 'write', 'transfer']));
  });

  it('matches by audience when the display name is unrecognized', async () => {
    mockPingOne(
      [{ id: 'r2', name: 'Renamed Gateway Thing', audience: 'mcpgateway.ping.demo', type: 'CUSTOM' }],
      { r2: ['mcp:invoke'] }
    );

    const res = await request(buildApp()).get('/api/admin/scope-audit/resources');

    const [r] = res.body.resources;
    expect(r.expected.sotResource).toBe('Super Banking MCP Gateway');
    expect(r.expected.requiredScopes).toEqual(scopeTopology.resourceScopes('Super Banking MCP Gateway'));
  });

  it('reports missing required scopes when PingOne has a partial set', async () => {
    mockPingOne(
      [{ id: 'r3', name: 'Demo Agent Gateway', audience: 'agentgateway.ping.demo', type: 'CUSTOM' }],
      { r3: [] }
    );

    const res = await request(buildApp()).get('/api/admin/scope-audit/resources');

    const [r] = res.body.resources;
    expect(r.expected.missingRequired).toEqual(scopeTopology.resourceScopes('Super Banking Agent Gateway'));
    expect(r.expected.allRequiredPresent).toBe(false);
  });

  it('returns expected: null for resources not modelled in the topology', async () => {
    mockPingOne(
      [{ id: 'r4', name: 'openid', audience: null, type: 'OPENID_CONNECT' }],
      { r4: ['openid', 'profile'] }
    );

    const res = await request(buildApp()).get('/api/admin/scope-audit/resources');

    const [r] = res.body.resources;
    expect(r.expected).toBeNull();
    expect(r.scopes.map((s) => s.name)).toEqual(['openid', 'profile']);
  });
});
