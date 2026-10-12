'use strict';
// Bootstrap must mirror the live hosted-access config. Pin the exact shapes:
// groups created by name, claim mapping value literal, app config fields.

const HOSTED_APP_CONFIG = {
  name: 'Hosted Access Sign-In',
  type: 'WEB_APP',
  protocol: 'OPENID_CONNECT',
  grantTypes: ['AUTHORIZATION_CODE'],
  responseTypes: ['CODE'],
  tokenEndpointAuthMethod: 'NONE',
  pkceEnforcement: 'S256_REQUIRED',
};

jest.mock('../services/scopeTopology', () => ({
  _manifest: () => ({ provisioning: { resourceNames: {}, appNames: {} } }),
  resourceScopes: () => [],
  appGrantedScopes: () => [],
}));

const { PingOneProvisionService } = require('../services/pingoneProvisionService');

const APP_ID = 'app-hosted-1';
const CLIENT_ID = 'hosted-client-id-1';
const USER_GROUP_ID = 'grp-hosted-complete';
const PARTIAL_GROUP_ID = 'grp-hosted-pending';

/**
 * Build a prototype-instance service with makeRequest routed on URL + method.
 * `routes` is a list of { match: RegExp | string(url prefix), method?, handler }.
 * The first matching route (in list order) handles the call; the default
 * handler returns an empty _embedded collection so an unexpected GET never
 * crashes a test focused on POST bodies.
 */
function makeService(routes = []) {
  const svc = Object.create(PingOneProvisionService.prototype);
  svc.makeRequest = jest.fn(async (method, endpoint, body) => {
    for (const route of routes) {
      const methods = Array.isArray(route.method) ? route.method : [route.method || 'GET'];
      const urlMatch =
        typeof route.match === 'string' ? endpoint.startsWith(route.match) : route.match.test(endpoint);
      if (urlMatch && methods.includes(method)) {
        return route.handler({ endpoint, method, body });
      }
    }
    if (method === 'GET') {
      const coll = /\/groups/.test(endpoint)
        ? 'groups'
        : /\/attributes/.test(endpoint)
          ? 'attributes'
          : 'applications';
      return { data: { _embedded: { [coll]: [] } } };
    }
    throw new Error(`unexpected ${method} ${endpoint} body=${JSON.stringify(body || null)}`);
  });
  return svc;
}

// Handlers for the happy paths every test shares.
const listAppFound = () => ({ data: { _embedded: { applications: [{ id: APP_ID, name: 'Hosted Access Sign-In', clientId: CLIENT_ID }] } } });
const listAppEmpty = () => ({ data: { _embedded: { applications: [] } } });
const createApp = () => ({ data: { id: APP_ID, name: 'Hosted Access Sign-In', clientId: CLIENT_ID } });
const listGroupsEmpty = () => ({ data: { _embedded: { groups: [] } } });
const createGroup = (id) => ({ data: { id } });
const listAttrsEmpty = () => ({ data: { _embedded: { attributes: [] } } });
const createAttr = () => ({ data: { id: 'attr-1' } });

const alreadyExistsErr = () => {
  const err = new Error("POST /applications/app-hosted-1/attributes failed — HTTP 400 — mapping 'groups' already exists");
  err.response = { status: 400, data: { code: 'INVALID_DATA', message: "mapping 'groups' already exists" } };
  return err;
};

