'use strict';

// The bridge's non-trivial logic is (a) the SSE endpoint handshake the Privilege
// AI Gateway depends on, and (b) id remapping between independent sessions.
// Both fail silently in ways that look like a broken upstream, so both are
// pinned here. A fake stdio child stands in for pingone-mcp-server so these
// tests need no binary, no network and no PingOne tenant.

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

// A fake "pingone-mcp-server": reads JSON-RPC lines on stdin, answers on stdout.
// Echoes the id it received so a broken remap shows up as a mismatched id.
const FAKE = `
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => {
  buf += c;
  let i;
  while ((i = buf.indexOf('\\n')) !== -1) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if (msg.method === 'initialize') {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { capabilities: { tools: {} }, serverInfo: { name: 'fake-pingone', version: '0.0.2' } } }) + '\\n');
    } else if (msg.method === 'tools/list') {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'list_applications' }, { name: 'create_oidc_application' }] } }) + '\\n');
    } else if (msg.method === 'tools/call') {
      // Deliberately SLOW and OUT OF ORDER. An instant reply lets each call
      // finish before the next starts, so no two requests are ever in flight
      // together and an id collision can never occur — the test would pass
      // even with remapping removed. Real PingOne API calls take hundreds of
      // ms and finish in whatever order they finish.
      const delay = (msg.params && msg.params.name) === 'list_applications' ? 120 : 20;
      setTimeout(() => {
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { echoedTool: msg.params && msg.params.name } }) + '\\n');
      }, delay);
    }
  }
});
`;

let binPath;
let sessionPath;
let server;
let shutdown;
let base;

before(async () => {
  binPath = path.join(os.tmpdir(), `fake-pingone-${process.pid}.js`);
  fs.writeFileSync(binPath, FAKE);
  process.env.PINGONE_MCP_BIN = process.execPath;
  process.env.PINGONE_MCP_ARGS = binPath;
  process.env.PORT = '0';
  // A session file that is already fresh, so ensureSession() is a no-op and
  // these tests need no PingOne credentials and make no network call.
  sessionPath = path.join(os.tmpdir(), `fake-session-${process.pid}.json`);
  fs.writeFileSync(sessionPath, JSON.stringify({
    accessToken: 'test-token',
    refreshToken: '',
    expiry: new Date(Date.now() + 3600_000).toISOString(),
    sessionId: '00000000-0000-0000-0000-000000000001',
  }));
  process.env.PINGONE_MCP_SESSION_FILE = sessionPath;
  ({ server, shutdown } = require('../server'));
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  // The stdio child and the SSE keep-alive intervals both hold the event loop
  // open — without shutdown() the test process never exits.
  shutdown();
  server.close();
  try { fs.unlinkSync(binPath); } catch { /* already gone */ }
  try { fs.unlinkSync(sessionPath); } catch { /* already gone */ }
});

