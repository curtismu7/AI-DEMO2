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

test('Direct mode ships both the opensearch default and the Brave sibling at their exact URLs', async () => {
  await withServer(async (base) => {
    const body = await (await fetch(`${base}/api/gateway/state`)).json();
    const directPresets = body.presets.filter((p) => p.mode === 'direct');
    assert.equal(directPresets.length, 2, 'expected exactly 2 Direct presets (opensearch default + Brave sibling)');

    const opensearch = directPresets.find((p) => p.label === '2 · Direct — no Privilege in the path');
    assert.ok(opensearch, 'no Direct opensearch-default preset in /state');
    assert.equal(opensearch.url, 'https://ai-demo.ping-devops.com/mcp-facade/opensearch/mcp');

    const brave = directPresets.find((p) => p.label === 'Direct — Brave Search');
    assert.ok(brave, 'no Direct Brave preset in /state — regressed, the new sibling disappeared');
    assert.equal(brave.url, 'https://ai-demo.ping-devops.com/mcp-facade/brave/mcp');
  });
});

test('DIRECT_MCP_URL and DIRECT_BRAVE_MCP_URL override the Direct presets independently', async () => {
  const prevMcp = process.env.DIRECT_MCP_URL;
  const prevBrave = process.env.DIRECT_BRAVE_MCP_URL;
  process.env.DIRECT_MCP_URL = 'https://example.com/custom-opensearch/mcp';
  process.env.DIRECT_BRAVE_MCP_URL = 'https://example.com/custom-brave/mcp';
  try {
    await withServer(async (base) => {
      const body = await (await fetch(`${base}/api/gateway/state`)).json();
      const directPresets = body.presets.filter((p) => p.mode === 'direct');
      assert.equal(directPresets.length, 2);
      assert.equal(
        directPresets.find((p) => p.label === '2 · Direct — no Privilege in the path').url,
        'https://example.com/custom-opensearch/mcp',
      );
      assert.equal(
        directPresets.find((p) => p.label === 'Direct — Brave Search').url,
        'https://example.com/custom-brave/mcp',
      );
    });
  } finally {
    if (prevMcp === undefined) delete process.env.DIRECT_MCP_URL; else process.env.DIRECT_MCP_URL = prevMcp;
    if (prevBrave === undefined) delete process.env.DIRECT_BRAVE_MCP_URL; else process.env.DIRECT_BRAVE_MCP_URL = prevBrave;
  }
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