describe('provision hosted-access phase', () => {
  test('groups ensured by name, ids returned', async () => {
    const svc = makeService([
      { match: /^\/applications\?/, handler: listAppFound },
      { match: '/groups', method: 'GET', handler: listGroupsEmpty },
      { match: '/groups', method: 'POST', handler: ({ body }) => createGroup(body.name === 'Hosted Registration Complete' ? USER_GROUP_ID : PARTIAL_GROUP_ID) },
      { match: /\/attributes/, handler: listAttrsEmpty },
      { match: /\/attributes$/, method: 'POST', handler: createAttr },
    ]);

    const groups = await svc._ensureHostedAccessGroups();

    expect(groups).toEqual({ userGroupId: USER_GROUP_ID, partialGroupId: PARTIAL_GROUP_ID });
    const groupPosts = svc.makeRequest.mock.calls.filter(([m, u]) => m === 'POST' && u === '/groups');
    expect(groupPosts).toHaveLength(2);
    const groupGets = svc.makeRequest.mock.calls.filter(([m, u]) => m === 'GET' && u === '/groups?filter=name eq "Hosted Registration Complete"');
    expect(groupGets).toHaveLength(1);
    const descriptions = groupPosts.map(([, , body]) => body.description);
    expect(descriptions).toEqual([
      'Users approved for hosted application access',
      'Users with pending hosted-access registration',
    ]);
    const names = groupPosts.map(([, , body]) => body.name);
    expect(names).toEqual(['Hosted Registration Complete', 'Hosted Registration Pending']);
  });

  test('claim mapping POSTed with the exact live value', async () => {
    // POST /applications/{id}/attributes body must deep-contain:
    // { name: 'groups', value: '${user.memberOfGroupIDs}', idToken: true, userInfo: true }
    // and idempotency: a 400 INVALID_DATA containing 'already exists' is treated as exists-success.
    const svc = makeService([
      { match: /\/attributes$/, method: 'POST', handler: () => { throw alreadyExistsErr(); } },
      { match: /\/attributes/, handler: listAttrsEmpty },
    ]);

    const result = await svc._ensureGroupsClaim(APP_ID);

    expect(result).toEqual({ mapped: true, corrected: false });
    const post = svc.makeRequest.mock.calls.find(([m, u]) => m === 'POST' && u === `/applications/${APP_ID}/attributes`);
    expect(post).toBeTruthy();
    expect(post[2]).toEqual(expect.objectContaining({
      name: 'groups',
      value: '${user.memberOfGroupIDs}',
      idToken: true,
      userInfo: true,
    }));
  });

  test('claim mapping corrects a drifted value via PUT', async () => {
    const svc = makeService([
      { match: /\/attributes$/, method: 'GET', handler: () => ({ data: { _embedded: { attributes: [{ id: 'attr-live', name: 'groups', value: 'wrong-value' }] } } }) },
      { match: /\/attributes\/attr-live$/, method: 'PUT', handler: () => ({ data: {} }) },
    ]);

    const result = await svc._ensureGroupsClaim(APP_ID);

    expect(result).toEqual({ mapped: true, corrected: true });
    const put = svc.makeRequest.mock.calls.find(([m, u]) => m === 'PUT' && u === `/applications/${APP_ID}/attributes/attr-live`);
    expect(put[2]).toEqual(expect.objectContaining({ name: 'groups', value: '${user.memberOfGroupIDs}' }));
  });

  test('claim mapping throws on a non-already-exists 400', async () => {
    // Real makeRequest folds the PingOne detail message into err.message.
    const err = new Error('POST /applications/app-hosted-1/attributes failed — HTTP 400 — something else is wrong');
    err.response = { status: 400, data: { code: 'INVALID_DATA', message: 'something else is wrong' } };
    const svc = makeService([
      { match: /\/attributes$/, method: 'POST', handler: () => { throw err; } },
      { match: /\/attributes/, handler: listAttrsEmpty },
    ]);

    await expect(svc._ensureGroupsClaim(APP_ID)).rejects.toThrow('something else is wrong');
  });

  test('app creation body matches the live hosted app config', async () => {
    // POST /applications body deep-contains HOSTED_APP_CONFIG above + redirectUris: [PUBLIC_APP_URL + '/api/auth/hosted-access/callback']
    const PUBLIC_APP_URL = 'https://ai-demo.ping-devops.com';
    const svc = makeService([
      { match: /^\/applications\?/, handler: listAppEmpty },
      { match: '/applications', method: 'POST', handler: createApp },
      { match: '/groups', method: 'GET', handler: listGroupsEmpty },
      { match: '/groups', method: 'POST', handler: ({ body }) => createGroup(body.name === 'Hosted Registration Complete' ? USER_GROUP_ID : PARTIAL_GROUP_ID) },
      { match: /\/attributes$/, handler: listAttrsEmpty },
      { match: /\/attributes$/, method: 'POST', handler: createAttr },
    ]);

    const result = await svc._ensureHostedAccessApp(PUBLIC_APP_URL);

    expect(result.exists).toBe(false);
    expect(result.application).toEqual(expect.objectContaining({ id: APP_ID, clientId: CLIENT_ID }));
    const post = svc.makeRequest.mock.calls.find(([m, u]) => m === 'POST' && u === '/applications');
    expect(post).toBeTruthy();
    expect(post[2]).toEqual(expect.objectContaining({
      ...HOSTED_APP_CONFIG,
      redirectUris: [`${PUBLIC_APP_URL}/api/auth/hosted-access/callback`],
    }));
  });

  test('app creation reuses the existing app by exact name', async () => {
    const svc = makeService([
      { match: /^\/applications\?/, handler: listAppFound },
    ]);

    const result = await svc._ensureHostedAccessApp('https://ai-demo.ping-devops.com');

    expect(result).toEqual({ application: expect.objectContaining({ id: APP_ID, clientId: CLIENT_ID }), exists: true });
    expect(svc.makeRequest.mock.calls.filter(([m, u]) => m === 'POST' && u === '/applications')).toHaveLength(0);
  });

  test('run-twice idempotence: second run performs zero creates', async () => {
    // Second call sees exists-results for every object, no POST thrown.
    const routesForRun = (run) => [
      {
        match: /^\/applications\?/,
        handler: run === 1
          ? listAppEmpty
          : listAppFound,
      },
      { match: '/applications', method: 'POST', handler: createApp },
      {
        // Mirror _ensureGroup's filtered lookup: honor the filter=name eq "X"
        // query, otherwise the second ensure sees the wrong group.
        match: '/groups',
        method: 'GET',
        handler: ({ endpoint }) => {
          const nameMatch = endpoint.match(/filter=name eq "([^"]+)"/);
          const wanted = nameMatch ? nameMatch[1] : null;
          const all = run === 1 ? [] : [
            { id: USER_GROUP_ID, name: 'Hosted Registration Complete' },
            { id: PARTIAL_GROUP_ID, name: 'Hosted Registration Pending' },
          ];
          return { data: { _embedded: { groups: all.filter((g) => !wanted || g.name === wanted) } } };
        },
      },
      { match: '/groups', method: 'POST', handler: ({ body }) => createGroup(body.name === 'Hosted Registration Complete' ? USER_GROUP_ID : PARTIAL_GROUP_ID) },
      {
        match: /\/attributes$/,
        method: 'GET',
        handler: () => ({ data: { _embedded: { attributes: run === 1 ? [] : [{ id: 'attr-1', name: 'groups', value: '${user.memberOfGroupIDs}' }] } } }),
      },
      { match: /\/attributes$/, method: 'POST', handler: createAttr },
    ];

    const run1 = makeService(routesForRun(1));
    const app1 = await run1._ensureHostedAccessApp('https://ai-demo.ping-devops.com');
    const groups1 = await run1._ensureHostedAccessGroups();
    const claim1 = await run1._ensureGroupsClaim(app1.application.id);

    const run2 = makeService(routesForRun(2));
    const app2 = await run2._ensureHostedAccessApp('https://ai-demo.ping-devops.com');
    const groups2 = await run2._ensureHostedAccessGroups();
    const claim2 = await run2._ensureGroupsClaim(app2.application.id);

    expect(app1.exists).toBe(false);
    expect(app2.exists).toBe(true);
    expect(app2.application.id).toBe(APP_ID);
    expect(groups2).toEqual(groups1);
    expect(claim1).toEqual({ mapped: true, corrected: false });
    expect(claim2).toEqual({ mapped: true, corrected: false });
    const run2Creates = run2.makeRequest.mock.calls.filter(([m]) => m === 'POST');
    expect(run2Creates).toHaveLength(0);
  });
});
