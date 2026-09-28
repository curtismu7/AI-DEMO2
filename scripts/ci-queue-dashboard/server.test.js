'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const { createDashboardServer } = require('./server');

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

function requestWithHost(baseUrl, host) {
  const url = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: url.hostname, port: url.port, path: '/api/snapshot', headers: { host } }, (response) => {
      response.resume();
      response.once('end', () => resolve({ status: response.statusCode }));
    });
    request.once('error', reject);
    request.end();
  });
}

test('GET /api/snapshot returns the injected normalized snapshot without CORS', async (t) => {
  const snapshot = { repository: 'cmuir_pingcorp/AI-DEMO2', summary: { queued: 1 }, runs: [] };
  const server = createDashboardServer({ getSnapshot: async () => snapshot });
  const baseUrl = await listen(server);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(`${baseUrl}/api/snapshot`);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.deepEqual(await response.json(), snapshot);
});

test('snapshot endpoint rejects foreign Host and Origin headers', async (t) => {
  let calls = 0;
  const server = createDashboardServer({ getSnapshot: async () => { calls += 1; return {}; } });
  const baseUrl = await listen(server);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const badHost = await requestWithHost(baseUrl, 'attacker.example');
  const badOrigin = await fetch(`${baseUrl}/api/snapshot`, { headers: { Origin: 'https://attacker.example' } });

  assert.equal(badHost.status, 403);
  assert.equal(badOrigin.status, 403);
  assert.equal(calls, 0);
});

test('server exposes only GET routes and returns safe snapshot errors', async (t) => {
  const server = createDashboardServer({
    getSnapshot: async () => { throw Object.assign(new Error('token=do-not-return'), { code: 'GH_AUTH' }); },
  });
  const baseUrl = await listen(server);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const post = await fetch(`${baseUrl}/api/snapshot`, { method: 'POST' });
  const missing = await fetch(`${baseUrl}/unknown`);
  const failed = await fetch(`${baseUrl}/api/snapshot`);
  const failure = await failed.json();

  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET, HEAD');
  assert.equal(missing.status, 404);
  assert.equal(failed.status, 503);
  assert.equal(failure.error.code, 'GH_AUTH');
  assert.match(failure.error.message, /gh auth login/);
  assert.doesNotMatch(JSON.stringify(failure), /do-not-return/);
});

test('POST /api/actions forwards a supported run action without exposing process details', async (t) => {
  const actions = [];
  const server = createDashboardServer({
    getSnapshot: async () => ({ runs: [{ id: 41, status: 'queued', conclusion: null }] }),
    performAction: async (action) => { actions.push(action); return { ok: true }; },
  });
  const baseUrl = await listen(server);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(`${baseUrl}/api/actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'run', action: 'cancel', id: 41 }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(actions, [{ type: 'run', action: 'cancel', id: 41 }]);
});

test('POST /api/actions rejects runner controls when GitHub reports the runner busy', async (t) => {
  let runnerActions = 0;
  const server = createDashboardServer({
    getSnapshot: async () => ({}),
    getControlState: async () => ({ repository: 'owner/repo', runners: [{ id: 23, busy: true, localControlAvailable: true }] }),
    performRunnerAction: async () => { runnerActions += 1; },
  });
  const baseUrl = await listen(server);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(`${baseUrl}/api/actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'runner', action: 'pause', id: 23 }),
  });
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.equal(body.error.code, 'RUNNER_BUSY');
  assert.equal(runnerActions, 0);
});

test('POST /api/actions rejects unknown actions and malformed IDs before dispatch', async (t) => {
  let calls = 0;
  const server = createDashboardServer({
    getSnapshot: async () => ({}),
    performAction: async () => { calls += 1; },
  });
  const baseUrl = await listen(server);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const invalidAction = await fetch(`${baseUrl}/api/actions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'runner', action: 'delete', id: 23 }),
  });
  const invalidId = await fetch(`${baseUrl}/api/actions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'run', action: 'cancel', id: 'not-an-id' }),
  });

  assert.equal(invalidAction.status, 400);
  assert.equal(invalidId.status, 400);
  assert.equal(calls, 0);
});

