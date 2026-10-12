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
  // Agent Gateway list mirrors scope-topology.json's overlapping names
  // (read/write/transfer/mortgage:read also live on the enduser resource) —
  // required by the ai-agent grants-ordering test below.
  resourceScopes: jest.fn((name) => (name === 'Super Banking Agent Gateway'
    ? ['agent:invoke', 'read', 'write', 'transfer', 'mortgage:read']
    : [])),
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
      // PingOne 400s 'must not be null' without it (live 2026-10-12).
      description: 'Hosted Ping employee admission front door',
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

  test('generateEnvContent emits the hosted-access keys from provisioned.hostedAccess', () => {
    // REQUIRED_GROUP_ID must alias USER_GROUP_ID (same value, one line each).
    const svc = new PingOneProvisionService();
    const config = { envId: 'env-1', region: 'com', publicAppUrl: 'https://ai-demo.ping-devops.com' };
    const provisioned = {
      adminApp: { clientId: 'a', clientSecret: 's' },
      userApp: { clientId: 'u', clientSecret: 's' },
      resourceServer: { audience: ['enduser.ping.demo'] },
      mcpGwResourceServer: { audience: ['mcpgateway.ping.demo'] },
      demoUser: { password: 'p' },
      demoAdmin: { password: 'p' },
      hostedAccess: {
        appId: 'app-hosted-1',
        clientId: CLIENT_ID,
        userGroupId: USER_GROUP_ID,
        partialGroupId: PARTIAL_GROUP_ID,
        claimMapped: true,
      },
    };

    const text = svc.generateEnvContent(config, provisioned);

    for (const key of ['HOSTED_ACCESS_CLIENT_ID', 'HOSTED_ACCESS_USER_GROUP_ID', 'HOSTED_ACCESS_PARTIAL_GROUP_ID', 'HOSTED_ACCESS_REQUIRED_GROUP_ID', 'HOSTED_ACCESS_TOKEN_ENDPOINT_AUTH_METHOD', 'HOSTED_ACCESS_REDIRECT_URI']) {
      expect(text).toMatch(new RegExp(`^${key}=.`, 'm'));
    }
    expect(text).toMatch(new RegExp(`^HOSTED_ACCESS_CLIENT_ID=${CLIENT_ID}$`, 'm'));
    const req = text.match(/^HOSTED_ACCESS_REQUIRED_GROUP_ID=(.*)$/m);
    const usr = text.match(/^HOSTED_ACCESS_USER_GROUP_ID=(.*)$/m);
    expect(req[1]).toBe(usr[1]);
    expect(req[1]).toBe(USER_GROUP_ID);
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

describe('ai-agent overlapping grants', () => {
  const GW_RESOURCE = 'res-agent-gw';
  const ENDUSER_RESOURCE = 'res-enduser';
  const APP_ID = 'app-ai-agent';

  // Scope tables per resource — 'read'/'write'/'transfer'/'mortgage:read'
  // exist on BOTH, which is what makes the two grants collide when run
  // concurrently (each snapshots existingGrants before the other's POST).
  const gwScopes = ['agent:invoke', 'read', 'write', 'transfer', 'mortgage:read'];
  const enduserScopes = ['read', 'write', 'transfer', 'ai:agent:read', 'mortgage:read'];
  const scopeId = (resource, name) => `${resource}-${name}`;

  const scopeRows = (resource, names) => names.map((n) => ({ id: scopeId(resource, n), name: n }));

  /**
   * Stateful PingOne-grant simulation. Mirrors the real cross-resource rule
   * (grantScopesToApplication's own comment, lines ~1484-1520 of the service):
   * a POST containing a scope name already granted on a DIFFERENT resource of
   * the same app 400s 'Multiple scopes with the same name cannot be added to
   * the same grant'. Sequential-but-unfiltered still fails this unless the
   * second call's filter sees the first grant — exactly the property under
   * test.
   */
  function makeGrantService() {
    const svc = Object.create(PingOneProvisionService.prototype);
    const grants = []; // { resource: {id}, scopes: [{id}] }
    svc.makeRequest = jest.fn(async (method, endpoint, body) => {
      let m;
      if (method === 'GET' && (m = endpoint.match(/^\/resources\/([\w-]+)\/scopes$/))) {
        const names = m[1] === GW_RESOURCE ? gwScopes : enduserScopes;
        return { data: { _embedded: { scopes: scopeRows(m[1], names) } } };
      }
      if (method === 'GET' && endpoint === `/applications/${APP_ID}`) {
        return { data: { id: APP_ID, type: 'WEB_APP' } };
      }
      if (method === 'GET' && endpoint === `/applications/${APP_ID}/grants`) {
        return { data: { _embedded: { grants } } };
      }
      if (method === 'POST' && endpoint === `/applications/${APP_ID}/grants`) {
        const rid = body.resource.id;
        // 'res-x-<name>' ids may contain hyphens in <name> (e.g. ai:agent:read
        // has none, but the prefix is always 'res-<resource>-'); strip via the
        // known prefix instead of split('-').
        const nameOf = (id, resource) => id.slice(scopeId(resource, '').length);
        const incomingNames = body.scopes.map((s) => nameOf(s.id, rid));
        const otherNames = new Set(
          grants.filter((g) => g.resource.id !== rid).flatMap((g) => g.scopes.map((s) => nameOf(s.id, g.resource.id)))
        );
        const colliding = incomingNames.filter((n) => otherNames.has(n));
        if (colliding.length > 0) {
          const err = new Error(`POST /applications/${APP_ID}/grants failed — HTTP 400 — Multiple scopes with the same name cannot be added to the same grant (${colliding.join(', ')})`);
          err.response = { status: 400, data: { code: 'INVALID_DATA', message: 'Multiple scopes with the same name cannot be added to the same grant' } };
          throw err;
        }
        grants.push({ resource: { id: rid }, scopes: body.scopes });
        return { data: { id: `grant-${grants.length}` } };
      }
      throw new Error(`unexpected ${method} ${endpoint}`);
    });
    return svc;
  }

  test('gw grant lands before enduser grant; second call filters overlapping names', async () => {
    const svc = makeGrantService();

    const results = await svc._grantAiAgentScopes(APP_ID, GW_RESOURCE, ENDUSER_RESOURCE);

    // Both grants succeeded — no INVALID_DATA from the name collision.
    expect(results.every((r) => r.success)).toBe(true);

    // Call order: the gw grant's POST must precede the enduser grant's grants
    // GET — the second call must SEE the first's result, not race it.
    const calls = svc.makeRequest.mock.calls;
    const gwPostIdx = calls.findIndex(([m, , b]) => m === 'POST' && b?.resource?.id === GW_RESOURCE);
    const enduserGetIdx = calls.findIndex(([m, u]) => m === 'GET' && u === `/applications/${APP_ID}/grants`);
    // First GET /grants is the gw call's own pre-read; find the LAST one
    // before the enduser POST instead.
    const enduserPostIdx = calls.findIndex(([m, , b]) => m === 'POST' && b?.resource?.id === ENDUSER_RESOURCE);
    const grantsGetBeforeEnduserPost = calls
      .map(([m, u], i) => ({ m, u, i }))
      .filter((c) => c.m === 'GET' && c.u === `/applications/${APP_ID}/grants` && c.i < enduserPostIdx);
    expect(grantsGetBeforeEnduserPost.length).toBeGreaterThanOrEqual(2);
    expect(gwPostIdx).toBeLessThan(grantsGetBeforeEnduserPost[grantsGetBeforeEnduserPost.length - 1].i);
    expect(enduserGetIdx).toBeGreaterThanOrEqual(0);

    // Behavioral pin: the enduser grant's POST body must contain ONLY the
    // non-overlapping scope — the filter dropped read/write/transfer/mortgage:read
    // because the gw grant (completed first) already claimed those names.
    const nameOf = (id, resource) => id.slice(scopeId(resource, '').length);
    const enduserPost = calls.filter(([m, , b]) => m === 'POST' && b?.resource?.id === ENDUSER_RESOURCE);
    expect(enduserPost).toHaveLength(1);
    const enduserNames = enduserPost[0][2].scopes.map((s) => nameOf(s.id, ENDUSER_RESOURCE));
    expect(enduserNames).toEqual(['ai:agent:read']);

    // And the gw grant POSTed the full list first.
    const gwPost = calls.filter(([m, , b]) => m === 'POST' && b?.resource?.id === GW_RESOURCE);
    expect(gwPost[0][2].scopes.map((s) => s.id)).toEqual(gwScopes.map((n) => scopeId(GW_RESOURCE, n)));
  });
});
