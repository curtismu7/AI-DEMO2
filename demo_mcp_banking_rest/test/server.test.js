'use strict';

// The banking routes proxy to BANKING_UPSTREAM_URL, while /users and its
// OpenAPI document are self-contained for Privilege discovery testing. These
// tests use a tiny fake upstream (no real mcp-resource-server needed).
//
// Run: node --test demo_mcp_banking_rest/test/

const assert = require('node:assert');
const { test } = require('node:test');
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');

const SERVER = path.join(__dirname, '..', 'server.js');

function withFakeUpstream(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler);
    srv.listen(0, () => resolve(srv));
  });
}

async function withServer(upstreamPort, fn, env = {}) {
  const port = 18099;
  const child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      PORT: String(port),
      BANKING_UPSTREAM_URL: `http://127.0.0.1:${upstreamPort}`,
      BANKING_API_KEY: 'test-key',
      ...env,
    },
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

test('GET /banking forwards to the upstream with X-API-Key attached', async () => {
  let seenPath, seenKey;
  const upstream = await withFakeUpstream((req, res) => {
    seenPath = req.url;
    seenKey = req.headers['x-api-key'];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ accounts: [], count: 0 }));
  });
  try {
    await withServer(upstream.address().port, async (base) => {
      const res = await fetch(`${base}/banking`);
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(await res.json(), { accounts: [], count: 0 });
      assert.strictEqual(seenPath, '/banking');
      assert.strictEqual(seenKey, 'test-key');
    });
  } finally {
    upstream.close();
  }
});

test('GET /banking/:id forwards the id in the path with X-API-Key attached', async () => {
  let seenPath, seenKey;
  const upstream = await withFakeUpstream((req, res) => {
    seenPath = req.url;
    seenKey = req.headers['x-api-key'];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ found: true }));
  });
  try {
    await withServer(upstream.address().port, async (base) => {
      const res = await fetch(`${base}/banking/acct-001`);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(seenPath, '/banking/acct-001');
      assert.strictEqual(seenKey, 'test-key');
    });
  } finally {
    upstream.close();
  }
});

test('GET /openapi/banking-rest.json forwards WITHOUT X-API-Key', async () => {
  let seenKey = 'unset';
  const upstream = await withFakeUpstream((req, res) => {
    seenKey = req.headers['x-api-key'];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ openapi: '3.0.3' }));
  });
  try {
    await withServer(upstream.address().port, async (base) => {
      const res = await fetch(`${base}/openapi/banking-rest.json`);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(seenKey, undefined);
    });
  } finally {
    upstream.close();
  }
});

test('GET /users returns the self-contained sample users without calling upstream', async () => {
  let upstreamCalls = 0;
  const upstream = await withFakeUpstream((req, res) => {
    upstreamCalls += 1;
    res.writeHead(500);
    res.end();
  });
  try {
    await withServer(upstream.address().port, async (base) => {
      const res = await fetch(`${base}/users`);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers.get('content-type'), 'application/json');
      assert.deepStrictEqual(await res.json(), [{ id: 101, name: 'Jane Doe' }]);
      assert.strictEqual(upstreamCalls, 0);
    });
  } finally {
    upstream.close();
  }
});

test('GET /openapi/simple-users.json describes the local listUsers operation', async () => {
  const upstream = await withFakeUpstream((req, res) => res.end());
  try {
    await withServer(upstream.address().port, async (base) => {
      const res = await fetch(`${base}/openapi/simple-users.json`);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers.get('content-type'), 'application/json');

      const spec = await res.json();
      assert.strictEqual(spec.openapi, '3.0.3');
      assert.deepStrictEqual(spec.servers, [{ url: 'http://localhost:8082' }]);
      assert.strictEqual(spec.paths['/users'].get.operationId, 'listUsers');
      assert.strictEqual(
        spec.paths['/users'].get.responses['200'].content['application/json'].schema.type,
        'array',
      );
    });
  } finally {
    upstream.close();
  }
});

test('passes through a non-200 upstream status (e.g. 401)', async () => {
  const upstream = await withFakeUpstream((req, res) => {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'api_key_invalid' }));
  });
  try {
    await withServer(upstream.address().port, async (base) => {
      const res = await fetch(`${base}/banking`);
      assert.strictEqual(res.status, 401);
    });
  } finally {
    upstream.close();
  }
});

test('502s with a clear message when BANKING_UPSTREAM_URL is unreachable', async () => {
  const upstream = await withFakeUpstream((req, res) => res.end());
  const deadPort = upstream.address().port;
  await new Promise((resolve) => upstream.close(resolve));
  await withServer(deadPort, async (base) => {
    const res = await fetch(`${base}/banking`);
    assert.strictEqual(res.status, 502);
    const body = await res.json();
    assert.strictEqual(body.error, 'upstream_unreachable');
  });
});

test('/health reports configuration without leaking the key', async () => {
  const upstream = await withFakeUpstream((req, res) => res.end());
  try {
    await withServer(upstream.address().port, async (base) => {
      const body = await (await fetch(`${base}/health`)).json();
      assert.deepStrictEqual(body, { ok: true, hasUpstream: true, hasKey: true });
    });
  } finally {
    upstream.close();
  }
});