test('POST /api/actions rejects foreign origins before dispatch', async (t) => {
  let calls = 0;
  const server = createDashboardServer({ getSnapshot: async () => ({ runs: [] }), performAction: async () => { calls += 1; } });
  const baseUrl = await listen(server);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(`${baseUrl}/api/actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://attacker.example' },
    body: JSON.stringify({ type: 'run', action: 'cancel', id: 41 }),
  });

  assert.equal(response.status, 403);
  assert.equal(calls, 0);
});

test('POST /api/actions allows a workflow pause only while its workflow is active', async (t) => {
  const actions = [];
  const server = createDashboardServer({
    getSnapshot: async () => ({}),
    getControlState: async () => ({ workflows: [{ id: 7, state: 'active' }], runners: [] }),
    performAction: async (action) => { actions.push(action); return { ok: true }; },
  });
  const baseUrl = await listen(server);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(`${baseUrl}/api/actions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'workflow', action: 'pause', id: 7 }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(actions, [{ type: 'workflow', action: 'pause', id: 7 }]);
});

test('POST /api/actions rejects workflow changes against stale state', async (t) => {
  let calls = 0;
  const server = createDashboardServer({
    getSnapshot: async () => ({}),
    getControlState: async () => ({ workflows: [{ id: 7, state: 'disabled_manually' }], runners: [] }),
    performAction: async () => { calls += 1; },
  });
  const baseUrl = await listen(server);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(`${baseUrl}/api/actions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'workflow', action: 'pause', id: 7 }),
  });

  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, 'ACTION_STALE');
  assert.equal(calls, 0);
});

test('POST /api/actions will not cancel a run that is absent from the fresh snapshot', async (t) => {
  let calls = 0;
  const server = createDashboardServer({
    getSnapshot: async () => ({ runs: [] }),
    performAction: async () => { calls += 1; },
  });
  const baseUrl = await listen(server);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(`${baseUrl}/api/actions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'run', action: 'cancel', id: 41 }),
  });
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.equal(body.error.code, 'ACTION_STALE');
  assert.equal(calls, 0);
});

test('GET /api/control-state returns current controls without enabling cross-origin access', async (t) => {
  const state = { repository: 'owner/repo', workflows: [], runners: [] };
  const server = createDashboardServer({ getSnapshot: async () => ({}), getControlState: async () => state });
  const baseUrl = await listen(server);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(`${baseUrl}/api/control-state`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), state);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});

test('server serves a page wired to local JavaScript and CSS assets', async (t) => {
  const server = createDashboardServer({ getSnapshot: async () => ({}) });
  const baseUrl = await listen(server);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const [pageResponse, modelResponse, scriptResponse, styleResponse] = await Promise.all([
    fetch(`${baseUrl}/`),
    fetch(`${baseUrl}/dashboard-model.js`),
    fetch(`${baseUrl}/dashboard.js`),
    fetch(`${baseUrl}/dashboard.css`),
  ]);
  const [page, model, script, style] = await Promise.all([
    pageResponse.text(),
    modelResponse.text(),
    scriptResponse.text(),
    styleResponse.text(),
  ]);

  assert.equal(pageResponse.status, 200);
  assert.match(page, /<h2 id="active-heading">In progress<\/h2>/);
  assert.match(page, /<h2 id="queue-heading">Waiting for a runner<\/h2>/);
  assert.match(page, /src="\/dashboard-model\.js" defer/);
  assert.match(page, /src="\/dashboard\.js" defer/);
  assert.match(page, /href="\/dashboard\.css"/);
  assert.equal(modelResponse.status, 200);
  assert.equal(scriptResponse.status, 200);
  assert.equal(styleResponse.status, 200);
  assert.match(pageResponse.headers.get('content-security-policy') || '', /default-src 'self'/);
  assert.match(model, /inProgress: \[\]/);
  assert.match(script, /\/api\/snapshot/);
  assert.match(script, /\/api\/control-state/);
  assert.match(script, /\/api\/actions/);
  assert.match(page, /id="workflow-controls"/);
  assert.match(page, /id="runner-controls"/);
  assert.doesNotMatch(script, /\.innerHTML\s*=|\sonclick\s*=/i);
  assert.ok(style.includes(':root'));
});

test('server refuses a non-loopback bind address', () => {
  assert.throws(
    () => createDashboardServer({ getSnapshot: async () => ({}), host: '0.0.0.0' }),
    /127\.0\.0\.1/,
  );
});
