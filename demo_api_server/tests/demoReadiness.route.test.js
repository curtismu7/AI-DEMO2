'use strict';

const express = require('express');
const request = require('supertest');
const childProcess = require('child_process');
const { createDemoReadinessJobStore, JOB_TTL_MS } = require('../services/demoReadinessJobStore');
const { createDemoReadinessRouter } = require('../routes/demoReadiness');

const PREVIEW = { digest: 'repair-digest-1', changes: [{ object: { id: 'resource-1' }, operation: 'add mapped scope' }], blocked: [] };

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function authFixture() {
  const users = {
    'admin-a': { sub: 'subject-admin-a', id: 'subject-admin-a', role: 'admin', scopes: [], tokenType: 'oauth', username: 'admin-a', email: 'private@example.test' },
    'admin-b': { sub: 'subject-admin-b', id: 'subject-admin-b', role: 'user', scopes: ['admin'], tokenType: 'oauth', username: 'admin-b' },
    customer: { sub: 'subject-customer', id: 'subject-customer', role: 'user', scopes: ['read'], tokenType: 'oauth' },
  };
  return (req, res, next) => {
    const bearer = req.get('authorization')?.replace(/^Bearer\s+/i, '');
    if (!bearer || !users[bearer]) return res.status(401).json({ error: 'unauthenticated' });
    req.user = users[bearer];
    next();
  };
}

function createFixture({ now = () => 1_800_000_000_000 } = {}) {
  const previewReady = deferred();
  const runnerFinished = deferred();
  const confirmations = [];
  const runner = jest.fn(async ({ onProgress, confirmRepairs }) => {
    await onProgress({ phase: 'audit', accessToken: 'Bearer progress-token-secret', sessionId: 'session-progress-secret' });
    await onProgress({ phase: 'repair-preview-ready', preview: PREVIEW });
    previewReady.resolve();
    const answer = await confirmRepairs({ digest: PREVIEW.digest, preview: PREVIEW });
    confirmations.push(answer);
    await onProgress({ phase: 'scenario-matrix', current: 'UC1' });
    const result = {
      ready: false,
      status: 'not-ready',
      checks: [{ id: 'audit:authorize', status: 'blocked', client_secret: 'report-credential-secret', sessionId: 'session-report-secret' }],
    };
    runnerFinished.resolve(result);
    return result;
  });
  const store = createDemoReadinessJobStore({ runReadiness: runner, now, ttlMs: JOB_TTL_MS });
  const app = express();
  app.use(express.json());
  app.use('/api/admin/demo-readiness', createDemoReadinessRouter({ store, authenticateToken: authFixture() }));
  let resetCalls = 0;
  app.post('/api/admin/reset-demo', (_req, res) => { resetCalls += 1; res.json({ ok: true }); });
  return { app, store, runner, previewReady, runnerFinished, confirmations, getResetCalls: () => resetCalls };
}

