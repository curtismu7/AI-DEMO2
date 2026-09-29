'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {
  assertInteractiveTerminal,
  waitForAuthenticatedSession,
  signInInteractively,
  runInteractiveIntegration,
  formatInteractiveFailure,
} = require('./interactive');
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.example.json'), 'utf8'));

async function withGatewayMock(callback) {
  const calls = [];
  let authenticated = false;
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const bodyText = Buffer.concat(chunks).toString();
    calls.push({ method: req.method, url: req.url, authorization: req.headers.authorization, body: bodyText });

    if (req.url === '/api/gateway/config') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end('{"ok":true}');
    }
    if (req.url === '/api/gateway/auth/start') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end('{"authUrl":"https://gateway.example.test/authorize?state=one-time-state"}');
    }
    if (req.url === '/api/gateway/state') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ oauth: { authenticated } }));
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await callback(`http://127.0.0.1:${server.address().port}`, calls, {
      setAuthenticated: () => { authenticated = true; },
    });
  } finally {
    await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
}

test('interactive sign-in refuses a non-TTY before starting authorization', () => {
  assert.throws(() => assertInteractiveTerminal(false), /requires a TTY/);
  assert.doesNotThrow(() => assertInteractiveTerminal(true));
});

test('interactive command rejects a non-TTY before reading config or starting the relay', async () => {
  const calls = [];
  await assert.rejects(runInteractiveIntegration({
    isTTY: false,
    readConfig: () => { calls.push('config'); return { fixture }; },
    startRelay: async () => { calls.push('relay'); },
  }), /requires a TTY/);
  assert.deepEqual(calls, []);
});

test('waits for the relay callback to report an authenticated session', async () => {
  const responses = [
    { oauth: { authenticated: false } },
    { oauth: { authenticated: true } },
  ];
  const requested = [];
  await waitForAuthenticatedSession('http://127.0.0.1:3910', {
    fetchImpl: async (url) => {
      requested.push(url);
      return { ok: true, json: async () => responses.shift() };
    },
    timeoutMs: 100,
    intervalMs: 1,
    sleep: async () => {},
  });
  assert.deepEqual(requested, [
    'http://127.0.0.1:3910/api/gateway/state',
    'http://127.0.0.1:3910/api/gateway/state',
  ]);
});

test('sign-in wait times out with a safe message when the callback never arrives', async () => {
  let now = 0;
  let requests = 0;
  await assert.rejects(waitForAuthenticatedSession('http://127.0.0.1:3910', {
    fetchImpl: async () => {
      requests += 1;
      return { ok: true, json: async () => ({ oauth: { authenticated: false } }) };
    },
    timeoutMs: 10,
    intervalMs: 5,
    now: () => now,
    sleep: async (delay) => { now += delay; },
  }), (err) => {
    assert.match(err.message, /Timed out waiting for Gateway sign-in/);
    assert.ok(!err.message.includes('dummy-private-test-token'));
    return true;
  });
  assert.equal(requests, 3);
});

test('sign-in status failures do not echo fetch errors', async () => {
  await assert.rejects(waitForAuthenticatedSession('http://127.0.0.1:3910', {
    fetchImpl: async () => { throw new Error('response contained dummy-private-test-token'); },
    timeoutMs: 1,
  }), (err) => {
    assert.match(err.message, /Could not check local Gateway sign-in status/);
    assert.ok(!err.message.includes('dummy-private-test-token'));
    return true;
  });
});

test('interactive sign-in uses the relay session without bearer headers or token output', async () => {
  await withGatewayMock(async (baseUrl, calls, session) => {
    let promptUrl;
    const token = await signInInteractively({
      baseUrl,
      fixture,
      getAccessToken: () => 'dummy-private-test-token',
      prompt: async (url) => {
        promptUrl = url;
        session.setAuthenticated();
      },
    });

    assert.equal(token, 'dummy-private-test-token');
    assert.equal(promptUrl, 'https://gateway.example.test/authorize?state=one-time-state');
    assert.ok(calls.every((call) => call.authorization === undefined), 'local login setup must not send a copied bearer');
    assert.deepEqual(calls.map(({ method, url }) => ({ method, url })), [
      { method: 'POST', url: '/api/gateway/config' },
      { method: 'POST', url: '/api/gateway/auth/start' },
      { method: 'GET', url: '/api/gateway/state' },
    ]);
    assert.deepEqual(JSON.parse(calls[0].body), {
      gatewayMode: 'privilege',
      mcpUrl: fixture.allowed.url,
    });
    assert.deepEqual(JSON.parse(calls[1].body), { returnTo: '/integration/auth-complete' });
  });
});


