'use strict';

jest.mock('../../services/lmdb/transactionLedger.lmdb', () => ({
  appendHop: jest.fn(),
}));
jest.mock('../../services/transactionAssembler', () => ({ assemble: jest.fn() }));
jest.mock('../../services/configStore', () => ({ getEffective: jest.fn(() => 'true') }));
jest.mock('../../services/jwksService', () => ({ getPublicKey: jest.fn() }));
jest.mock('../../services/mcpPingOneHttpAdapter', () => ({
  listTools: jest.fn(async () => [
    { name: 'listUsers', description: 'List users', inputSchema: { type: 'object', properties: {} } },
    { name: 'getEnvironment', description: 'Get environment', inputSchema: { type: 'object', properties: {} } },
  ]),
  callTool: jest.fn(async (name) => ({ content: [{ type: 'text', text: JSON.stringify({ tool: name, ok: true }) }] })),
}));

const http = require('http');
const express = require('express');
const request = require('supertest');
const ledger = require('../../services/lmdb/transactionLedger.lmdb');
const { assemble } = require('../../services/transactionAssembler');
const configStore = require('../../services/configStore');
const router = require('../../routes/mcpFacade');

// A stub gateway: 401 + RFC 9728 challenge without a bearer, JSON replies for
// initialize/tools/list, an SSE-framed reply for tools/call (the Node gateway
// answers POSTs that way), and a session id on every response.
let upstream;
let upstreamUrl;
let seen = [];

beforeAll(async () => {
  upstream = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const rpc = raw ? JSON.parse(raw) : {};
      seen.push({ headers: req.headers, rpc, method: req.method });
      if (!req.headers.authorization) {
        res.writeHead(401, {
          'WWW-Authenticate': 'Bearer realm="gw", scope="mcp:invoke", resource_metadata="http://upstream.invalid/.well-known/oauth-protected-resource"',
        });
        return res.end('{}');
      }
      const reply = (result) => {
        res.writeHead(200, { 'Content-Type': 'application/json', 'mcp-session-id': 'sess-1' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }));
      };
      if (rpc.method === 'initialize' && rpc.params?.clientInfo?.name === 'denied-device') {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        return res.end("User b1645e7b doesn't have access to MCP app opensearch");
      }
      if (rpc.method === 'initialize') {
        return reply({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'stub-gw', version: '1' } });
      }
      if (rpc.method === 'tools/list') {
        return reply({ tools: [{ name: 'get_my_accounts', description: 'List my accounts', inputSchema: {} }] });
      }
      if (rpc.method === 'tools/call' && rpc.params?.name === 'get_sensitive_account_details') {
        res.writeHead(403, { 'Content-Type': 'application/json', 'mcp-session-id': 'sess-1' });
        return res.end(JSON.stringify({ error: 'forbidden', message: 'policy: sensitive:read not granted', decision: 'DENY' }));
      }
      if (rpc.method === 'tools/call') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'mcp-session-id': 'sess-1' });
        const body = { jsonrpc: '2.0', id: rpc.id, result: { content: [{ type: 'text', text: '{"success":true,"count":4}' }] } };
        return res.end(`event: message\ndata: ${JSON.stringify(body)}\n\n`);
      }
      return reply({});
    });
  });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  upstreamUrl = `http://127.0.0.1:${upstream.address().port}/mcp`;
  process.env.MCP_FACADE_AGENT_GATEWAY_URL = upstreamUrl;
  process.env.MCP_FACADE_AGENT_GATEWAY_AS = 'http://localhost:3005';
  process.env.MCP_FACADE_AGENTLESS_URL = upstreamUrl;
  process.env.MCP_FACADE_BANKING_URL = upstreamUrl;
  process.env.MCP_FACADE_REEL_BASE = 'https://ui.example';
});

afterAll(() => new Promise((r) => upstream.close(r)));

beforeEach(() => {
  jest.clearAllMocks();
  seen = [];
  router.__test.sessions.clear();
  pingoneAdminSession.clear();
  jwksService.getPublicKey.mockResolvedValue({ keyObject: publicKey, alg: 'RS256' });
});

