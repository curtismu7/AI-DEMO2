'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runThroughBff, JOBS_PATH } = require('./demo-readiness-bff');
const { runCli } = require('./demo-readiness');

const TOKEN = 'eyJ.secret.token';
const BASE = 'https://api.ping.demo:3001/';

function fakeFetch(responses) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', auth: init.headers?.Authorization });
    const next = responses.shift();
    if (!next) throw new Error('unexpected request ' + url);
    return { ok: next.status === undefined || next.status < 400, status: next.status ?? 200, json: async () => next.body };
  };
  return { fetchImpl, calls };
}

const instant = async () => {};

test('starts a job, follows its snapshots, and returns the report without confirming', async () => {
  const phases = [];
  const { fetchImpl, calls } = fakeFetch([
    { status: 202, body: { jobId: 'j1', status: 'running', progress: null } },
    { body: { jobId: 'j1', status: 'running', progress: { phase: 'audit' } } },
    { body: { jobId: 'j1', status: 'ready', report: { ready: true, status: 'ready', label: 'READY — BOTH TARGETS', checks: [] } } },
  ]);
  const report = await runThroughBff({ baseUrl: BASE, token: TOKEN, fetchImpl, sleep: instant, onProgress: ({ phase }) => phases.push(phase) });
  assert.equal(report.ready, true);
  assert.equal(report.label, 'READY — BOTH TARGETS');
  assert.deepEqual(phases, ['audit']);
  assert.deepEqual(calls.map((c) => c.method), ['POST', 'GET', 'GET']);
  assert.equal(calls[0].url, 'https://api.ping.demo:3001' + JOBS_PATH);
  assert.equal(calls[1].url, 'https://api.ping.demo:3001' + JOBS_PATH + '/j1');
  assert.ok(calls.every((c) => c.auth === 'Bearer ' + TOKEN));
  assert.ok(calls.every((c) => !c.url.endsWith('/confirm')));
});

test('a pending repair preview ends the run and is returned, never confirmed', async () => {
  const preview = { digest: 'd1', changes: [{ operation: 'set', field: 'flag' }], blocked: [] };
  const { fetchImpl, calls } = fakeFetch([
    { status: 202, body: { jobId: 'j2', status: 'running' } },
    { body: { jobId: 'j2', status: 'awaiting-confirmation', preview } },
  ]);
  const report = await runThroughBff({ baseUrl: BASE, token: TOKEN, fetchImpl, sleep: instant });
  assert.equal(report.status, 'awaiting-confirmation');
  assert.equal(report.ready, false);
  assert.deepEqual(report.repairPreview, preview);
  assert.ok(calls.every((c) => !c.url.includes('/confirm')));
});

test('a failed job throws its message, and an HTTP error names only the error code', async () => {
  const failed = fakeFetch([
    { status: 202, body: { jobId: 'j3', status: 'running' } },
    { body: { jobId: 'j3', status: 'failed', error: 'audit crashed' } },
  ]);
  await assert.rejects(runThroughBff({ baseUrl: BASE, token: TOKEN, fetchImpl: failed.fetchImpl, sleep: instant }), /audit crashed/);

  const denied = fakeFetch([{ status: 403, body: { error: 'admin_identity_required' } }]);
  await assert.rejects(
    runThroughBff({ baseUrl: BASE, token: TOKEN, fetchImpl: denied.fetchImpl, sleep: instant }),
    (error) => /HTTP 403 admin_identity_required/.test(error.message) && !error.message.includes(TOKEN),
  );
});

test('the run gives up after the 16-minute deadline', async () => {
  let now = 0;
  const { fetchImpl } = fakeFetch([
    { status: 202, body: { jobId: 'j4', status: 'running' } },
    { body: { jobId: 'j4', status: 'running' } },
  ]);
  await assert.rejects(
    runThroughBff({ baseUrl: BASE, token: TOKEN, fetchImpl, sleep: async () => { now += 17 * 60 * 1000; }, clock: () => now }),
    /did not finish within 16 minutes/,
  );
});

