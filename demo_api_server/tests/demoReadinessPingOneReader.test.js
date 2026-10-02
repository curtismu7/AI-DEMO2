'use strict';

const { createPingOneReader } = require('../services/demoReadinessPingOneReader');

const ENV = {
  PINGONE_ENVIRONMENT_ID: 'env-1',
  PINGONE_WORKER_CLIENT_ID: 'worker-id',
  PINGONE_WORKER_CLIENT_SECRET: 'worker-secret',
  PINGONE_AUTHORIZE_DECISION_ENDPOINT_ID: 'endpoint-1',
};
const MANIFEST = {
  provisioning: { resourceNames: { 'Super API': 'Demo API' }, appNames: { 'Super App': 'Demo App' } },
  resources: {
    'Super API': { uri: 'api.example.test', scopes: ['read', 'write'] },
    'Super Gateway': { uri: 'gw.example.test', scopes: ['invoke'], mirroredScopes: ['read'] },
  },
  apps: { 'Super App': { grantedScopes: ['read', 'invoke'] } },
};
const BASE = 'https://api.pingone.com/v1/environments/env-1';

// A live environment that matches MANIFEST; each test overrides one part.
function live(overrides = {}) {
  return {
    resources: [
      { id: 'res-api', name: 'Demo API', audience: 'api.example.test' },
      { id: 'res-gw', name: 'Super Gateway', audience: 'gw.example.test' },
      { id: 'res-other', name: 'Unrelated', audience: 'other.example.test' },
    ],
    scopes: {
      'res-api': [{ id: 's-read', name: 'read' }, { id: 's-write', name: 'write' }],
      'res-gw': [{ id: 's-invoke', name: 'invoke' }, { id: 's-gw-read', name: 'read' }],
    },
    applications: [{ id: 'app-1', name: 'Demo App' }, { id: 'app-2', name: 'Unrelated App' }],
    grants: { 'app-1': [
      { resource: { id: 'res-api' }, scopes: [{ id: 's-read' }] },
      { resource: { id: 'res-gw' }, scopes: [{ id: 's-invoke' }] },
    ] },
    decisionEndpoints: [{ id: 'endpoint-1' }],
    groups: [{ id: 'g-1', name: 'Demo_PremiumTier' }, { id: 'g-2', name: 'Unrelated_Group' }],
    ...overrides,
  };
}

function fakeFetch(state, calls = []) {
  const json = (body, ok = true, statusCode = 200) => ({ ok, status: statusCode, json: async () => body });
  return async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/as/token')) return json({ access_token: 'mgmt-token' });
    const path = url.slice(BASE.length).split('?')[0];
    let match;
    if (path === '/resources') return json({ _embedded: { resources: state.resources } });
    if (path === '/applications') return json({ _embedded: { applications: state.applications } });
    if (path === '/decisionEndpoints') return json({ _embedded: { decisionEndpoints: state.decisionEndpoints } });
    if (path === '/groups') return json({ _embedded: { groups: state.groups } });
    if ((match = path.match(/^\/resources\/([^/]+)\/scopes$/))) return json({ _embedded: { scopes: state.scopes[match[1]] || [] } });
    if ((match = path.match(/^\/applications\/([^/]+)\/grants$/))) return json({ _embedded: { grants: state.grants[match[1]] || [] } });
    return json({}, false, 404);
  };
}

const read = (state, env = ENV, calls, groupNames = ['Demo_PremiumTier']) => createPingOneReader({
  env, manifest: MANIFEST, groupNames, fetchImpl: fakeFetch(state, calls),
})({ targetId: 'local' });