function app() {
  const a = express();
  a.use('/mcp-facade', router);
  return a;
}

const CLAIMS = { sub: 'user-1', scope: 'read mcp:invoke', aud: 'mcpgateway.ping.demo', client_id: 'c1' };
const AUTH = `Bearer e30.${Buffer.from(JSON.stringify(CLAIMS)).toString('base64url')}.sig`;

// The pingone-admin door verifies its bearer for real (requireBearer), so that
// door alone needs a properly signed RS256 token — the unsigned AUTH above is
// enough for every door that only relays it.
const crypto = require('crypto');
const jwksService = require('../../services/jwksService');
const pingoneAdminSession = require('../../services/pingoneAdminSession');
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });

function makeSignedToken(aud = 'mcpgateway.ping.demo') {
  const head = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'k1' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({
    sub: 'user-1', scope: 'mcp:invoke', aud, exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString('base64url');
  const sig = crypto.createSign('RSA-SHA256').update(`${head}.${body}`).sign(privateKey).toString('base64url');
  return `Bearer ${head}.${body}.${sig}`;
}
const ADMIN_AUTH = makeSignedToken();

function hopsByPhase() {
  return Object.fromEntries(ledger.appendHop.mock.calls.map(([, h]) => [h.phase, h]));
}

async function runSession(door) {
  const a = app();
  const init = await request(a).post(`/mcp-facade/${door}/mcp`).set('Authorization', AUTH)
    .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'LM Studio', version: '0.4' } } });
  const sid = init.headers['mcp-session-id'];
  await request(a).post(`/mcp-facade/${door}/mcp`).set('Authorization', AUTH).set('mcp-session-id', sid)
    .send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  await request(a).post(`/mcp-facade/${door}/mcp`).set('Authorization', AUTH).set('mcp-session-id', sid)
    .send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const call = await request(a).post(`/mcp-facade/${door}/mcp`).set('Authorization', AUTH).set('mcp-session-id', sid)
    .send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_my_accounts', arguments: { limit: 4 } } });
  return { init, sid, call };
}

describe('/mcp-facade — RFC 9728 surface', () => {
  test('serves protected-resource metadata naming ITSELF as the resource and the broker as the AS', async () => {
    const res = await request(app()).get('/mcp-facade/agent-gateway/.well-known/oauth-protected-resource');
    expect(res.status).toBe(200);
    expect(res.body.resource).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp-facade\/agent-gateway\/mcp$/);
    expect(res.body.authorization_servers).toEqual(['http://localhost:3005']);
    expect(res.body.scopes_supported).toEqual(expect.arrayContaining(['read', 'mcp:invoke']));
  });

  test('a door with authorizationServer:null advertises none (the upstream owns identity)', async () => {
    const res = await request(app()).get('/mcp-facade/banking/.well-known/oauth-protected-resource');
    expect(res.status).toBe(200);
    expect(res.body.authorization_servers).toBeUndefined();
  });

  test('unknown door → 404 listing the doors', async () => {
    const res = await request(app()).get('/mcp-facade/nope/.well-known/oauth-protected-resource');
    expect(res.status).toBe(404);
    expect(res.body.doors).toEqual(['agent-gateway', 'agentless', 'audit', 'opensearch', 'banking', 'brave', 'privilege-gateway', 'pingone-admin']);
  });

  test('an upstream 401 is relayed with resource_metadata rewritten to the façade', async () => {
    const res = await request(app()).post('/mcp-facade/agent-gateway/mcp')
      .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    expect(res.status).toBe(401);
    const www = res.headers['www-authenticate'];
    // scope widened to the door's tool scopes: clients request exactly what the
    // challenge names, and mcp:invoke alone cannot call a tool.
    expect(www).toMatch(/^Bearer realm="gw", scope="read write transfer mcp:invoke", resource_metadata="http:\/\/127\.0\.0\.1:\d+\/mcp-facade\/agent-gateway\/\.well-known\/oauth-protected-resource"$/);
    expect(www).not.toContain('upstream.invalid');
    expect(ledger.appendHop).not.toHaveBeenCalled();
  });

  test('rewriteChallenge handles a bare Bearer challenge', () => {
    expect(router.__test.rewriteChallenge(null, 'http://f/prm')).toBe('Bearer resource_metadata="http://f/prm"');
    expect(router.__test.rewriteChallenge('Bearer', 'http://f/prm')).toBe('Bearer resource_metadata="http://f/prm"');
    expect(router.__test.rewriteChallenge('Bearer', 'http://f/prm', ['read', 'mcp:invoke'])).toBe('Bearer scope="read mcp:invoke", resource_metadata="http://f/prm"');
    expect(router.__test.rewriteChallenge('Bearer realm="x", scope="mcp:invoke"', 'http://f/prm', ['read', 'mcp:invoke'])).toBe('Bearer realm="x", scope="read mcp:invoke", resource_metadata="http://f/prm"');
    // Privilege doors declare no scopes → challenge scope left as the gateway sent it
    expect(router.__test.rewriteChallenge('Bearer realm="p", scope="openid"', 'http://f/prm', [])).toBe('Bearer realm="p", scope="openid", resource_metadata="http://f/prm"');
  });
});

