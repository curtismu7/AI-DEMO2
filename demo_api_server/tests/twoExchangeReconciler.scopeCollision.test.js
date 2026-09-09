'use strict';

/**
 * PingOne rejects a grant PUT whose scope NAMES collide with names the same app
 * already holds on another resource's grant:
 *   INVALID_DATA — "Multiple scopes with the same name cannot be added to the
 *   same grant"
 * One colliding name therefore costs every other name in the same request. The
 * live environment had the gateway app holding airlines:read / airlines:write /
 * pnr:read on the MCP Invest grant, so the MCP Server reconcile 400'd on every
 * boot and added nothing at all.
 *
 * The reconciler now treats a name held elsewhere as satisfied-elsewhere and
 * sends only the rest.
 */

jest.mock('axios');
jest.mock('../services/configStore', () => ({ getEffective: () => undefined }));

const SERVER_SCOPES = ['read', 'airlines:read'];
jest.mock('../services/scopeTopology', () => ({
  resourceScopes: (name) => (name === 'Super Banking MCP Server' ? ['read', 'airlines:read'] : []),
  scopeMeta: () => null,
  resourceUri: (name) => `${name}-aud`,
  provisionedResourceName: (name) => name,
}));

const axios = require('axios');
const { reconcileTwoExchangeGrants } = require('../services/twoExchangeReconciler');

const SERVER_RES = { id: 'res-server', audience: 'Super Banking MCP Server-aud' };
const INVEST_RES = { id: 'res-invest', audience: 'Super Banking MCP Invest-aud' };
const RESOURCES = [
  { id: 'res-agentgw', audience: 'Super Banking Agent Gateway-aud' },
  { id: 'res-mcpgw', audience: 'Super Banking MCP Gateway-aud' },
  SERVER_RES,
  INVEST_RES,
  { id: 'res-jwt', audience: 'Super Banking MCP JWT Verifier-aud' },
];

// The MCP Server resource defines both names; the app already holds
// `airlines:read` (by a DIFFERENT scope id) on the MCP Invest grant.
const SCOPES_BY_RESOURCE = {
  'res-server': [{ id: 'sc-read', name: 'read' }, { id: 'sc-air-server', name: 'airlines:read' }],
  'res-invest': [{ id: 'sc-air-invest', name: 'airlines:read' }],
};

describe('twoExchangeReconciler scope-name collisions', () => {
  const ENV = { ...process.env };
  let logs;

  beforeEach(() => {
    jest.clearAllMocks();
    Object.assign(process.env, {
      PINGONE_ENVIRONMENT_ID: 'env-1',
      PINGONE_REGION: 'com',
      PINGONE_WORKER_CLIENT_ID: 'worker-client',
      PINGONE_WORKER_CLIENT_SECRET: 'worker-secret',
      PINGONE_AI_AGENT_CLIENT_ID: 'ai-agent-client',
      PINGONE_MCP_GATEWAY_CLIENT_ID: 'gateway-client',
    });
    delete process.env.PINGONE_TOKEN_EXCHANGER_CLIENT_ID;
    delete process.env.PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID;
    logs = jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    axios.post.mockImplementation(async (url) => (
      String(url).includes('/as/token') ? { data: { access_token: 't' } } : { data: {} }
    ));
    axios.put.mockResolvedValue({ data: {} });
    axios.get.mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('/resources?')) return { data: { _embedded: { resources: RESOURCES } } };
      const m = u.match(/\/resources\/([^/]+)\/scopes/);
      if (m) return { data: { _embedded: { scopes: SCOPES_BY_RESOURCE[m[1]] || [] } } };
      if (u.includes('/grants')) {
        return { data: { _embedded: { grants: [
          { id: 'grant-invest', resource: { id: 'res-invest' }, scopes: [{ id: 'sc-air-invest' }] },
        ] } } };
      }
      if (u.includes('/applications/')) return { data: { id: 'app-id' } };
      return { data: {} };
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env = { ...ENV };
  });

  test('sends the non-colliding scopes instead of losing the whole request to a 400', async () => {
    await reconcileTwoExchangeGrants();

    const serverPut = axios.post.mock.calls.find(
      ([url, body]) => String(url).includes('/grants') && body?.resource?.id === 'res-server'
    );
    expect(serverPut).toBeDefined();
    const sentIds = serverPut[1].scopes.map((s) => s.id);
    // `read` still goes through...
    expect(sentIds).toContain('sc-read');
    // ...and the name already held on the MCP Invest grant is left where it is,
    // rather than poisoning the request PingOne would have rejected outright.
    expect(sentIds).not.toContain('sc-air-server');

    expect(logs.mock.calls.map((c) => c.join(' ')).join('\n'))
      .toMatch(/already granted to this app on another resource.*airlines:read/);
  });
});
