'use strict';

// Privilege console API relay: /console/connect, /console/inventory and the
// /doors/probe fallback that exists because the agentless gateway answers a
// policy denial with a bare `Forbidden` and logs nothing.
//
// The load-bearing facts these lock in (all probed live 2026-08-31):
//   GET /session-token  needs NO auth  -> the BFF mints the correlation id
//                                         itself instead of asking for it
//   the auth_token cookie is the only real credential -> never echoed back
//   pacpolicy Spec is undocumented    -> carried through raw, never guessed at

const express = require('express');
const request = require('supertest');

// /console/connect and /console/inventory PERSIST what they discover (W8), and
// the door store keeps a single key under a per-WORKER LMDB dir -- shared by
// every suite jest happens to put in that worker. Writing it for real here made
// privilegeMcpClient.state.test.js read this file's fixture apps and fail on the
// sibling-door labels it asserts: a failure in a different file, with nothing in
// its own diff to explain it. Nothing below is about persistence, so the store is
// doubled and this suite writes nothing shared.
//
// Any future suite that exercises those two routes needs the same double.
jest.mock('../../services/lmdb/privilegeDoorStore.lmdb', () => {
  let saved = null;
  return {
    saveInventory: (inv) => {
      saved = { ...inv, applications: inv.applications || [], policyCount: (inv.policies || []).length, discoveredAt: Date.now() };
      return saved;
    },
    getInventory: () => saved,
    clearInventory: () => { saved = null; },
  };
});

const ENV_ID = 'test-env-id';
const CONSOLE = 'https://console.privilege.pingone.com';
const GATEWAY = 'https://cmuir-agentless-mcpgw.ping-devops.com/cmuir/mcp';

function buildApp(sessionId = 'console-test') {
  jest.resetModules();
  process.env.PRIVILEGE_SSO_ENV_ID = ENV_ID;
  const router = require('../../routes/privilegeMcpClient');
  const app = express();
  app.use((req, _res, next) => {
    req.sessionID = sessionId;
    req.session = {};
    next();
  });
  app.use('/api/privilege-mcp', router);
  return app;
}

function jsonResponse(body, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

const APPLICATIONS = {
  Applications: [
    {
      ObjectMeta: { Name: 'cmuir' },
      Spec: {
        McpAppConfig: {
          FrontEndName: { Elems: ['cmuir.default.applications.procyon.ai:8643'] },
          Backends: { Elems: ['http://pingone-mcp-server-2:8080/mcp'] },
          EntryPath: '/mcp',
        },
      },
      Status: { McpServerStatus: { Status: '' } },
    },
    {
      ObjectMeta: { Name: 'external' },
      Spec: { McpAppConfig: { Backends: { Elems: ['http://mcp-server:8080/mcp'] } } },
      Status: { McpServerStatus: { Status: 'Ready' } },
    },
  ],
};

const POLICIES = {
  PacPolicys: [
    { ObjectMeta: { Name: 'cmuir-tools' }, Spec: { Apps: ['cmuir'], Principals: ['someone-else@pingone.com'] } },
    { ObjectMeta: { Name: 'banking-tools' }, Spec: { Apps: ['external'] } },
  ],
};

function mockConsole({ sessionTokenBody = { session_id: 'sid-1' }, appsStatus = 200, policyBody = POLICIES } = {}) {
  const seen = [];
  global.fetch = jest.fn(async (url, opts) => {
    const u = String(url);
    seen.push({ url: u, headers: opts?.headers || {} });
    if (u === `${CONSOLE}/session-token`) return jsonResponse(sessionTokenBody);
    if (u.includes('/v1/applications')) {
      return appsStatus === 200
        ? jsonResponse(APPLICATIONS)
        : jsonResponse({}, { status: appsStatus });
    }
    if (u.includes('/v1/pacpolicys')) return jsonResponse(policyBody);
    return jsonResponse({}, { status: 404 });
  });
  return seen;
}

async function connect(app, authToken = 'console-cookie-value') {
  await request(app).post('/api/privilege-mcp/config')
    .send({ mcpUrl: GATEWAY, clientId: 'a6219652' })
    .expect(200);
  return request(app).post('/api/privilege-mcp/console/connect').send({ authToken });
}

describe('Privilege console inventory', () => {
  const savedFetch = global.fetch;
  afterEach(() => { global.fetch = savedFetch; });

  test('mints the session id itself and returns applications + policies', async () => {
    const seen = mockConsole();
    const res = await connect(buildApp());
    expect(res.status).toBe(200);

    // The operator supplies one value, not two.
    const tokenCall = seen.find((c) => c.url === `${CONSOLE}/session-token`);
    expect(tokenCall).toBeTruthy();
    expect(tokenCall.headers.Cookie).toBe('auth_token=console-cookie-value');

    // Both reads carry the minted id.
    for (const call of seen.filter((c) => c.url.includes('/v1/'))) {
      expect(call.headers['x-procyon-session-id']).toBe('sid-1');
      expect(call.headers.Cookie).toBe('auth_token=console-cookie-value');
    }

    expect(res.body.applications).toHaveLength(2);
    expect(res.body.applications[0]).toMatchObject({
      name: 'cmuir',
      // Route comes from the application NAME, not FrontEndName (that is agent mode).
      mcpUrl: 'https://cmuir-agentless-mcpgw.ping-devops.com/cmuir/mcp',
      backends: ['http://pingone-mcp-server-2:8080/mcp'],
    });
    expect(res.body.applications[1].mcpUrl).toBe('https://cmuir-agentless-mcpgw.ping-devops.com/external/mcp');
    expect(res.body.policies.map((p) => p.name)).toEqual(['cmuir-tools', 'banking-tools']);
    // Spec is passed through untouched — its schema is undocumented.
    expect(res.body.policies[0].spec).toEqual({ Apps: ['cmuir'], Principals: ['someone-else@pingone.com'] });
  });

  test('never echoes the console token back to the client', async () => {
    mockConsole();
    const res = await connect(buildApp('no-echo'));
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('console-cookie-value');
  });

  test('accepts the Items/items shapes the endpoint may use instead of PacPolicys', async () => {
    mockConsole({ policyBody: { Items: [{ ObjectMeta: { Name: 'via-items' }, Spec: {} }] } });
    const res = await connect(buildApp('items-shape'));
    expect(res.status).toBe(200);
    expect(res.body.policies.map((p) => p.name)).toEqual(['via-items']);
  });

  test('a rejected console token surfaces as 401 and leaves nothing stored', async () => {
    mockConsole({ appsStatus: 401 });
    const app = buildApp('bad-token');
    expect((await connect(app)).status).toBe(401);
    // Stored credentials were cleared, so the follow-up read is unauthenticated
    // rather than retrying with a token the console already refused.
    await request(app).get('/api/privilege-mcp/console/inventory').expect(401);
  });

  test('connect requires an authToken', async () => {
    mockConsole();
    await request(buildApp('no-token'))
      .post('/api/privilege-mcp/console/connect').send({}).expect(400);
  });

  test('inventory without connecting is 401, not a crash', async () => {
    mockConsole();
    await request(buildApp('never-connected'))
      .get('/api/privilege-mcp/console/inventory').expect(401);
  });
});