describe('/mcp-facade/pingone-admin — local handler, no upstream fetch', () => {
  // routes/mcpFacade.js lazy-requires mcpPingOneHttpAdapter inside the
  // handler body, and this repo's global setup.js calls jest.resetModules()
  // after every test — a reference captured once at describe-load time
  // would go stale after the first reset (mirrors adminTools.schemaSize.
  // test.js's own fix for the identical issue). Re-require fresh per test.
  let listTools;
  let callTool;
  beforeEach(() => {
    ({ listTools, callTool } = require('../../services/mcpPingOneHttpAdapter'));
  });

  test('advertises OUR broker as the AS — never PingOne, whose token is audienced elsewhere', async () => {
    const res = await request(app()).get('/mcp-facade/pingone-admin/.well-known/oauth-protected-resource');
    expect(res.status).toBe(200);
    expect(res.body.authorization_servers).toEqual(['http://localhost:3005']);
    expect(res.body.scopes_supported).toEqual(['mcp:invoke']);
    // The door names ITSELF, not mcp.pingone.com — advertising PingOne's
    // resource identifier here would hand clients a wrong-hop token.
    expect(res.body.resource).toMatch(/mcp-facade\/pingone-admin\/mcp$/);
  });

  test('an anonymous caller is challenged, never served from the operator session', async () => {
    const res = await request(app()).post('/mcp-facade/pingone-admin/mcp')
      .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toMatch(/resource_metadata=/);
    expect(listTools).not.toHaveBeenCalled();
  });

  test('initialize succeeds for a caller holding a verified bearer', async () => {
    const res = await request(app()).post('/mcp-facade/pingone-admin/mcp').set('Authorization', ADMIN_AUTH)
      .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
    expect(res.status).toBe(200);
    expect(res.body.result.serverInfo.name).toBe('PingOne Admin (hosted MCP)');
    expect(res.headers['mcp-session-id']).toBeTruthy();
  });

  test('tools/list returns the RAW hosted catalog, uncapped, never touches the facade\'s own upstream stub', async () => {
    const init = await request(app()).post('/mcp-facade/pingone-admin/mcp').set('Authorization', ADMIN_AUTH)
      .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    const sid = init.headers['mcp-session-id'];
    const res = await request(app()).post('/mcp-facade/pingone-admin/mcp').set('Authorization', ADMIN_AUTH).set('mcp-session-id', sid)
      .send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    expect(res.status).toBe(200);
    expect(res.body.result.tools.map((t) => t.name)).toEqual(['listUsers', 'getEnvironment']);
    expect(listTools).toHaveBeenCalled();
    expect(seen).toEqual([]); // never hit the stub upstream server
  });

  test('an x-pingone-admin-token header is forwarded to listTools as the delegated token', async () => {
    const init = await request(app()).post('/mcp-facade/pingone-admin/mcp').set('Authorization', ADMIN_AUTH)
      .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    const sid = init.headers['mcp-session-id'];
    await request(app()).post('/mcp-facade/pingone-admin/mcp').set('Authorization', ADMIN_AUTH).set('mcp-session-id', sid)
      .set('x-pingone-admin-token', 'delegated-token-1')
      .send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    expect(listTools).toHaveBeenCalledWith('delegated-token-1');
  });

  test('tools/call dispatches through the raw adapter by hosted tool name and relays its result verbatim', async () => {
    const init = await request(app()).post('/mcp-facade/pingone-admin/mcp').set('Authorization', ADMIN_AUTH)
      .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    const sid = init.headers['mcp-session-id'];
    const res = await request(app()).post('/mcp-facade/pingone-admin/mcp').set('Authorization', ADMIN_AUTH).set('mcp-session-id', sid)
      .send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'listUsers', arguments: { filter: 'username sw "curt"' } } });
    expect(res.status).toBe(200);
    // Third arg is the delegated PKCE token: the caller's x-pingone-admin-token
    // header, else the shared operator session. Neither exists here, and null
    // is what an empty session reports — the adapter then throws
    // pingone_mcp_auth_required rather than calling PingOne with nothing.
    expect(callTool).toHaveBeenCalledWith('listUsers', { filter: 'username sw "curt"' }, null);
    expect(JSON.parse(res.body.result.content[0].text)).toEqual({ tool: 'listUsers', ok: true });
  });

  test('DELETE tears down the local session without an upstream call', async () => {
    const init = await request(app()).post('/mcp-facade/pingone-admin/mcp').set('Authorization', ADMIN_AUTH)
      .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    const sid = init.headers['mcp-session-id'];
    const res = await request(app()).delete('/mcp-facade/pingone-admin/mcp').set('mcp-session-id', sid);
    expect(res.status).toBe(200);
    expect(seen).toEqual([]);
  });

  test('falls back to the shared operator session when the caller sends no delegated token', async () => {
    pingoneAdminSession.remember({ accessToken: 'operator-token', expiresIn: 3600 });
    const init = await request(app()).post('/mcp-facade/pingone-admin/mcp').set('Authorization', ADMIN_AUTH)
      .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    const sid = init.headers['mcp-session-id'];
    await request(app()).post('/mcp-facade/pingone-admin/mcp').set('Authorization', ADMIN_AUTH).set('mcp-session-id', sid)
      .send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    expect(listTools).toHaveBeenCalledWith('operator-token');
  });

  test("the caller's own delegated token wins over the shared operator session", async () => {
    pingoneAdminSession.remember({ accessToken: 'operator-token', expiresIn: 3600 });
    const init = await request(app()).post('/mcp-facade/pingone-admin/mcp').set('Authorization', ADMIN_AUTH)
      .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    const sid = init.headers['mcp-session-id'];
    await request(app()).post('/mcp-facade/pingone-admin/mcp').set('Authorization', ADMIN_AUTH).set('mcp-session-id', sid)
      .set('x-pingone-admin-token', 'my-own-token')
      .send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    expect(listTools).toHaveBeenCalledWith('my-own-token');
  });

  test('tools/list with no delegated token answers 401 with a loginUrl the client can drive', async () => {
    const authRequired = new Error('PingOne MCP requires a delegated PKCE token.');
    authRequired.code = 'pingone_mcp_auth_required';
    listTools.mockRejectedValueOnce(authRequired);

    const init = await request(app()).post('/mcp-facade/pingone-admin/mcp').set('Authorization', ADMIN_AUTH)
      .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    const sid = init.headers['mcp-session-id'];
    const res = await request(app()).post('/mcp-facade/pingone-admin/mcp').set('Authorization', ADMIN_AUTH).set('mcp-session-id', sid)
      .send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });

    expect(res.status).toBe(401);
    expect(res.body.error.data.reason).toBe('pingone_admin_login_required');
    expect(res.body.error.data.loginUrl).toBe(
      '/api/mcp/inspector/pingone-admin/login?returnTo=%2Fprivilege-mcp-client',
    );
  });
});

