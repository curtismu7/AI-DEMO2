'use strict';

// W8 -- the Door picker is fed by what the Privilege console reports, not by
// hardcoded app names.
//
// The requirement this pins (spec §7 criterion 7): registering a new Agentic
// App in the console makes it a selectable door after one refresh, with no code
// change, no env var and no redeploy -- AND the door keeps working after the
// console credential expires, because that credential is an auth_token cookie
// an operator pastes out of a browser session and which lasts about an hour.
//
// The store is doubled rather than written for real: it keeps a single key, so
// concurrent suites under jest's four workers would clobber each other, and
// privilegeMcpClient.state.test.js asserts on the exact labels /state derives
// from that key. tests/services/privilegeDoorStore.test.js covers the store.

const express = require('express');
const request = require('supertest');

let mockStored = null;
let mockThrowOnSave = false;
let mockThrowOnGet = false;
const mockSave = jest.fn((inv) => {
  if (mockThrowOnSave) throw new Error('LMDB is unhappy');
  mockStored = {
    envId: inv.envId,
    gatewayOrigin: inv.gatewayOrigin,
    applications: (inv.applications || []).map((a) => ({ name: a.name, status: a.status, policies: [] })),
    policyCount: (inv.policies || []).length,
    discoveredAt: 1_757_000_000_000,
  };
  return mockStored;
});

jest.mock('../../services/lmdb/privilegeDoorStore.lmdb', () => ({
  saveInventory: (inv) => mockSave(inv),
  getInventory: () => {
    if (mockThrowOnGet) throw new Error('LMDB will not open');
    return mockStored;
  },
  clearInventory: () => { mockStored = null; },
}));

const ENV_ID = 'test-env-id';
const CONSOLE = 'https://console.privilege.pingone.com';
const GATEWAY_HOST = 'https://gw.example.test';
const PUBLIC_ORIGIN = 'https://demo.example.test';

const APPLICATIONS = {
  Applications: [
    {
      ObjectMeta: { Name: 'opensearch22' },
      Spec: { McpAppConfig: { Backends: { Elems: ['http://os:8080/mcp'] }, EntryPath: '/mcp' } },
      Status: { McpServerStatus: { Status: 'Ready' } },
    },
    {
      ObjectMeta: { Name: 'newly-registered' },
      Spec: { McpAppConfig: { Backends: { Elems: ['http://new:8080/mcp'] } } },
      Status: { McpServerStatus: { Status: 'Ready' } },
    },
  ],
};

const POLICIES = { PacPolicys: [{ ObjectMeta: { Name: 'p1' }, Spec: { Apps: ['newly-registered'] } }] };