describe('admin demo readiness job routes', () => {
  const stores = [];
  afterEach(() => {
    stores.splice(0).forEach((store) => store.dispose());
    jest.restoreAllMocks();
  });

  function fixture(options) {
    const value = createFixture(options);
    stores.push(value.store);
    return value;
  }

  test.each([
    ['POST', '/api/admin/demo-readiness/jobs', undefined],
    ['GET', '/api/admin/demo-readiness/jobs/missing', undefined],
    ['POST', '/api/admin/demo-readiness/jobs/missing/confirm', { digest: 'x' }],
  ])('%s %s requires authentication', async (method, path, body) => {
    const { app, runner } = fixture();
    const response = method === 'GET' ? await request(app).get(path) : await request(app).post(path).send(body);
    expect(response.status).toBe(401);
    expect(runner).not.toHaveBeenCalled();
  });

  test.each([
    ['POST', '/api/admin/demo-readiness/jobs', undefined],
    ['GET', '/api/admin/demo-readiness/jobs/missing', undefined],
    ['POST', '/api/admin/demo-readiness/jobs/missing/confirm', { digest: 'x' }],
  ])('%s %s rejects authenticated callers without admin scope or role', async (method, path, body) => {
    const { app, runner } = fixture();
    const call = method === 'GET'
      ? request(app).get(path)
      : request(app).post(path).send(body);
    const response = await call.set('Authorization', 'Bearer customer');
    expect(response.status).toBe(403);
    expect(runner).not.toHaveBeenCalled();
  });

  test('creates an in-process job with the same runner, streams sanitized progress, and does not reset', async () => {
    jest.spyOn(childProcess, 'spawn');
    jest.spyOn(childProcess, 'exec');
    jest.spyOn(childProcess, 'execFile');
    jest.spyOn(childProcess, 'fork');
    jest.spyOn(childProcess, 'spawnSync');
    jest.spyOn(childProcess, 'execSync');
    jest.spyOn(childProcess, 'execFileSync');
    const { app, runner, previewReady, getResetCalls } = fixture();
    const started = await request(app).post('/api/admin/demo-readiness/jobs').set('Authorization', 'Bearer admin-a').expect(202);
    await previewReady.promise;

    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner.mock.calls[0][0].targets).toEqual(['local', 'se']);
    const polled = await request(app).get('/api/admin/demo-readiness/jobs/' + started.body.jobId)
      .set('Authorization', 'Bearer admin-a').expect(200);
    expect(polled.body.status).toBe('awaiting-confirmation');
    expect(polled.body.progress).toEqual(expect.objectContaining({ phase: 'repair-preview-ready' }));
    expect(polled.body.preview).toEqual(expect.objectContaining({ digest: PREVIEW.digest }));
    expect(JSON.stringify(polled.body)).not.toMatch(/progress-token-secret|session-progress-secret|private@example\.test/);
    expect(getResetCalls()).toBe(0);
    expect(childProcess.spawn).not.toHaveBeenCalled();
    expect(childProcess.exec).not.toHaveBeenCalled();
    expect(childProcess.execFile).not.toHaveBeenCalled();
    expect(childProcess.fork).not.toHaveBeenCalled();
    expect(childProcess.spawnSync).not.toHaveBeenCalled();
    expect(childProcess.execSync).not.toHaveBeenCalled();
    expect(childProcess.execFileSync).not.toHaveBeenCalled();
  });

  test('binds one confirmation to the exact digest and verified admin identity', async () => {
    const { app, previewReady, runnerFinished, confirmations } = fixture();
    const started = await request(app).post('/api/admin/demo-readiness/jobs').set('Authorization', 'Bearer admin-a').expect(202);
    await previewReady.promise;

    await request(app).post(`/api/admin/demo-readiness/jobs/${started.body.jobId}/confirm`)
      .set('Authorization', 'Bearer admin-a').send({ digest: 'stale-digest' }).expect(409);
    await request(app).post(`/api/admin/demo-readiness/jobs/${started.body.jobId}/confirm`)
      .set('Authorization', 'Bearer admin-a').send({ digest: PREVIEW.digest, adminAssertion: { subject: 'attacker' } }).expect(400);
    await request(app).post(`/api/admin/demo-readiness/jobs/${started.body.jobId}/confirm`)
      .set('Authorization', 'Bearer admin-a').send({ digest: PREVIEW.digest }).expect(202);
    await runnerFinished.promise;
    expect(confirmations).toHaveLength(1);
    expect(confirmations[0]).toEqual(expect.objectContaining({
      confirmed: true,
      digest: PREVIEW.digest,
      adminAssertion: expect.objectContaining({ subject: 'subject-admin-a', role: 'admin' }),
    }));
    expect(JSON.stringify(confirmations[0])).not.toContain('private@example.test');
    await request(app).post(`/api/admin/demo-readiness/jobs/${started.body.jobId}/confirm`)
      .set('Authorization', 'Bearer admin-a').send({ digest: PREVIEW.digest }).expect(409);
  });

  test('restricts polling and confirmation to the job owner', async () => {
    const { app, previewReady } = fixture();
    const started = await request(app).post('/api/admin/demo-readiness/jobs').set('Authorization', 'Bearer admin-a').expect(202);
    await previewReady.promise;

    await request(app).get('/api/admin/demo-readiness/jobs/' + started.body.jobId)
      .set('Authorization', 'Bearer admin-b').expect(403);
    await request(app).post(`/api/admin/demo-readiness/jobs/${started.body.jobId}/confirm`)
      .set('Authorization', 'Bearer admin-b').send({ digest: PREVIEW.digest }).expect(403);
  });

  test('expires and deletes jobs after twenty minutes', async () => {
    let now = 1_800_000_000_000;
    const { app, previewReady, runnerFinished } = fixture({ now: () => now });
    const started = await request(app).post('/api/admin/demo-readiness/jobs').set('Authorization', 'Bearer admin-a').expect(202);
    await previewReady.promise;
    now += JOB_TTL_MS;

    await request(app).get('/api/admin/demo-readiness/jobs/' + started.body.jobId)
      .set('Authorization', 'Bearer admin-a').expect(410);
    await runnerFinished.promise;
    await request(app).get('/api/admin/demo-readiness/jobs/' + started.body.jobId)
      .set('Authorization', 'Bearer admin-a').expect(404);
  });

  test('polls the terminal report with secrets redacted and never performs reset', async () => {
    const { app, previewReady, runnerFinished, getResetCalls } = fixture();
    const started = await request(app).post('/api/admin/demo-readiness/jobs').set('Authorization', 'Bearer admin-a').expect(202);
    await previewReady.promise;
    await request(app).post(`/api/admin/demo-readiness/jobs/${started.body.jobId}/confirm`)
      .set('Authorization', 'Bearer admin-a').send({ digest: PREVIEW.digest }).expect(202);
    await runnerFinished.promise;
    await new Promise(setImmediate);

    const polled = await request(app).get('/api/admin/demo-readiness/jobs/' + started.body.jobId)
      .set('Authorization', 'Bearer admin-a').expect(200);
    expect(polled.body.status).toBe('not-ready');
    expect(polled.body.report.checks[0].sessionId).toBe('[REDACTED]');
    expect(polled.body.report.checks[0].client_secret).toBe('[REDACTED]');
    expect(JSON.stringify(polled.body)).not.toMatch(/report-credential-secret|session-report-secret/);
    expect(getResetCalls()).toBe(0);
  });
});