test('setting only one BFF variable is an error', async () => {
  const errors = [];
  const partial = await runCli([], { env: { DEMO_READINESS_BFF_URL: BASE }, stdout: { write: () => {} }, stderr: { write: (v) => errors.push(v) } });
  assert.equal(partial, 2);
  assert.match(errors.join(''), /Set both DEMO_READINESS_BFF_URL and DEMO_READINESS_BFF_ADMIN_TOKEN/);
});

test('the BFF lane sends --target to the job, and one target stays diagnostic', async () => {
  const bodies = [];
  const responses = [
    { status: 202, body: { jobId: 'j6', status: 'running' } },
    { body: { jobId: 'j6', status: 'not-ready', report: { ready: false, status: 'not-ready', label: 'DIAGNOSTIC — LOCAL ONLY', checks: [] } } },
  ];
  const fetchImpl = async (_url, init = {}) => {
    if (init.body) bodies.push(JSON.parse(init.body));
    const next = responses.shift();
    return { ok: (next.status ?? 200) < 400, status: next.status ?? 200, json: async () => next.body };
  };
  const code = await runCli(['--target', 'local', '--json'], {
    env: { DEMO_READINESS_BFF_URL: BASE, DEMO_READINESS_BFF_ADMIN_TOKEN: TOKEN },
    fetchImpl,
    stdout: { write: () => {} },
    stderr: { write: () => {} },
  });
  assert.deepEqual(bodies, [{ targets: ['local'], providers: ['pingone', 'pingfederate'] }]);
  assert.equal(code, 1);
});

test('the BFF lane sends --provider to the job, and one provider stays diagnostic even when READY', async () => {
  const bodies = [];
  const responses = [
    { status: 202, body: { jobId: 'j7', status: 'running' } },
    { body: { jobId: 'j7', status: 'ready', report: { ready: true, status: 'ready', label: 'READY — BOTH TARGETS', checks: [] } } },
  ];
  const fetchImpl = async (_url, init = {}) => {
    if (init.body) bodies.push(JSON.parse(init.body));
    const next = responses.shift();
    return { ok: (next.status ?? 200) < 400, status: next.status ?? 200, json: async () => next.body };
  };
  const code = await runCli(['--provider', 'pingfederate', '--json'], {
    env: { DEMO_READINESS_BFF_URL: BASE, DEMO_READINESS_BFF_ADMIN_TOKEN: TOKEN },
    fetchImpl,
    stdout: { write: () => {} },
    stderr: { write: () => {} },
  });
  assert.deepEqual(bodies, [{ targets: ['local', 'se'], providers: ['pingfederate'] }]);
  assert.equal(code, 1);
});

test('--provider accepts only pingone, pingfederate or both', async () => {
  const errors = [];
  const code = await runCli(['--provider', 'okta'], { stdout: { write: () => {} }, stderr: { write: (v) => errors.push(v) } });
  assert.equal(code, 2);
  assert.match(errors.join(''), /--provider must be pingone\|pingfederate\|both/);
});

test('runCli with the BFF lane prints the report and exits 0 only for full READY', async () => {
  const { fetchImpl } = fakeFetch([
    { status: 202, body: { jobId: 'j5', status: 'running' } },
    { body: { jobId: 'j5', status: 'ready', report: { ready: true, status: 'ready', label: 'READY — BOTH TARGETS', checks: [] } } },
  ]);
  let output = '';
  const code = await runCli(['--json'], {
    env: { DEMO_READINESS_BFF_URL: BASE, DEMO_READINESS_BFF_ADMIN_TOKEN: TOKEN },
    fetchImpl,
    stdout: { write: (v) => { output += v; } },
    stderr: { write: () => {} },
  });
  assert.equal(code, 0);
  assert.equal(JSON.parse(output).label, 'READY — BOTH TARGETS');
  assert.doesNotMatch(output, /eyJ\.secret/);
});