describe('/mcp-facade — relay + recording', () => {
  test('agent-gateway: tools/call is relayed, reel_url appended, three hops written, correlation forwarded', async () => {
    const { init, sid, call } = await runSession('agent-gateway');
    expect(init.status).toBe(200);
    expect(sid).toBe('sess-1');
    expect(call.status).toBe(200);
    expect(call.headers['content-type']).toMatch(/application\/json/);

    // The real tool result is untouched; the reel_url block is appended after it.
    const content = call.body.result.content;
    expect(content[0]).toEqual({ type: 'text', text: '{"success":true,"count":4}' });
    expect(content[1].type).toBe('text');
    const cid = content[1].text.split('\n')[0].split('/').pop();
    const [first, imageUrl, hint, image] = content[1].text.split('\n');
    expect(first).toMatch(/^reel_url: https:\/\/ui\.example\/transaction-trace\/embed\/[0-9a-f-]{36}$/);
    expect(imageUrl).toMatch(/^reel_image: http:\/\/127\.0\.0\.1:\d+\/mcp-facade\/reel\/[0-9a-f-]{36}\.svg$/);
    // descriptive only — no imperative sentence a model could read as injection
    expect(hint).toMatch(/^Transaction trace \("movie reel"\) for this tool call/);
    expect(content[1].text).not.toMatch(/always|must|should/i);
    expect(image).toMatch(/^!\[Transaction trace\]\(http:\/\/127\.0\.0\.1:\d+\/mcp-facade\/reel\/[0-9a-f-]{36}\.svg\)$/);
    expect(image).toContain(cid);

    // Every hop of the session — initialize, initialized, tools/list, then the
    // call's ui.request → mcp.tool → response — on ONE correlation id.
    const ids = ledger.appendHop.mock.calls.map(([id]) => id);
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).toBe(cid);
    const phases = ledger.appendHop.mock.calls.map(([, h]) => `${h.phase}:${h.op}`);
    expect(phases).toEqual([
      'mcp.step:initialize', 'mcp.step:notifications/initialized', 'mcp.step:tools/list',
      'ui.request:tools/call get_my_accounts', 'mcp.tool:get_my_accounts', 'response:tools/call',
    ]);
    const hops = hopsByPhase();
    expect(hops['ui.request']).toMatchObject({
      service: 'mcp-facade',
      op: 'tools/call get_my_accounts',
      identity: { sub: 'user-1', scopes: ['read', 'mcp:invoke'], aud: 'mcpgateway.ping.demo', clientId: 'c1' },
      details: {
        door: 'agent-gateway',
        client: { name: 'LM Studio', version: '0.4' },
        server: { name: 'stub-gw', version: '1' },
        tools: [{ name: 'get_my_accounts', description: 'List my accounts' }],
        arguments: { limit: 4 },
      },
    });
    expect(hops['mcp.tool']).toMatchObject({ op: 'get_my_accounts', status: 'ok', details: { httpStatus: 200 } });
    expect(hops['mcp.tool'].details.result.content[0].text).toBe('{"success":true,"count":4}');
    expect(hops.response.details.reelUrl).toBe(`https://ui.example/transaction-trace/embed/${cid}`);
    // the initialize step carries the identity (record principal) and the negotiated session facts
    const initHop = ledger.appendHop.mock.calls[0][1];
    expect(initHop).toMatchObject({ phase: 'mcp.step', op: 'initialize', status: 'ok', identity: { sub: 'user-1' },
      details: { httpStatus: 200, client: { name: 'LM Studio', version: '0.4' }, server: { name: 'stub-gw', version: '1' }, protocolVersion: '2025-06-18' } });
    expect(ledger.appendHop.mock.calls[2][1].details).toMatchObject({ toolCount: 1 });

    // The gateway keys its own gateway.authorize hop by this header.
    const upstreamCall = seen.find((s) => s.rpc.method === 'tools/call');
    expect(upstreamCall.headers['x-correlation-id']).toBe(cid);
    expect(upstreamCall.headers.authorization).toBe(AUTH);
    expect(upstreamCall.headers['mcp-session-id']).toBe('sess-1');
    // the session's correlation id rides on EVERY request to the gateway, not just the call
    const upstreamList = seen.find((s) => s.rpc.method === 'tools/list');
    expect(upstreamList.headers['x-correlation-id']).toBe(cid);
  });

  test('non-tool calls pass through untouched and are recorded as mcp.step hops on the session reel', async () => {
    const { init } = await runSession('agent-gateway');
    expect(init.body.result.serverInfo.name).toBe('stub-gw');
    const steps = ledger.appendHop.mock.calls.map(([, h]) => h).filter((h) => h.phase === 'mcp.step');
    expect(steps.map((h) => h.op)).toEqual(['initialize', 'notifications/initialized', 'tools/list']);
    expect(steps.every((h) => h.service === 'mcp-facade' && h.details.httpStatus === 200 && Number.isFinite(h.durationMs))).toBe(true);
  });

  test('an unauthenticated 401 probe writes no hop (not a transaction)', async () => {
    await request(app()).post('/mcp-facade/agent-gateway/mcp')
      .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    expect(ledger.appendHop).not.toHaveBeenCalled();
  });

  test('two tool calls in one session share one reel', async () => {
    const { sid, call } = await runSession('agent-gateway');
    const second = await request(app()).post('/mcp-facade/agent-gateway/mcp').set('Authorization', AUTH).set('mcp-session-id', sid)
      .send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_my_accounts', arguments: {} } });
    const reelOf = (r) => r.body.result.content.at(-1).text.split('\n')[0];
    expect(reelOf(second)).toBe(reelOf(call));
    expect(new Set(ledger.appendHop.mock.calls.map(([id]) => id)).size).toBe(1);
  });

  test('Privilege doors add an inferred gateway.authorize hop (no policy trail to read)', async () => {
    await runSession('agentless');
    const hops = hopsByPhase();
    expect(Object.keys(hops)).toEqual(['mcp.step', 'ui.request', 'gateway.authorize', 'mcp.tool', 'response']);
    expect(hops['gateway.authorize'].decision).toEqual({ outcome: 'permit', by: 'Privilege agentless', reason: 'HTTP 200', source: 'inferred' });
    const upstreamCall = seen.find((s) => s.rpc.method === 'tools/call');
    expect(upstreamCall.headers['x-correlation-id']).toBeUndefined();
  });

  test('upstream unreachable → 502 and the failure is on the reel', async () => {
    process.env.MCP_FACADE_AGENT_GATEWAY_URL = 'http://127.0.0.1:1/mcp';
    try {
      const res = await request(app()).post('/mcp-facade/agent-gateway/mcp').set('Authorization', AUTH)
        .send({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'get_my_accounts', arguments: {} } });
      expect(res.status).toBe(502);
      expect(res.body.error).toBe('upstream_unavailable');
      const hops = hopsByPhase();
      expect(hops['mcp.tool'].status).toBe('error');
      expect(hops.response.details.httpStatus).toBe(502);
    } finally {
      process.env.MCP_FACADE_AGENT_GATEWAY_URL = upstreamUrl;
    }
  });

  test('MCP-Protocol-Version is forwarded unchanged to every door', async () => {
    const a = app();
    await request(a).post('/mcp-facade/agent-gateway/mcp').set('Authorization', AUTH).set('mcp-protocol-version', '2026-07-28')
      .send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    expect(seen[0].headers['mcp-protocol-version']).toBe('2026-07-28');
    await request(a).post('/mcp-facade/agentless/mcp').set('Authorization', AUTH).set('mcp-protocol-version', '2025-06-18')
      .send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    expect(seen[1].headers['mcp-protocol-version']).toBe('2025-06-18');
  });

  describe('denied session — a door said 403 before any session existed', () => {
    const initDenied = () => request(app()).post('/mcp-facade/agentless/mcp').set('Authorization', AUTH)
      .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'denied-device', version: '0' } } });

    test('initialize succeeds with the denial in MCP instructions and a denied- session id; the reel records the DENY', async () => {
      const res = await initDenied();
      expect(res.status).toBe(200);
      expect(res.headers['mcp-session-id']).toMatch(/^denied-[0-9a-f-]{36}$/);
      expect(res.body.result.serverInfo.name).toBe('Privilege agentless (access denied)');
      expect(res.body.result.instructions).toMatch(/^You have been denied by Policy\. Privilege agentless refused initialize: User b1645e7b doesn't have access to MCP app opensearch/);
      const hops = hopsByPhase();
      expect(hops['mcp.step']).toMatchObject({ op: 'initialize', status: 'error', details: { httpStatus: 403 } });
      expect(hops['gateway.authorize'].decision).toMatchObject({ outcome: 'deny', by: 'Privilege agentless', source: 'inferred' });
    });

    test('tools/list in a denied session exposes one policy_denied tool and never reaches the upstream', async () => {
      const init = await initDenied();
      const sid = init.headers['mcp-session-id'];
      const before = seen.length;
      const res = await request(app()).post('/mcp-facade/agentless/mcp').set('Authorization', AUTH).set('mcp-session-id', sid)
        .send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
      expect(res.status).toBe(200);
      expect(res.body.result.tools).toEqual([expect.objectContaining({ name: 'policy_denied', description: expect.stringMatching(/^You have been denied by Policy\./) })]);
      expect(seen.length).toBe(before);
    });

    test('tools/call in a denied session answers "You have been denied by Policy." with the reel block, on the session reel', async () => {
      const init = await initDenied();
      const sid = init.headers['mcp-session-id'];
      ledger.appendHop.mockClear();
      const res = await request(app()).post('/mcp-facade/agentless/mcp').set('Authorization', AUTH).set('mcp-session-id', sid)
        .send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'search', arguments: { q: 'x' } } });
      expect(res.status).toBe(200);
      expect(res.body.result.isError).toBe(true);
      expect(res.body.result.content[0].text).toMatch(/^You have been denied by Policy\. Privilege agentless refused initialize: User b1645e7b/);
      expect(res.body.result.content[1].text).toMatch(/^reel_url: /);
      const phases = ledger.appendHop.mock.calls.map(([, h]) => h.phase);
      expect(phases).toEqual(['ui.request', 'gateway.authorize', 'mcp.tool', 'response']);
      expect(new Set(ledger.appendHop.mock.calls.map(([id]) => id)).size).toBe(1);
      expect(hopsByPhase()['gateway.authorize'].decision.outcome).toBe('deny');
    });
  });

  test('GET /mcp is not offered through the façade', async () => {
    const res = await request(app()).get('/mcp-facade/agent-gateway/mcp');
    expect(res.status).toBe(405);
  });

  test('403 on tools/call becomes an isError tool result that says "You have been denied by Policy."', async () => {
    const a = app();
    const res = await request(a).post('/mcp-facade/agentless/mcp').set('Authorization', AUTH).set('mcp-session-id', 'sess-1')
      .send({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'get_sensitive_account_details', arguments: {} } });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.id).toBe(7);
    expect(res.body.result.isError).toBe(true);
    const [msg, reel] = res.body.result.content;
    expect(msg.type).toBe('text');
    expect(msg.text).toMatch(/^You have been denied by Policy\.\n/);
    expect(msg.text).toContain('Privilege agentless refused get_sensitive_account_details: policy: sensitive:read not granted');
    expect(reel.text).toMatch(/^reel_url: /);
    expect(reel.text).toMatch(/!\[Transaction trace\]\(http:\/\/127\.0\.0\.1:\d+\/mcp-facade\/reel\/[0-9a-f-]{36}\.svg\)/);
    // the reel records the denial
    const hops = hopsByPhase();
    expect(hops['gateway.authorize'].decision).toMatchObject({ outcome: 'deny', source: 'inferred', reason: 'HTTP 403' });
    expect(hops['mcp.tool']).toMatchObject({ status: 'error', details: { httpStatus: 403 } });
    expect(hops.response).toMatchObject({ status: 'error', details: { httpStatus: 403 } });
  });

  test('401 on tools/call still passes through (the client must re-authenticate)', async () => {
    const res = await request(app()).post('/mcp-facade/agentless/mcp')
      .send({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'get_my_accounts', arguments: {} } });
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toMatch(/resource_metadata=/);
  });
});

