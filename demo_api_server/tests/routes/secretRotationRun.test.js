'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

const mockSpawn = jest.fn(() => ({ pid: 4242, unref: jest.fn() }));
jest.mock('node:child_process', () => ({ spawn: (...a) => mockSpawn(...a) }));
jest.mock('../../services/agentBuilderService', () => ({ listApplicationsRaw: jest.fn() }));
jest.mock('../../services/pingOneSecretRotation', () => ({ isWorkerApp: () => false }));
jest.mock('../../scripts/refresh-service-envs', () => ({
  getRotatableVaultKeyMap: jest.fn(),
}));

const { getRotatableVaultKeyMap } = require('../../scripts/refresh-service-envs');
const router = require('../../routes/secretRotation');

const RUN_DIR = path.join(__dirname, '..', '..', 'data', 'rotation-runs');

function appWithRouter() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/secret-rotation', router);
  return app;
}

describe('POST /api/admin/secret-rotation/start', () => {
  // clearMocks wipes call history but NOT a mockResolvedValue — re-arm it here
  // or the first test's value leaks into the rest of the file.
  beforeEach(() => {
    jest.clearAllMocks();
    getRotatableVaultKeyMap.mockResolvedValue({ a1: 'DEMO_CLIENT_SECRET' });
  });

  test('spawns the CLI detached and never puts a secret in argv', async () => {
    const res = await request(appWithRouter())
      .post('/api/admin/secret-rotation/start')
      .send({ appId: 'a1', vaultKey: 'DEMO_CLIENT_SECRET', reason: 'because' });

    expect(res.status).toBe(202);
    expect(res.body.runId).toMatch(/^[0-9a-f-]{36}$/);
    const [, argv, opts] = mockSpawn.mock.calls[0];
    expect(argv).toEqual(expect.arrayContaining(['--app-id', 'a1', '--vault-key', 'DEMO_CLIENT_SECRET']));
    expect(argv.join(' ')).not.toMatch(/secret=[^ ]/);
    expect(opts.detached).toBe(true);
  });

  test('rejects a request with no appId', async () => {
    const res = await request(appWithRouter()).post('/api/admin/secret-rotation/start').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/appId/);
  });

  // C2: the vault key is server-derived. A key that isn't this app's is rejected
  // BEFORE the CLI is spawned — everything the CLI does is downstream of an
  // irreversible PingOne call.
  test('rejects a vaultKey that is not the app\'s mapped key, and never spawns', async () => {
    const res = await request(appWithRouter())
      .post('/api/admin/secret-rotation/start')
      .send({ appId: 'a1', vaultKey: 'ROTATABLE_CLIENT_SECRET', reason: 'guessed key' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not the rotatable vault key/i);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  test('rejects an appId that is not rotatable at all, and never spawns', async () => {
    const res = await request(appWithRouter())
      .post('/api/admin/secret-rotation/start')
      .send({ appId: 'worker-app', vaultKey: 'DEMO_CLIENT_SECRET', reason: 'nope' });

    expect(res.status).toBe(400);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  // I4: an irreversible action that collects a justification and drops it
  // implies an audit trail that does not exist.
  test('writes the operator reason as the first line of the run log', async () => {
    const res = await request(appWithRouter())
      .post('/api/admin/secret-rotation/start')
      .send({ appId: 'a1', vaultKey: 'DEMO_CLIENT_SECRET', reason: 'suspected credential leak' });

    const logPath = path.join(RUN_DIR, `${res.body.runId}.log`);
    const first = fs.readFileSync(logPath, 'utf8').split('\n')[0];
    expect(first).toBe('[rotate] reason: suspected credential leak');
    fs.unlinkSync(logPath);
  });
});

// C4: status keys off the CLI's single terminal sentinel. The old substring
// guess ("verified" / "VERIFY FAILED" / "Error") matched none of the refusal
// messages, so a correctly refused rotation polled 'running' forever while the
// page rendered a mask for a secret that was never touched.
describe('GET /api/admin/secret-rotation/runs/:runId', () => {
  function runWithLog(text) {
    fs.mkdirSync(RUN_DIR, { recursive: true });
    const runId = '11111111-2222-3333-4444-555555555555';
    fs.writeFileSync(path.join(RUN_DIR, `${runId}.log`), text);
    return runId;
  }
  afterEach(() => {
    const p = path.join(RUN_DIR, '11111111-2222-3333-4444-555555555555.log');
    if (fs.existsSync(p)) fs.unlinkSync(p);
  });

  test('a preflight refusal with no DONE line yet is still running', async () => {
    const runId = runWithLog('[rotate] reason: x\n');
    const res = await request(appWithRouter()).get(`/api/admin/secret-rotation/runs/${runId}`);
    expect(res.body.status).toBe('running');
  });

  test('a refused rotation reports aborted, never running', async () => {
    const runId = runWithLog(
      '[rotate] reason: x\n'
      + '[rotate] DONE aborted: Refusing to rotate "Worker": it is the configured worker app.\n');
    const res = await request(appWithRouter()).get(`/api/admin/secret-rotation/runs/${runId}`);
    expect(res.body.status).toBe('aborted');
  });

  test('a successful rotation reports done', async () => {
    const runId = runWithLog('[rotate] verified (token_issued)\n[rotate] DONE ok\n');
    const res = await request(appWithRouter()).get(`/api/admin/secret-rotation/runs/${runId}`);
    expect(res.body.status).toBe('done');
  });

  test('a log that says "verified" but has no DONE line is NOT done', async () => {
    const runId = runWithLog('[rotate] verified (token_issued)\n');
    const res = await request(appWithRouter()).get(`/api/admin/secret-rotation/runs/${runId}`);
    expect(res.body.status).toBe('running');
  });

  test('a post-rotate failure reports failed', async () => {
    const runId = runWithLog('[rotate] DONE failed: verify failed (invalid_client)\n');
    const res = await request(appWithRouter()).get(`/api/admin/secret-rotation/runs/${runId}`);
    expect(res.body.status).toBe('failed');
  });
});
