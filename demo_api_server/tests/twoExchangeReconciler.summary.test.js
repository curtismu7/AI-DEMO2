'use strict';

/**
 * The reconciler try/catches every check so one PingOne hiccup cannot take the
 * BFF's boot with it. That made its summary a liar: a failed check leaves its
 * result at the empty default, which is indistinguishable from "nothing needed
 * doing", so a run with two failed PingOne calls still ended on
 *   OK — Exchange #1, #2, and #3 scopes and grants match scope-topology.json
 * These tests pin both directions: a failure must report INCOMPLETE and must
 * NOT report OK; a clean run must still report OK.
 */

jest.mock('axios');
jest.mock('../services/configStore', () => ({ getEffective: () => undefined }));
jest.mock('../services/scopeTopology', () => ({
  // Empty expectations: nothing is ever missing, so the summary's create/add
  // totals stay 0 and the only thing under test is failure reporting.
  resourceScopes: () => [],
  scopeMeta: () => null,
  resourceUri: (name) => `${name}-aud`,
  provisionedResourceName: (name) => name,
}));

const axios = require('axios');
const { reconcileTwoExchangeGrants } = require('../services/twoExchangeReconciler');

const RESOURCES = [
  'Super Banking Agent Gateway',
  'Super Banking MCP Gateway',
  'Super Banking MCP Server',
  'Super Banking MCP Invest',
  'Super Banking MCP JWT Verifier',
].map((name, i) => ({ id: `res-${i}`, audience: `${name}-aud` }));

/** @param {{failExchangerLookup?: boolean}} opts */
function wireAxios(opts = {}) {
  axios.post.mockImplementation(async (url) => {
    if (String(url).includes('/as/token')) return { data: { access_token: 'worker-token' } };
    return { data: {} };
  });
  axios.put.mockResolvedValue({ data: {} });
  axios.get.mockImplementation(async (url) => {
    const u = String(url);
    if (u.includes('/resources?')) return { data: { _embedded: { resources: RESOURCES } } };
    if (/\/resources\/[^/]+\/scopes/.test(u)) return { data: { _embedded: { scopes: [] } } };
    if (u.includes('/grants')) return { data: { _embedded: { grants: [] } } };
    if (u.includes('/applications/')) {
      if (opts.failExchangerLookup && u.includes('exchanger-client')) {
        throw new Error('Request failed with status code 400');
      }
      return { data: { id: 'app-id' } };
    }
    return { data: {} };
  });
}

describe('twoExchangeReconciler summary', () => {
  const ENV = { ...process.env };
  let logs;
  let warns;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PINGONE_ENVIRONMENT_ID = 'env-1';
    process.env.PINGONE_REGION = 'com';
    process.env.PINGONE_WORKER_CLIENT_ID = 'worker-client';
    process.env.PINGONE_WORKER_CLIENT_SECRET = 'worker-secret';
    process.env.PINGONE_AI_AGENT_CLIENT_ID = 'ai-agent-client';
    process.env.PINGONE_TOKEN_EXCHANGER_CLIENT_ID = 'exchanger-client';
    process.env.PINGONE_MCP_GATEWAY_CLIENT_ID = 'gateway-client';
    logs = jest.spyOn(console, 'log').mockImplementation(() => {});
    warns = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    logs.mockRestore();
    warns.mockRestore();
    process.env = { ...ENV };
  });

  const joined = (spy) => spy.mock.calls.map((c) => c.join(' ')).join('\n');

  test('a failed check reports INCOMPLETE and never claims the state matches', async () => {
    wireAxios({ failExchangerLookup: true });

    await reconcileTwoExchangeGrants();

    const warned = joined(warns);
    expect(warned).toMatch(/INCOMPLETE — 1 check\(s\) failed/);
    expect(warned).toContain('resolve MCP Exchanger app');
    expect(warned).toContain('NOT verified against scope-topology.json');
    // The regression: this line used to print even though a check had failed.
    expect(joined(logs)).not.toContain('OK — Exchange #1, #2, and #3');
  });

  test('a clean run still reports OK', async () => {
    wireAxios();

    await reconcileTwoExchangeGrants();

    expect(joined(logs)).toContain('OK — Exchange #1, #2, and #3 scopes and grants match');
    expect(joined(warns)).not.toContain('INCOMPLETE');
  });
});
