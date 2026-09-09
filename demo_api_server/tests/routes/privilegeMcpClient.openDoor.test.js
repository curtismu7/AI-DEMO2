'use strict';

// An UNGATED door needs no bearer, and this client must not invent one.
//
// mcpFacade.js DOORS.banking is deliberately ungated ("the upstream's own 401
// is what the client sees"), so it answers 200 with no Authorization header at
// all. This client gated every door the same way regardless: /tools/list
// answered 401 "click Sign In with Privilege" before ever calling the door, and
// /auth/start threw "the door itself is down" at a door that was up. Measured
// live 2026-09-09 on /mcp-facade/banking/mcp, whose upstream (mcp-server:8080)
// was answering 200 the whole time.
//
// The distinction that carries the weight: OPEN (2xx, no bearer needed) is not
// the same as BROKEN (400/405/5xx, no challenge either). Only the first relays;
// the second must keep the named guard error from privilegeMcpClient.ownOriginDoorGuard.

const express = require('express');
const request = require('supertest');

const PUBLIC_ORIGIN = 'https://local.ping-devops.com:4000';
const DOOR_URL = `${PUBLIC_ORIGIN}/mcp-facade/banking/mcp`;

function buildApp() {
  jest.resetModules();
  const router = require('../../routes/privilegeMcpClient');
  const app = express();
  app.use((req, _res, next) => {
    req.sessionID = 'open-door-test';
    req.session = {};
    next();
  });
  app.use('/api/privilege-mcp', router);
  return app;
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

// What the live ungated banking door returns to an anonymous POST. The client
// pins the JSON-RPC id, so echo it back rather than hardcoding one.
function openDoor(init) {
  const { method, id } = JSON.parse(init.body);
  if (method === 'tools/list') {
    return jsonResponse(200, {
      jsonrpc: '2.0',
      id,
      result: { tools: [{ name: 'get_balance', description: 'balance', inputSchema: { type: 'object' } }] },
    });
  }
  return jsonResponse(200, {
    jsonrpc: '2.0',
    id,
    result: {
      protocolVersion: '2024-11-05',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'AI Demo MCP Server', version: '1.0.0' },
    },
  });
}

describe('an ungated door relays without a token', () => {
  const originalFetch = global.fetch;
  const saved = {};

  beforeEach(() => {
    saved.pub = process.env.PUBLIC_APP_URL;
    process.env.PUBLIC_APP_URL = PUBLIC_ORIGIN;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (saved.pub === undefined) delete process.env.PUBLIC_APP_URL;
    else process.env.PUBLIC_APP_URL = saved.pub;
    jest.restoreAllMocks();
  });

  test('/tools/list relays once sign-in has established the door is ungated', async () => {
    const app = buildApp();
    global.fetch = jest.fn(async (_url, init) => openDoor(init));

    await request(app).post('/api/privilege-mcp/config').send({ mcpUrl: DOOR_URL }).expect(200);
    await request(app).post('/api/privilege-mcp/auth/start').send({}).expect(200);

    const res = await request(app).post('/api/privilege-mcp/tools/list').send({}).expect(200);
    expect(res.body.tools.map((t) => t.name)).toContain('get_balance');
  });

  // The gate must not reach the network to decide who is allowed in — pinned by
  // privilegeMcpClient.procyon.test.js. So an untried door is still refused, and
  // it is /auth/start that establishes "ungated" (in one click, not a redirect).
  test('the gate never probes: an untried door is still refused', async () => {
    const app = buildApp();
    global.fetch = jest.fn(async (_url, init) => openDoor(init));

    await request(app).post('/api/privilege-mcp/config').send({ mcpUrl: DOOR_URL }).expect(200);
    global.fetch.mockClear();

    await request(app).post('/api/privilege-mcp/tools/list').send({}).expect(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('/auth/start says no sign-in is required rather than answering 500', async () => {
    const app = buildApp();
    global.fetch = jest.fn(async (_url, init) => openDoor(init));

    await request(app).post('/api/privilege-mcp/config').send({ mcpUrl: DOOR_URL }).expect(200);

    const res = await request(app).post('/api/privilege-mcp/auth/start').send({}).expect(200);
    expect(res.body.noAuthRequired).toBe(true);
    expect(res.body.authUrl).toBeUndefined();
  });

  test('a door that CHALLENGES is still gated — the escape hatch is not a bypass', async () => {
    const app = buildApp();
    global.fetch = jest.fn(async () => jsonResponse(401, { error: 'unauthorized' }));

    await request(app).post('/api/privilege-mcp/config')
      .send({ mcpUrl: `${PUBLIC_ORIGIN}/mcp-facade/opensearch/mcp` })
      .expect(200);

    const res = await request(app).post('/api/privilege-mcp/tools/list').send({}).expect(401);
    expect(res.body.error).toMatch(/Not authenticated/);
  });

  test('a BROKEN door (400, no challenge) is not mistaken for an open one', async () => {
    const app = buildApp();
    global.fetch = jest.fn(async () => jsonResponse(400, { error: 'upstream unavailable' }));

    await request(app).post('/api/privilege-mcp/config').send({ mcpUrl: DOOR_URL }).expect(200);

    // Still the named guard error, not a silent "no sign-in needed".
    const res = await request(app).post('/api/privilege-mcp/auth/start').send({}).expect(500);
    expect(res.body.error).toMatch(/mcp-facade\/banking/);
    expect(res.body.noAuthRequired).toBeUndefined();

    await request(app).post('/api/privilege-mcp/tools/list').send({}).expect(401);
  });
});