test('interactive mode ignores a pre-provisioned token setting', () => {
  const { readIntegrationConfig } = require('./support');
  const env = { AI_GATEWAY_TEST_CONFIG: 'integration/config.example.json' };
  Object.defineProperty(env, 'AI_GATEWAY_TEST_TOKEN', {
    get() { throw new Error('interactive mode must not read a copied token'); },
  });
  assert.equal(readIntegrationConfig({ env, requireToken: false }).token, null);
});

test('URL instructions do not wait for terminal input before polling', async () => {
  const { promptForSignIn } = require('./interactive');
  const { PassThrough } = require('node:stream');
  const output = new PassThrough();
  let text = '';
  output.on('data', (chunk) => { text += chunk; });
  const input = new PassThrough();
  try {
    await Promise.race([
      promptForSignIn('https://gateway.example.test/authorize', { input, output }),
      new Promise((_resolve, reject) => setTimeout(() => reject(new Error('URL prompt blocked on input')), 25)),
    ]);
  } finally { input.end(); }
  assert.match(text, /https:\/\/gateway.example.test\/authorize/);
});

test('interactive CLI reports the safe assertion summary without response details', () => {
  const error = new assert.AssertionError({
    message: 'allowed app tools/list must succeed\nBearer dummy-private-test-token',
    actual: 403,
    expected: 200,
    operator: 'strictEqual',
  });
  const message = formatInteractiveFailure?.(error);
  assert.equal(message, 'Interactive live Gateway check failed: allowed app tools/list must succeed\n');
  assert.ok(!message.includes('dummy-private-test-token'));
});

test('interactive CLI hides unexpected failure details', () => {
  const message = formatInteractiveFailure?.(new Error('response leaked dummy-private-test-token'));
  assert.equal(message, 'Interactive live Gateway integration failed. Check the TTY, fixture, browser sign-in, and staging connectivity.\n');
  assert.ok(!message.includes('dummy-private-test-token'));
});


test('a stalled local state response cannot bypass the sign-in deadline', async () => {
  const server = http.createServer((_req, _res) => {});
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await assert.rejects(Promise.race([
      waitForAuthenticatedSession(`http://127.0.0.1:${server.address().port}`, { timeoutMs: 20 }),
      new Promise((_resolve, reject) => setTimeout(() => reject(new Error('status request exceeded the deadline')), 150)),
    ]), /Timed out waiting for Gateway sign-in/);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('invalid interactive fixture fails before relay startup', async () => {
  let relayStarted = false;
  await assert.rejects(runInteractiveIntegration({
    isTTY: true,
    readConfig: () => { throw new Error('Fixture field allowed.url is required'); },
    startRelay: async () => { relayStarted = true; },
  }), /Fixture field allowed.url/);
  assert.equal(relayStarted, false);
});

test('interactive command passes the memory bearer into shared checks in the relay scope', async () => {
  await withGatewayMock(async (baseUrl, _calls, session) => {
    let active = false;
    let checked = false;
    await runInteractiveIntegration({
      isTTY: true,
      readConfig: () => ({ fixture }),
      startRelay: async (callback) => {
        active = true;
        try { await callback(baseUrl, { getAccessToken: () => 'dummy-private-test-token' }); }
        finally { active = false; }
      },
      prompt: async () => session.setAuthenticated(),
      runChecks: async (options) => {
        assert.equal(active, true);
        assert.equal(options.baseUrl, baseUrl);
        assert.equal(options.fixture, fixture);
        assert.ok(options.token === 'dummy-private-test-token');
        checked = true;
      },
    });
    assert.equal(checked, true);
    assert.equal(active, false);
  });
});
