'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function readIntegrationConfig({ env = process.env, serverDir = path.join(__dirname, '..') } = {}) {
  const token = env.AI_GATEWAY_TEST_TOKEN;
  if (typeof token !== 'string' || !token.trim()) throw new Error('AI_GATEWAY_TEST_TOKEN is required');
  const configPath = path.resolve(serverDir, env.AI_GATEWAY_TEST_CONFIG || 'integration/config.local.json');
  let fixture;
  try {
    fixture = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    // File paths and parser messages may contain secrets supplied by the operator.
    throw new Error('AI_GATEWAY_TEST_CONFIG must select a readable, valid JSON fixture');
  }
  const fields = ['allowed.url', 'allowed.tool.name', 'deniedDoor.url', 'filteredTool.url', 'filteredTool.name', 'aggregate.url', 'aggregate.tool.name'];
  for (const field of fields) {
    const value = field.split('.').reduce((obj, key) => obj?.[key], fixture);
    if (typeof value !== 'string' || !value.trim()) throw new Error(`Fixture field ${field} is required`);
    if (!field.endsWith('.url')) continue;
    let url;
    try { url = new URL(value); } catch { throw new Error(`Fixture field ${field} must be a valid HTTPS URL`); }
    const loopback = url.hostname === 'localhost' || url.hostname === '[::1]' || /^127\.\d+\.\d+\.\d+$/.test(url.hostname);
    const allowedHttp = env.AI_GATEWAY_ALLOW_HTTP_TEST_URLS === 'true' && url.protocol === 'http:' && loopback;
    if (!url.hostname || url.username || url.password || (url.protocol !== 'https:' && !allowedHttp)) {
      throw new Error(`Fixture field ${field} requires HTTPS without URL credentials (loopback HTTP requires AI_GATEWAY_ALLOW_HTTP_TEST_URLS=true)`);
    }
  }
  return { token, fixture };
}

async function withRelayServer(callback) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-relay-test-'));
  const previousEnv = { DOOR_STORE_DIR: process.env.DOOR_STORE_DIR, GATEWAY_ENV_PATH: process.env.GATEWAY_ENV_PATH };
  const modulePaths = [require.resolve('../lib/relay'), require.resolve('../lib/doorStore')];
  const previousModules = modulePaths.map((modulePath) => require.cache[modulePath]);
  let relay;
  let server;
  try {
    process.env.DOOR_STORE_DIR = tempDir;
    process.env.GATEWAY_ENV_PATH = path.join(tempDir, 'gateway.env');
    // Both modules capture paths at import time; each harness gets fresh storage.
    for (const modulePath of modulePaths) delete require.cache[modulePath];
    relay = require('../lib/relay');
    const app = require('express')();
    app.use('/api/gateway', relay);
    server = await new Promise((resolve, reject) => {
      const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
      listener.once('error', reject);
    });
    return await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    try {
      if (relay) {
        const session = relay.__test.getSession({ headers: {} });
        session.subscription.controller?.abort();
        session.eventStream.controller?.abort();
        relay.__test.reset();
      }
    } finally {
      try {
        if (server) await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
      } finally {
        for (const [key, value] of Object.entries(previousEnv)) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
        modulePaths.forEach((modulePath, index) => {
          if (previousModules[index]) require.cache[modulePath] = previousModules[index];
          else delete require.cache[modulePath];
        });
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  }
}

function postGateway(baseUrl, routePath, token, body) {
  return fetch(`${baseUrl}/api/gateway${routePath}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function configureDoor(baseUrl, url, token) {
  return postGateway(baseUrl, '/config', token, { gatewayMode: 'privilege', mcpUrl: url });
}

module.exports = { readIntegrationConfig, withRelayServer, configureDoor, postGateway };