function post(urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(`${base}${urlPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      let out = '';
      res.on('data', (c) => { out += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: out ? JSON.parse(out) : null }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

test('GET /health reports the bridge is up', async () => {
  const res = await new Promise((resolve) => http.get(`${base}/health`, (r) => {
    let out = ''; r.on('data', (c) => { out += c; }); r.on('end', () => resolve({ status: r.statusCode, body: JSON.parse(out) }));
  }));
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
});

// THE reason this bridge exists. The gateway issues a bare GET and waits for an
// `endpoint` event; without it the console reports "Gateway Unreachable" and the
// app's tool list stays permanently empty.
test('GET /sse emits the endpoint event the Privilege gateway waits for', async () => {
  const frame = await new Promise((resolve, reject) => {
    const req = http.get(`${base}/sse`, (res) => {
      assert.equal(res.headers['content-type'], 'text/event-stream');
      res.on('data', (c) => { resolve(c.toString()); req.destroy(); });
    });
    req.on('error', (e) => { if (e.code !== 'ECONNRESET') reject(e); });
  });
  assert.match(frame, /^event: endpoint\ndata: \/messages\?sessionId=[0-9a-f-]{36}\n\n/);
});

// Catalog-added Privilege apps pin their backend to .../mcp and the field cannot
// be edited, so GET /mcp must answer the same handshake or those apps can never
// discover this server.
test('GET /mcp answers the same handshake, for catalog-pinned apps', async () => {
  const frame = await new Promise((resolve, reject) => {
    const req = http.get(`${base}/mcp`, (res) => {
      res.on('data', (c) => { resolve(c.toString()); req.destroy(); });
    });
    req.on('error', (e) => { if (e.code !== 'ECONNRESET') reject(e); });
  });
  assert.match(frame, /event: endpoint/);
});

test('initialize is answered by the bridge, not forwarded per session', async () => {
  const res = await post('/mcp', { jsonrpc: '2.0', id: 7, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
  assert.equal(res.status, 200);
  assert.equal(res.body.id, 7);
  assert.equal(res.body.result.serverInfo.name, 'demo-mcp-pingone-bridge');
});

test('tools/list reaches the stdio child and comes back', async () => {
  const res = await post('/mcp', { jsonrpc: '2.0', id: 11, method: 'tools/list', params: {} });
  assert.equal(res.status, 200);
  assert.equal(res.body.id, 11);
  assert.deepEqual(res.body.result.tools.map((t) => t.name), ['list_applications', 'create_oidc_application']);
});

// Two sessions independently choosing id 1 must not receive each other's reply.
// The bridge rewrites ids to a unique internal id and restores the caller's on
// the way back; without that this test cross-talks.
test('concurrent callers reusing the same id do not cross-talk', async () => {
  const [a, b] = await Promise.all([
    post('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_applications' } }),
    post('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'create_oidc_application' } }),
  ]);
  assert.equal(a.body.id, 1);
  assert.equal(b.body.id, 1);
  const echoed = [a.body.result.echoedTool, b.body.result.echoedTool].sort();
  assert.deepEqual(echoed, ['create_oidc_application', 'list_applications']);
});

test('a reply to an SSE session rides the stream, and the POST only ACKs', async () => {
  const { sessionId, stream } = await new Promise((resolve, reject) => {
    const req = http.get(`${base}/sse`, (res) => {
      res.on('data', (c) => {
        const m = c.toString().match(/sessionId=([0-9a-f-]{36})/);
        if (m) resolve({ sessionId: m[1], stream: res });
      });
    });
    req.on('error', reject);
  });
  const framePromise = new Promise((resolve) => {
    stream.on('data', (c) => {
      const s = c.toString();
      if (s.includes('event: message')) resolve(s);
    });
  });
  const ack = await post(`/messages?sessionId=${sessionId}`, { jsonrpc: '2.0', id: 42, method: 'tools/list', params: {} });
  assert.equal(ack.status, 202, 'the POST is an ACK only');
  const frame = await framePromise;
  const payload = JSON.parse(frame.slice(frame.indexOf('data: ') + 6).split('\n')[0]);
  assert.equal(payload.id, 42);
  assert.equal(payload.result.tools.length, 2);
});

// The gateway forwards JSON-RPC POSTs to whatever path the Agentic App was
// registered with. Registered as .../sse, it POSTs to /sse -- not /messages.
// Handling only GET there returned our own 404 for every call, which reads as a
// missing app on the gateway rather than a gap in this bridge.
test('POST /sse is answered like streamable HTTP, not 404', async () => {
  const res = await post('/sse', { jsonrpc: '2.0', id: 21, method: 'tools/list', params: {} });
  assert.equal(res.status, 200);
  assert.equal(res.body.id, 21);
  assert.equal(res.body.result.tools.length, 2);
});

test('an unknown SSE session is named as such, not passed off as a server fault', async () => {
  const res = await post('/messages?sessionId=00000000-0000-0000-0000-000000000000', { jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.equal(res.status, 404);
  assert.match(res.body.error, /Unknown or closed SSE session/);
});
