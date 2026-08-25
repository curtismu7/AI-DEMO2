'use strict';

jest.mock('../../services/lmdb/transactionLedger.lmdb', () => ({
  appendHop: jest.fn(),
}));

const http = require('http');
const express = require('express');
const request = require('supertest');
const ledger = require('../../services/lmdb/transactionLedger.lmdb');
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
      if (rpc.method === 'initialize') {
        return reply({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'stub-gw', version: '1' } });
      }
      if (rpc.method === 'tools/list') {
        return reply({ tools: [{ name: 'get_my_accounts', description: 'List my accounts', inputSchema: {} }] });
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
  process.env.MCP_FACADE_REEL_BASE = 'https://ui.example';
});

afterAll(() => new Promise((r) => upstream.close(r)));

beforeEach(() => {
  jest.clearAllMocks();
  seen = [];
  router.__test.sessions.clear();
});

function app() {
  const a = express();
  a.use('/mcp-facade', router);
  return a;
}

const CLAIMS = { sub: 'user-1', scope: 'read mcp:invoke', aud: 'mcpgateway.ping.demo', client_id: 'c1' };
const AUTH = `Bearer e30.${Buffer.from(JSON.stringify(CLAIMS)).toString('base64url')}.sig`;

function hopsByPhase() {
  return Object.fromEntries(ledger.appendHop.mock.calls.map(([, h]) => [h.phase, h]));
}

async function runSession(door) {
  const a = app();
  const init = await request(a).post(`/mcp-facade/${door}/mcp`).set('Authorization', AUTH)
    .send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'LM Studio', version: '0.4' } } });
  const sid = init.headers['mcp-session-id'];
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

  test('the Priv-Agent door advertises no authorization server (the agent is the identity)', async () => {
    const res = await request(app()).get('/mcp-facade/agent/.well-known/oauth-protected-resource');
    expect(res.status).toBe(200);
    expect(res.body.authorization_servers).toBeUndefined();
  });

  test('unknown door → 404 listing the doors', async () => {
    const res = await request(app()).get('/mcp-facade/nope/.well-known/oauth-protected-resource');
    expect(res.status).toBe(404);
    expect(res.body.doors).toEqual(['agent-gateway', 'agentless', 'agent']);
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
    // first line machine-parseable, then the instruction that makes the model surface it
    expect(content[1].text).toMatch(/^reel_url: https:\/\/ui\.example\/transaction-trace\/embed\/[0-9a-f-]{36}\n/);
    expect(content[1].text).toMatch(/Always show this link to the user/);
    const cid = content[1].text.split('\n')[0].split('/').pop();

    // ui.request → mcp.tool → response, all on one correlation id, no inferred
    // gateway.authorize (the gateway records the real one itself).
    expect(ledger.appendHop.mock.calls.map(([id]) => id)).toEqual([cid, cid, cid]);
    const hops = hopsByPhase();
    expect(Object.keys(hops)).toEqual(['ui.request', 'mcp.tool', 'response']);
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

    // The gateway keys its own gateway.authorize hop by this header.
    const upstreamCall = seen.find((s) => s.rpc.method === 'tools/call');
    expect(upstreamCall.headers['x-correlation-id']).toBe(cid);
    expect(upstreamCall.headers.authorization).toBe(AUTH);
    expect(upstreamCall.headers['mcp-session-id']).toBe('sess-1');
  });

  test('non-tool calls pass through untouched (body, status, session header) and write no hops', async () => {
    const { init } = await runSession('agent-gateway');
    expect(init.body.result.serverInfo.name).toBe('stub-gw');
    const phases = ledger.appendHop.mock.calls.map(([, h]) => h.phase);
    expect(phases).not.toContain('initialize');
    expect(phases.filter((p) => p === 'ui.request')).toHaveLength(1);
  });

  test('Privilege doors add an inferred gateway.authorize hop (no policy trail to read)', async () => {
    await runSession('agentless');
    const hops = hopsByPhase();
    expect(Object.keys(hops)).toEqual(['ui.request', 'gateway.authorize', 'mcp.tool', 'response']);
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

  test('GET /mcp is not offered through the façade', async () => {
    const res = await request(app()).get('/mcp-facade/agent-gateway/mcp');
    expect(res.status).toBe(405);
  });
});
