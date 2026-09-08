'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DOOR_STORE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-gateway-client-test-'));
process.env.GATEWAY_ENV_PATH = path.join(process.env.DOOR_STORE_DIR, 'gateway.env');

const express = require('express');
const relay = require('./lib/relay');

function startServer() {
  const app = express();
  app.use('/api/gateway', relay);
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function withServer(fn) {
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    relay.__test.reset();
    await new Promise((resolve) => server.close(resolve));
  }
}

test('GET /state defaults to privilege mode with a Privilege door preset', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/gateway/state`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.gatewayMode, 'privilege');
    assert.ok(body.presets.some((p) => p.mode === 'privilege' && p.url.includes('/mcp')));
    assert.equal(body.oauth.authenticated, false);
  });
});

test('Direct mode also ships a working default (the demo façade), not an empty URL', async () => {
  await withServer(async (base) => {
    const body = await (await fetch(`${base}/api/gateway/state`)).json();
    const directPreset = body.presets.find((p) => p.mode === 'direct');
    assert.ok(directPreset, 'no Direct preset in /state');
    assert.ok(directPreset.url, 'Direct mode has no default URL — regressed to the old "bring your own" default');
    assert.match(directPreset.url, /^https:\/\//);
  });
});

test('POST /config switches mode and persists a per-door mcpUrl', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/gateway/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gatewayMode: 'direct', mcpUrl: 'https://example.com/mcp' }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.gatewayMode, 'direct');
    assert.equal(body.config.mcpUrl, 'https://example.com/mcp');

    const state = await (await fetch(`${base}/api/gateway/state`)).json();
    assert.equal(state.gatewayMode, 'direct');
    assert.equal(state.config.mcpUrl, 'https://example.com/mcp');
  });
});

test('tools/list and tools/call 401 without a token', async () => {
  await withServer(async (base) => {
    const list = await fetch(`${base}/api/gateway/tools/list`, { method: 'POST' });
    assert.equal(list.status, 401);
    const call = await fetch(`${base}/api/gateway/tools/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'echo', arguments: {} }),
    });
    assert.equal(call.status, 401);
  });
});

test('a Bearer token on any request seeds session.oauth so tools/list is no longer 401-blocked on auth', async () => {
  await withServer(async (base) => {
    // Point at an unreachable URL so the call fails at the network hop, not
    // the auth guard — proves the guard passed.
    await fetch(`${base}/api/gateway/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gatewayMode: 'direct', mcpUrl: 'http://127.0.0.1:1' }),
    });
    const res = await fetch(`${base}/api/gateway/tools/list`, {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token-123' },
    });
    assert.notEqual(res.status, 401);
  });
});

test('GET/PUT /env round-trips allowed keys and merges rather than overwriting', async () => {
  await withServer(async (base) => {
    await fetch(`${base}/api/gateway/env`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vars: { OIDC_CLIENT_ID: 'abc', not_allowed: 'x' } }),
    });
    const first = await (await fetch(`${base}/api/gateway/env`)).json();
    assert.equal(first.vars.OIDC_CLIENT_ID, 'abc');
    assert.equal(first.vars.not_allowed, undefined);

    await fetch(`${base}/api/gateway/env`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vars: { OIDC_CLIENT_SECRET: 'shh' } }),
    });
    const second = await (await fetch(`${base}/api/gateway/env`)).json();
    // Previously written key survives a partial update.
    assert.equal(second.vars.OIDC_CLIENT_ID, 'abc');
    assert.equal(second.vars.OIDC_CLIENT_SECRET, 'shh');
  });
});

test('POST /console/connect requires an authToken', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/api/gateway/console/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
  });
});
