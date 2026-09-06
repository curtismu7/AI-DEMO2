'use strict';

// Two things this server must not get wrong:
//  1. Privilege's AI Gateway discovers a backend with a GET and waits for the
//     SSE `endpoint` event. A catalog app's backend is pinned to .../mcp, so
//     discovery has to succeed on GET /mcp or the app can never be used.
//  2. The tool -> Grafana-API-path mapping, which is this server's only real
//     logic. It is checked without a Grafana behind it: the argument failures
//     are all decided before the outbound call.
//
// Run: node --test demo_mcp_grafana/test/

const assert = require('node:assert');
const { test } = require('node:test');
const { spawn } = require('node:child_process');
const path = require('node:path');

const SERVER = path.join(__dirname, '..', 'server.js');

async function withServer(fn, env = {}) {
  const port = 18098;
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, PORT: String(port), GRAFANA_URL: '', GRAFANA_SERVICE_ACCOUNT_TOKEN: '', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('server did not start')), 5000);
      child.stdout.on('data', (b) => {
        if (String(b).includes('listening')) { clearTimeout(timer); resolve(); }
      });
      child.on('error', reject);
    });
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    child.kill('SIGKILL');
  }
}

async function readUntil(body, predicate, timeoutMs = 5000) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value, { stream: true });
    const hit = predicate(buffered);
    if (hit) { reader.cancel().catch(() => {}); return hit; }
  }
  throw new Error(`timed out; saw: ${buffered.slice(0, 200)}`);
}

function rpc(base, message) {
  return fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, ...message }),
  }).then((r) => r.json());
}

test('GET /mcp answers the gateway handshake over SSE', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/mcp`, { headers: { Accept: 'text/event-stream' } });
    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/event-stream/);

    const match = await readUntil(res.body, (buf) => buf.match(/event: endpoint\r?\ndata: (\S+)/));
    assert.ok(match[1].startsWith('/messages?sessionId='), `endpoint was ${match[1]}`);
  });
});

test('tools/list advertises the three read-only Grafana tools', async () => {
  await withServer(async (base) => {
    const body = await rpc(base, { method: 'tools/list' });
    const names = body.result.tools.map((t) => t.name).sort();
    assert.deepStrictEqual(names, [
      'grafana_get_dashboard',
      'grafana_list_datasources',
      'grafana_search_dashboards',
    ]);
  });
});

test('an unknown tool is rejected as method-not-found, not attempted', async () => {
  await withServer(async (base) => {
    const body = await rpc(base, { method: 'tools/call', params: { name: 'grafana_delete_everything', arguments: {} } });
    assert.strictEqual(body.error.code, -32601);
  });
});

test('grafana_get_dashboard without a uid fails on arguments, before any call', async () => {
  await withServer(async (base) => {
    const body = await rpc(base, { method: 'tools/call', params: { name: 'grafana_get_dashboard', arguments: {} } });
    // -32602 (bad params), NOT -32000 (the outbound call failed) — proves the
    // guard runs first and no half-formed request reaches Grafana.
    assert.strictEqual(body.error.code, -32602);
  });
});

test('a valid tool with no GRAFANA_URL configured says exactly that', async () => {
  await withServer(async (base) => {
    const body = await rpc(base, { method: 'tools/call', params: { name: 'grafana_list_datasources', arguments: {} } });
    assert.strictEqual(body.error.code, -32000);
    assert.match(body.error.message, /GRAFANA_URL is not set/);
  });
});

test('/health reports whether it is configured, without leaking the token', async () => {
  await withServer(
    async (base) => {
      const body = await (await fetch(`${base}/health`)).json();
      assert.deepStrictEqual(body, { ok: true, hasUrl: true, hasToken: true });
    },
    { GRAFANA_URL: 'http://grafana.example:3000', GRAFANA_SERVICE_ACCOUNT_TOKEN: 'glsa_secret' }
  );
});