function jsonResponse(body, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

function mockConsole() {
  global.fetch = jest.fn(async (url) => {
    const u = String(url);
    if (u === `${CONSOLE}/session-token`) return jsonResponse({ session_id: 'sid-1' });
    if (u.includes('/v1/applications')) return jsonResponse(APPLICATIONS);
    if (u.includes('/v1/pacpolicys')) return jsonResponse(POLICIES);
    return jsonResponse({}, { status: 404 });
  });
}

function buildApp() {
  jest.resetModules();
  process.env.PRIVILEGE_SSO_ENV_ID = ENV_ID;
  process.env.PUBLIC_APP_URL = PUBLIC_ORIGIN;
  process.env.PRIVILEGE_MCPGW_URL = `${GATEWAY_HOST}/opensearch22/mcp`;
  const router = require('../../routes/privilegeMcpClient');
  const app = express();
  app.use((req, _res, next) => { req.sessionID = 'door-discovery'; req.session = {}; next(); });
  app.use('/api/privilege-mcp', router);
  return app;
}

const savedFetch = global.fetch;
const savedEnv = { ...process.env };

beforeEach(() => {
  mockStored = null;
  mockThrowOnSave = false;
  mockThrowOnGet = false;
  mockSave.mockClear();
});

afterEach(() => {
  global.fetch = savedFetch;
  process.env = { ...savedEnv };
});

const labels = (body, mode) => body.presets.filter((p) => p.mode === mode).map((p) => p.label);
const urlFor = (body, label) => body.presets.find((p) => p.label === label)?.url;

describe('W8 — door discovery feeds the Door picker', () => {
  test('an app the console reports becomes a door on both lanes after one refresh', async () => {
    mockConsole();
    const app = buildApp();

    // Before: nobody has connected the console, so the picker is on the
    // pre-W8 hardcoded pair and knows nothing about `newly-registered`.
    const before = await request(app).get('/api/privilege-mcp/state').expect(200);
    expect(labels(before.body, 'privilege')).toEqual(expect.arrayContaining(['Privilege — opensearch', 'Privilege — brave']));
    expect(labels(before.body, 'privilege')).not.toContain('Privilege — newly-registered');
    expect(before.body.doorDiscovery).toMatchObject({ persisted: false, appCount: 0 });

    await request(app).post('/api/privilege-mcp/console/connect').send({ authToken: 'cookie' }).expect(200);

    // After: the new app is selectable on both the Privilege and Façade lanes,
    // and no env var or restart was involved.
    const after = await request(app).get('/api/privilege-mcp/state').expect(200);
    expect(labels(after.body, 'privilege')).toContain('Privilege — newly-registered');
    expect(labels(after.body, 'facade')).toContain('Façade — newly-registered');
    expect(after.body.doorDiscovery).toMatchObject({ persisted: true, appCount: 2, policyCount: 1 });
  });

  test('the discovered façade door carries the /mcp-facade prefix, the privilege one does not', async () => {
    mockConsole();
    const app = buildApp();
    await request(app).post('/api/privilege-mcp/console/connect').send({ authToken: 'cookie' }).expect(200);
    const { body } = await request(app).get('/api/privilege-mcp/state').expect(200);

    // The bug this replaced derived BOTH from the current door's origin, so in
    // façade mode the façade door came out as <public-origin>/<app>/mcp and
    // reached nothing.
    expect(urlFor(body, 'Privilege — newly-registered')).toBe(`${GATEWAY_HOST}/newly-registered/mcp`);
    expect(urlFor(body, 'Façade — newly-registered')).toBe(`${PUBLIC_ORIGIN}/mcp-facade/privilege-gateway/newly-registered/mcp`);
  });

  test('the numbered default app is not offered twice', async () => {
    mockConsole();
    const app = buildApp();
    await request(app).post('/api/privilege-mcp/console/connect').send({ authToken: 'cookie' }).expect(200);
    const { body } = await request(app).get('/api/privilege-mcp/state').expect(200);

    // opensearch22 is the console's first app AND the numbered `2 ·` preset.
    expect(labels(body, 'privilege').filter((l) => l.includes('opensearch22'))).toEqual([]);
    expect(labels(body, 'privilege')).toContain('2 · Privilege — direct to the AI Gateway');
  });

  test('doors outlive the console session that discovered them', async () => {
    // The whole point: the credential is an hour-long pasted cookie, so serving
    // a door must not depend on it. Only re-discovery does.
    mockConsole();
    const app = buildApp();
    await request(app).post('/api/privilege-mcp/console/connect').send({ authToken: 'cookie' }).expect(200);
    await request(app).post('/api/privilege-mcp/console/disconnect').expect(200);

    // The token is gone -- a refresh is refused...
    await request(app).get('/api/privilege-mcp/console/inventory').expect(401);
    // ...but the doors are still there.
    const { body } = await request(app).get('/api/privilege-mcp/state').expect(200);
    expect(labels(body, 'privilege')).toContain('Privilege — newly-registered');
  });

  test('a refresh re-persists and reports what came back', async () => {
    mockConsole();
    const app = buildApp();
    await request(app).post('/api/privilege-mcp/console/connect').send({ authToken: 'cookie' }).expect(200);
    mockSave.mockClear();

    const res = await request(app).get('/api/privilege-mcp/console/inventory').expect(200);
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(res.body.discovery).toMatchObject({ persisted: true, appCount: 2, policyCount: 1 });
  });

  test('a store write failure is reported, not swallowed as success', async () => {
    // Degrading to "discovered but only for this session" is the exact
    // behaviour W8 exists to remove, so it must never read as persisted.
    mockConsole();
    mockThrowOnSave = true;
    const app = buildApp();

    const res = await request(app).post('/api/privilege-mcp/console/connect').send({ authToken: 'cookie' }).expect(200);
    expect(res.body.applications).toHaveLength(2);      // discovery itself still succeeded
    expect(res.body.discovery.persisted).toBe(false);
  });

  test('the console token is never written to the store', async () => {
    mockConsole();
    const app = buildApp();
    await request(app).post('/api/privilege-mcp/console/connect').send({ authToken: 'super-secret-cookie' }).expect(200);

    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(mockSave.mock.calls[0][0])).not.toContain('super-secret-cookie');
  });

  test('with no discovery the fallback still honours the per-app env overrides', async () => {
    // An existing deployment that pinned these must see no change at all until
    // somebody connects the console.
    process.env.PRIVILEGE_MCPGW_OPENSEARCH_URL = 'https://pinned.example.test/opensearch/mcp';
    process.env.PRIVILEGE_FACADE_BRAVE_URL = 'https://pinned.example.test/mcp-facade/privilege-gateway/brave/mcp';
    const app = buildApp();

    const { body } = await request(app).get('/api/privilege-mcp/state').expect(200);
    expect(urlFor(body, 'Privilege — opensearch')).toBe('https://pinned.example.test/opensearch/mcp');
    expect(urlFor(body, 'Façade — brave')).toBe('https://pinned.example.test/mcp-facade/privilege-gateway/brave/mcp');
  });

  test('a store read failure falls back to the hardcoded doors, it does not 500', async () => {
    // /state is the page's whole bootstrap. An LMDB open failure taking it out
    // would remove the one screen an operator would use to diagnose the store.
    mockThrowOnGet = true;
    const app = buildApp();

    const { body } = await request(app).get('/api/privilege-mcp/state').expect(200);
    expect(labels(body, 'privilege')).toEqual(expect.arrayContaining(['Privilege — opensearch', 'Privilege — brave']));
    expect(body.doorDiscovery).toMatchObject({ persisted: false });
  });

  test('a malformed stored record is ignored rather than mapped over', async () => {
    // A record written by an older shape must not reach the .map() below it.
    mockStored = { envId: 'e', applications: 'not-an-array', policyCount: 0 };
    const app = buildApp();

    const { body } = await request(app).get('/api/privilege-mcp/state').expect(200);
    expect(labels(body, 'privilege')).toEqual(expect.arrayContaining(['Privilege — opensearch', 'Privilege — brave']));
  });

  test('/state carries each door status and which policies mention it', async () => {
    // After the console token expires this is the only thing distinguishing a
    // non-ready or unmentioned door from a working one.
    mockConsole();
    const app = buildApp();
    await request(app).post('/api/privilege-mcp/console/connect').send({ authToken: 'cookie' }).expect(200);
    mockStored.applications = mockStored.applications.map((a) => ({ ...a, policies: a.name === 'newly-registered' ? ['p1'] : [] }));

    const { body } = await request(app).get('/api/privilege-mcp/state').expect(200);
    const discovered = body.doorDiscovery.applications.find((a) => a.name === 'newly-registered');
    expect(discovered).toMatchObject({ status: 'Ready', policies: ['p1'] });
    expect(body.doorDiscovery.applications.find((a) => a.name === 'opensearch22').policies).toEqual([]);
  });

  test('the gateway URL does not depend on the mode active during discovery', async () => {
    // consoleData outlives a mode switch. Deriving the gateway URL from the door
    // in play at discovery time meant discovering in Direct or Facade mode and
    // then switching to Privilege offered <public-origin>/<app>/mcp, which never
    // reaches the gateway.
    mockConsole();
    const app = buildApp();
    await request(app).post('/api/privilege-mcp/config')
      .send({ mcpUrl: `${PUBLIC_ORIGIN}/mcp-facade/privilege-gateway/opensearch22/mcp` }).expect(200);

    const res = await request(app).post('/api/privilege-mcp/console/connect').send({ authToken: 'cookie' }).expect(200);
    const discovered = res.body.applications.find((a) => a.name === 'newly-registered');
    expect(discovered.gatewayUrl).toBe(`${GATEWAY_HOST}/newly-registered/mcp`);
    expect(discovered.facadeUrl).toBe(`${PUBLIC_ORIGIN}/mcp-facade/privilege-gateway/newly-registered/mcp`);
  });

  test('an app removed from the console stops being offered', async () => {
    mockConsole();
    const app = buildApp();
    await request(app).post('/api/privilege-mcp/console/connect').send({ authToken: 'cookie' }).expect(200);

    // The console now reports only the default app.
    global.fetch = jest.fn(async (url) => {
      const u = String(url);
      if (u === `${CONSOLE}/session-token`) return jsonResponse({ session_id: 'sid-1' });
      if (u.includes('/v1/applications')) return jsonResponse({ Applications: [APPLICATIONS.Applications[0]] });
      if (u.includes('/v1/pacpolicys')) return jsonResponse({ PacPolicys: [] });
      return jsonResponse({}, { status: 404 });
    });
    await request(app).get('/api/privilege-mcp/console/inventory').expect(200);

    const { body } = await request(app).get('/api/privilege-mcp/state').expect(200);
    expect(labels(body, 'privilege')).not.toContain('Privilege — newly-registered');
    expect(labels(body, 'facade')).not.toContain('Façade — newly-registered');
  });
});
