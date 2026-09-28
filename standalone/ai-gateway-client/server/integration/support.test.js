'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readIntegrationConfig } = require('./support');
const token = 'dummy-private-test-token';
const example = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.example.json'), 'utf8'));
function withConfig(callback) {
  const serverDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-config-test-'));
  fs.mkdirSync(path.join(serverDir, 'integration'));
  const configPath = path.join(serverDir, 'integration/config.local.json');
  fs.writeFileSync(configPath, JSON.stringify(example));
  const env = { AI_GATEWAY_TEST_TOKEN: token };
  try { callback({ env, serverDir, configPath }); }
  finally { fs.rmSync(serverDir, { recursive: true, force: true }); }
}
function rejectsConfig(options, field) {
  assert.throws(() => readIntegrationConfig(options), (err) => {
    assert.ok(err.message.includes(field), `error must identify ${field}`);
    assert.ok(!err.message.includes(token), 'error must not disclose bearer');
    return true;
  });
}
test('requires the bearer environment variable', () => {
  withConfig(({ serverDir }) => {
    for (const value of [undefined, '', '   ']) rejectsConfig({ serverDir, env: { AI_GATEWAY_TEST_TOKEN: value } }, 'AI_GATEWAY_TEST_TOKEN');
  });
});
test('identifies the fixture setting when a file is missing or unreadable', () => {
  withConfig((options) => {
    fs.unlinkSync(options.configPath);
    rejectsConfig(options, 'AI_GATEWAY_TEST_CONFIG');
    options.env.AI_GATEWAY_TEST_CONFIG = options.serverDir;
    rejectsConfig(options, 'AI_GATEWAY_TEST_CONFIG');
  });
});
test('rejects malformed JSON without echoing its contents', () => {
  withConfig((options) => {
    fs.writeFileSync(options.configPath, `{ ${token}`);
    rejectsConfig(options, 'AI_GATEWAY_TEST_CONFIG');
  });
});
const requiredFields = ['allowed.url', 'allowed.tool.name', 'deniedDoor.url', 'filteredTool.url', 'filteredTool.name', 'aggregate.url', 'aggregate.tool.name'];
for (const field of requiredFields) {
  test(`requires a nonempty string for ${field}`, () => {
    withConfig((options) => {
      for (const value of [undefined, '', '  ', 42]) {
        const fixture = structuredClone(example);
        const keys = field.split('.');
        const parent = keys.slice(0, -1).reduce((obj, key) => obj[key], fixture);
        parent[keys.at(-1)] = value;
        fs.writeFileSync(options.configPath, JSON.stringify(fixture));
        rejectsConfig(options, field);
      }
    });
  });
}
test('rejects absent fixture sections and nonobject roots', () => {
  withConfig((options) => {
    for (const fixture of [null, [], {}, { allowed: null }]) {
      fs.writeFileSync(options.configPath, JSON.stringify(fixture));
      rejectsConfig(options, 'allowed.url');
    }
  });
});
for (const field of requiredFields.filter((field) => field.endsWith('.url'))) {
  test(`validates HTTPS and credentials for ${field}`, () => {
    withConfig((options) => {
      for (const url of ['http://127.0.0.1/mcp', 'ftp://example.test/mcp', 'file:///tmp/mcp', 'not-a-url', 'https://', `https://${token}@example.test/mcp`]) {
        const fixture = structuredClone(example);
        fixture[field.split('.')[0]].url = url;
        fs.writeFileSync(options.configPath, JSON.stringify(fixture));
        rejectsConfig(options, field);
      }
    });
  });
}
test('allows loopback HTTP only with the exact test opt-in', () => {
  withConfig((options) => {
    for (const host of ['127.0.0.1', '127.0.0.2', 'localhost', '[::1]']) {
      const fixture = structuredClone(example);
      fixture.allowed.url = `http://${host}:1234/mcp`;
      fs.writeFileSync(options.configPath, JSON.stringify(fixture));
      options.env.AI_GATEWAY_ALLOW_HTTP_TEST_URLS = 'true';
      assert.deepEqual(readIntegrationConfig(options), { token, fixture });
      options.env.AI_GATEWAY_ALLOW_HTTP_TEST_URLS = '1';
      rejectsConfig(options, 'allowed.url');
    }
    options.env.AI_GATEWAY_ALLOW_HTTP_TEST_URLS = 'true';
    for (const url of ['http://example.test/mcp', 'http://localhost.example.test/mcp', 'http://192.168.1.1/mcp', `http://${token}@127.0.0.1/mcp`]) {
      const fixture = structuredClone(example);
      fixture.allowed.url = url;
      fs.writeFileSync(options.configPath, JSON.stringify(fixture));
      rejectsConfig(options, 'allowed.url');
    }
  });
});
test('loads the default fixture relative to the server directory', () => {
  withConfig((options) => assert.deepEqual(readIntegrationConfig(options), { token, fixture: example }));
});
test('loads custom relative and absolute fixture paths', () => {
  withConfig((options) => {
    fs.renameSync(options.configPath, path.join(options.serverDir, 'custom.json'));
    for (const configPath of ['custom.json', path.join(options.serverDir, 'custom.json')]) {
      options.env.AI_GATEWAY_TEST_CONFIG = configPath;
      assert.deepEqual(readIntegrationConfig(options), { token, fixture: example });
    }
  });
});