describe('/mcp-facade — session eviction', () => {
  const { sessions, MAX_SESSIONS } = router.__test;

  test('overflow evicts a cid-less entry first, so an established reel survives', async () => {
    sessions.set('keep-me', { cid: 'keep-me-cid', client: null, server: null, capabilities: null, tools: null, resources: null });
    for (let i = 0; i < MAX_SESSIONS; i++) {
      await request(app()).post('/mcp-facade/agent-gateway/mcp').set('Authorization', AUTH).set('mcp-session-id', `s${i}`)
        .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    }
    expect(sessions.get('keep-me')).toMatchObject({ cid: 'keep-me-cid' });
    expect(sessions.size).toBeLessThanOrEqual(MAX_SESSIONS);
  });

  test('when every entry already has a cid, the newcomer survives and the oldest established entry is evicted', async () => {
    for (let i = 0; i < MAX_SESSIONS; i++) {
      sessions.set(`old${i}`, { cid: `cid-${i}`, client: null, server: null, capabilities: null, tools: null, resources: null });
    }
    const oldestKey = sessions.keys().next().value;
    // 'sess-1' is what the stub upstream always assigns, so the inbound id and
    // the upstream-issued id match — no second, unrelated session gets created
    // mid-request.
    await request(app()).post('/mcp-facade/agent-gateway/mcp').set('Authorization', AUTH).set('mcp-session-id', 'sess-1')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(sessions.has('sess-1')).toBe(true);
    expect(sessions.has(oldestKey)).toBe(false);
    expect(sessions.size).toBe(MAX_SESSIONS);
  });

  test('bound never exceeds MAX_SESSIONS under repeated cid-less churn', async () => {
    const a = app();
    for (let i = 0; i < MAX_SESSIONS + 20; i++) {
      await request(a).post('/mcp-facade/agent-gateway/mcp').set('Authorization', AUTH).set('mcp-session-id', `churn${i}`)
        .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
      expect(sessions.size).toBeLessThanOrEqual(MAX_SESSIONS);
    }
  }, 60000);
});