describe('demoReadinessPingOneReader', () => {
  it('passes the live-readable families when PingOne matches the topology, ignoring unrelated objects', async () => {
    const values = await read(live());
    for (const name of ['audience', 'scope', 'mirror', 'appGrant', 'authorizeEndpoint', 'groupMembership']) {
      expect(values[name]).toMatchObject({ status: 'pass' });
    }
  });

  it('fails groupMembership when a declared group does not exist, and blocks when none is declared', async () => {
    expect((await read(live({ groups: [] }))).groupMembership).toEqual({ status: 'fail', observed: { declared: 1, missing: ['Demo_PremiumTier'] } });
    expect((await read(live(), ENV, undefined, [])).groupMembership.status).toBe('blocked');
  });

  it('declares the group names from the vertical manifests by default', async () => {
    const values = await createPingOneReader({ env: ENV, manifest: MANIFEST, fetchImpl: fakeFetch(live()) })({ targetId: 'local' });
    expect(values.groupMembership.status).toBe('fail');
    expect(values.groupMembership.observed.declared).toBeGreaterThan(1);
    expect(values.groupMembership.observed.missing).toContain('Banking_PremiumTier');
  });

  it('only reads: one token POST, every other call a GET with the bearer token', async () => {
    const calls = [];
    await read(live(), ENV, calls);
    const writes = calls.filter(({ options }) => (options.method || 'GET') !== 'GET');
    expect(writes).toHaveLength(1);
    expect(writes[0].url).toBe('https://auth.pingone.com/env-1/as/token');
    for (const { url, options } of calls.filter(({ url }) => url.startsWith(BASE))) {
      expect(options.headers.Authorization).toBe('Bearer mgmt-token');
      expect(url.startsWith(BASE + '/')).toBe(true);
    }
  });

  it('fails scope with a repair candidate when a native scope is missing', async () => {
    const state = live();
    state.scopes['res-api'] = [{ id: 's-read', name: 'read' }];
    const values = await read(state);
    expect(values.scope.status).toBe('fail');
    expect(values.scope.repairCandidates).toEqual([expect.objectContaining({
      repairClass: 'pingone-scope-addition', target: 'local',
      object: { id: 'res-api', kind: 'pingone-resource-scopes', missingScopes: ['write'] },
    })]);
    expect(values.mirror.status).toBe('pass');
  });

  it('fails mirror, not scope, when only a mirrored scope is missing', async () => {
    const state = live();
    state.scopes['res-gw'] = [{ id: 's-invoke', name: 'invoke' }];
    const values = await read(state);
    expect(values.mirror.status).toBe('fail');
    expect(values.scope.status).toBe('pass');
  });

  it('fails appGrant with a repair candidate when a required grant is missing', async () => {
    const state = live();
    state.grants['app-1'] = [{ resource: { id: 'res-api' }, scopes: [{ id: 's-read' }] }];
    const values = await read(state);
    expect(values.appGrant.status).toBe('fail');
    expect(values.appGrant.repairCandidates).toEqual([expect.objectContaining({
      repairClass: 'pingone-app-scope-grant',
      object: { id: 'app-1', kind: 'pingone-application-grants', missingScopes: ['invoke'] },
    })]);
  });

  it('fails audience when a resource is missing or carries a different audience', async () => {
    const state = live();
    state.resources[0].audience = 'wrong.example.test';
    expect((await read(state)).audience).toMatchObject({ status: 'fail', observed: { mismatched: ['Super API'] } });
    expect((await read(live({ resources: [] }))).audience).toMatchObject({ status: 'fail', observed: { missing: ['Super API', 'Super Gateway'] } });
  });

  it('fails authorizeEndpoint when a configured decision endpoint is not live, and blocks when none is configured', async () => {
    expect((await read(live({ decisionEndpoints: [] }))).authorizeEndpoint.status).toBe('fail');
    const { PINGONE_AUTHORIZE_DECISION_ENDPOINT_ID, ...noEndpoint } = ENV;
    expect((await read(live(), noEndpoint)).authorizeEndpoint.status).toBe('blocked');
  });

  it('rejects when management credentials are missing, naming no values', async () => {
    const { PINGONE_WORKER_CLIENT_SECRET, ...noSecret } = ENV;
    await expect(read(live(), noSecret)).rejects.toThrow('PingOne Management API credentials are unavailable');
  });

  it('never returns the token or the client secret', async () => {
    const state = live();
    state.scopes['res-api'] = [];
    const serialized = JSON.stringify(await read(state));
    expect(serialized).not.toContain('mgmt-token');
    expect(serialized).not.toContain('worker-secret');
  });
});