const http = require('node:http');
const { configureDoor, postGateway, withRelayServer } = require('./support');
async function withEndpoint(handler, callback) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { await callback(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test('request helpers send the same bearer, JSON type, and requested body', async () => {
  const received = [];
  await withEndpoint(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    received.push({ method: req.method, url: req.url, authorization: req.headers.authorization,
      contentType: req.headers['content-type'], body: JSON.parse(Buffer.concat(chunks).toString()) });
    res.setHeader('Content-Type', 'application/json');
    res.end('{"ok":true}');
  }, async (base) => {
    assert.equal((await configureDoor(base, 'https://example.test/mcp', token)).status, 200);
    assert.equal((await postGateway(base, '/tools/call', token, { name: 'safe_read', arguments: {} })).status, 200);
  });
  // Do not let an assertion failure print the captured bearer value.
  assert.ok(received.every((req) => req.authorization === `Bearer ${token}`), 'every request must carry the exact bearer');
  for (const req of received) delete req.authorization;
  assert.deepEqual(received, [
    { method: 'POST', url: '/api/gateway/config', contentType: 'application/json', body: { gatewayMode: 'privilege', mcpUrl: 'https://example.test/mcp' } },
    { method: 'POST', url: '/api/gateway/tools/call', contentType: 'application/json', body: { name: 'safe_read', arguments: {} } },
  ]);
});

test('relay harness forwards the bearer to a loopback MCP endpoint', async () => {
  const received = [];
  await withEndpoint(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const rpc = JSON.parse(Buffer.concat(chunks).toString());
    received.push({ authorization: req.headers.authorization, method: rpc.method });
    res.setHeader('Content-Type', 'application/json');
    const result = rpc.method === 'server/discover'
      ? { supportedVersions: ['2026-07-28'], capabilities: { tools: {} } }
      : { tools: [{ name: 'safe_read' }] };
    res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }));
  }, async (mcpUrl) => {
    const result = await withRelayServer(async (base) => {
      const config = await configureDoor(base, mcpUrl, token);
      assert.equal(config.status, 200);
      const listed = await postGateway(base, '/tools/list', token, {});
      assert.equal(listed.status, 200);
      return listed.json();
    });
    assert.deepEqual(result.tools, [{ name: 'safe_read' }]);
  });
  assert.deepEqual(received.map((req) => req.method), ['server/discover', 'tools/list']);
  assert.ok(received.every((req) => req.authorization === `Bearer ${token}`), 'MCP must receive the exact bearer');
});

for (const shouldThrow of [false, true]) {
  test(`relay harness resets and closes after callback ${shouldThrow ? 'failure' : 'success'}`, async () => {
    const oldDoorDir = process.env.DOOR_STORE_DIR;
    const oldEnvPath = process.env.GATEWAY_ENV_PATH;
    let relay;
    let base;
    let tempDir;
    const failure = new Error('intentional callback failure');
    const operation = withRelayServer(async (baseUrl) => {
      base = baseUrl;
      relay = require('../lib/relay');
      tempDir = path.dirname(process.env.GATEWAY_ENV_PATH);
      assert.notEqual(tempDir, path.join(os.homedir(), '.ai-gateway-client'));
      // Inventory proves doorStore captured the temporary path before import.
      require('../lib/doorStore').saveInventory({ applications: [], policies: [] });
      assert.ok(fs.existsSync(path.join(tempDir, 'doors.json')));
      const envResponse = await fetch(`${base}/api/gateway/env`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vars: { OIDC_CLIENT_ID: 'harness-test' } }),
      });
      assert.equal(envResponse.status, 200);
      assert.ok(fs.readFileSync(path.join(tempDir, 'gateway.env'), 'utf8').includes('OIDC_CLIENT_ID=harness-test'));
      await configureDoor(base, 'http://127.0.0.1:1/mcp', token);
      if (shouldThrow) throw failure;
      return 'callback-result';
    });
    if (shouldThrow) await assert.rejects(operation, (err) => err === failure);
    else assert.equal(await operation, 'callback-result');
    assert.equal(relay.__test.getSession({ headers: {} }).oauth.accessToken, null);
    assert.equal(fs.existsSync(tempDir), false);
    assert.equal(process.env.DOOR_STORE_DIR, oldDoorDir);
    assert.equal(process.env.GATEWAY_ENV_PATH, oldEnvPath);
    await assert.rejects(fetch(`${base}/api/gateway/state`));
    await withRelayServer(async (nextBase) => {
      const state = await (await fetch(`${nextBase}/api/gateway/state`)).json();
      assert.equal(state.oauth.authenticated, false);
      assert.notEqual(state.config.mcpUrl, 'http://127.0.0.1:1/mcp');
    });
  });
}