describe('/mcp-facade/reel/:correlationId.svg', () => {
  const RECORD = {
    correlationId: 'cid-svg', startedAt: 't', endedAt: 't', principal: 'u',
    hops: [{ seq: 1, phase: 'mcp.tool', service: 'mcp-facade', op: 'get_my_accounts', status: 'ok', durationMs: 5 }],
  };

  beforeEach(() => { configStore.getEffective.mockReturnValue('true'); });

  test('renders the record as image/svg+xml with no-store', async () => {
    assemble.mockResolvedValue(RECORD);
    const res = await request(app()).get('/mcp-facade/reel/cid-svg.svg');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/svg\+xml/);
    expect(res.headers['cache-control']).toBe('no-store');
    // supertest/superagent buffers image/* mime types as a Buffer (res.body),
    // not res.text — res.text is undefined for this content type.
    expect(res.body.toString()).toContain('get_my_accounts');
    expect(assemble).toHaveBeenCalledWith('cid-svg');
  });

  test('unknown id → 200 waiting frame (an <img> cannot show a JSON 404)', async () => {
    assemble.mockResolvedValue(null);
    const res = await request(app()).get('/mcp-facade/reel/nope.svg');
    expect(res.status).toBe(200);
    expect(res.body.toString()).toContain('Waiting for the first hop');
  });

  test('ledger feature off → 200 frame that says so', async () => {
    configStore.getEffective.mockReturnValue('false');
    const res = await request(app()).get('/mcp-facade/reel/cid-svg.svg');
    expect(res.status).toBe(200);
    expect(res.body.toString()).toContain('ff_transaction_ledger');
    expect(assemble).not.toHaveBeenCalled();
  });
});
