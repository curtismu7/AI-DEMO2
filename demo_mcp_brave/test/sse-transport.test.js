'use strict';

// The AI Gateway discovers a backend over the SSE transport: it GETs /sse and
// waits for an `endpoint` event, then POSTs JSON-RPC to the URL that event
// names and reads the reply off the stream. Serving only POST /mcp is why this
// server could not be registered as an Agentic App — the console reported
// `calling "initialize": Unauthorized` and its tool list stayed empty.
//
// Run: node --test demo_mcp_brave/test/

const assert = require('node:assert');
const { test } = require('node:test');
const { spawn } = require('node:child_process');
const path = require('node:path');

const SERVER = path.join(__dirname, '..', 'server.js');

async function withServer(fn) {
  const port = 18897;
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, PORT: String(port) },
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

// Read SSE frames off the stream until `predicate` is satisfied.
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

test('GET /sse announces the endpoint the client must POST to', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/sse`, { headers: { Accept: 'text/event-stream' } });
    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/event-stream/);

    const match = await readUntil(res.body, (buf) => buf.match(/event: endpoint\r?\ndata: (\S+)/));
    assert.ok(match[1].startsWith('/messages?sessionId='), `endpoint was ${match[1]}`);
  });
});

// Reads frames from ONE stream across several awaits — the reply to a POST
// arrives on the same connection that announced the endpoint, so the reader has
// to survive between them.
function frameReader(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  return {
    async until(predicate, timeoutMs = 5000) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const hit = predicate(buffered);
        if (hit) return hit;
        if (Date.now() > deadline) throw new Error(`timed out; saw: ${buffered.slice(0, 200)}`);
        const { value, done } = await reader.read();
        if (done) throw new Error('stream closed early');
        buffered += decoder.decode(value, { stream: true });
      }
    },
    close: () => reader.cancel().catch(() => {}),
  };
}

test('a JSON-RPC POST is acked with 202 and answered on the same stream', async () => {
  await withServer(async (base) => {
    const sse = await fetch(`${base}/sse`, { headers: { Accept: 'text/event-stream' } });
    const frames = frameReader(sse.body);
    const endpoint = (await frames.until((b) => b.match(/data: (\/messages\S+)/)))[1];

    const post = await fetch(`${base}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 42, method: 'tools/list' }),
    });
    // The POST is only an ACK in this transport — the payload must NOT be here.
    assert.strictEqual(post.status, 202);
    assert.strictEqual(await post.text(), '');

    const reply = (await frames.until((b) => b.match(/event: message\r?\ndata: (\{.*\})/)))[1];
    const parsed = JSON.parse(reply);
    assert.strictEqual(parsed.id, 42);
    assert.ok(Array.isArray(parsed.result.tools) && parsed.result.tools.length > 0);
    frames.close();
  });
});

test('each GET /sse gets its own session', async () => {
  await withServer(async (base) => {
    const a = await fetch(`${base}/sse`, { headers: { Accept: 'text/event-stream' } });
    const b = await fetch(`${base}/sse`, { headers: { Accept: 'text/event-stream' } });
    const epA = (await readUntil(a.body, (x) => x.match(/data: (\/messages\S+)/)))[1];
    const epB = (await readUntil(b.body, (x) => x.match(/data: (\/messages\S+)/)))[1];
    // Otherwise two clients would read each other's replies.
    assert.notStrictEqual(epA, epB);
  });
});

test('POST /messages with an unknown session says so instead of hanging', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/messages?sessionId=not-a-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    assert.strictEqual(res.status, 404);
    const body = await res.json();
    assert.match(body.error, /Unknown or closed SSE session/);
  });
});

test('POST /mcp still answers directly — the existing transport is untouched', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/list' }),
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.id, 7);
    assert.ok(Array.isArray(body.result.tools) && body.result.tools.length > 0);
  });
});

test('a notification gets 202 and no body, on both transports', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
    assert.strictEqual(res.status, 202);
    assert.strictEqual(await res.text(), '');
  });
});
