'use strict';

const request = require('supertest');
const { createReadinessWorkerHttpService } = require('../services/demoReadinessWorkerServer');
const { buildDemoReadinessCatalog } = require('../services/demoReadinessCatalog');
const featureManifest = require('../config/demoReadinessFeatureChecks.json');

const LANE = Object.freeze({
  targetId: 'local',
  provider: 'pingfederate',
  identityRef: 'secret://readiness/local/pingfederate',
  workerToken: 'worker-token-that-is-long-enough-for-the-isolated-worker-service',
});
const UC40_CASE = buildDemoReadinessCatalog().find((caseRow) => caseRow.id === 'UC40');
const PF_NATIVE_ID_JAG_CHECK = featureManifest.checks.find((check) =>
  check.providers.includes('pingfederate')
  && featureManifest.contracts[check.id].featureFamily === 'pf-native-id-jag');

function uc40Input(overrides = {}) {
  return {
    caseRow: UC40_CASE,
    vertical: 'banking',
    mode: UC40_CASE.executionMode,
    behavior: UC40_CASE.expectedBehaviorByVertical.banking,
    authorization: UC40_CASE.authorizationContractByVertical.banking,
    ...overrides,
  };
}

function session(overrides = {}) {
  return {
    userSession: { authenticated: true, provider: LANE.provider, identityRef: LANE.identityRef },
    runtimeId: 'runtime-pf-1',
    cookieJarId: 'cookie-jar-pf-1',
    sessionStoreId: 'session-store-pf-1',
    verifyPrerequisites: jest.fn(async () => ({ status: 'pass' })),
    executeReadinessCase: jest.fn(async () => ({ observed: 'PERMIT', evidence: { tokenIssuer: 'pingfederate', accessToken: 'must-not-cross-worker-boundary' } })),
    verifyFeaturePrerequisites: jest.fn(async () => ({ status: 'pass' })),
    executeNativeIdJagNegative: jest.fn(async () => ({ observed: 'PERMIT', evidence: { exchangePath: 'native-id-jag' } })),
    dispose: jest.fn(async () => {}),
    ...overrides,
  };
}

function service(createSession, options = {}) {
  return createReadinessWorkerHttpService({ ...LANE, createSession, sweepIntervalMs: 60_000, ...options });
}

describe('demo readiness isolated worker HTTP service', () => {
  test('requires the configured lane bearer token before it reveals worker state', async () => {
    const createSession = jest.fn(async () => session());
    const worker = service(createSession);

    const health = await request(worker.app).get('/api/demo-readiness/v1/health');
    const create = await request(worker.app).post('/api/demo-readiness/v1/contexts').send({
      runId: 'run-1', targetId: LANE.targetId, provider: LANE.provider, identityRef: LANE.identityRef,
    });

    expect(health.status).toBe(401);
    expect(create.status).toBe(401);
    expect(createSession).not.toHaveBeenCalled();
    await worker.close();
  });

  test('reports a lane-bound health handshake without returning its credential', async () => {
    const worker = service(jest.fn(async () => session()));

    const response = await request(worker.app)
      .get('/api/demo-readiness/v1/health')
      .set('Authorization', `Bearer ${LANE.workerToken}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: 'ready', targetId: 'local', provider: 'pingfederate',
      identityRef: LANE.identityRef,
      capabilities: ['readiness-context-v1', 'readiness-case-v1', 'readiness-feature-v1'],
    });
    expect(response.body.workerId).toEqual(expect.any(String));
    expect(JSON.stringify(response.body)).not.toContain(LANE.workerToken);
    await worker.close();
  });

  test('rejects a context request for another provider or identity before login', async () => {
    const createSession = jest.fn(async () => session());
    const worker = service(createSession);

    const response = await request(worker.app)
      .post('/api/demo-readiness/v1/contexts')
      .set('Authorization', `Bearer ${LANE.workerToken}`)
      .send({ runId: 'run-1', targetId: 'local', provider: 'pingone', identityRef: LANE.identityRef });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: 'Requested worker target, provider, or identity does not match this lane.' });
    expect(createSession).not.toHaveBeenCalled();
    await worker.close();
  });

  test('reuses one run context and dispatches only lane-bound case and PF ID-JAG operations', async () => {
    const laneSession = session();
    const createSession = jest.fn(async () => laneSession);
    const worker = service(createSession);
    const auth = { Authorization: `Bearer ${LANE.workerToken}` };
    const contextRequest = {
      runId: 'run-1', targetId: 'local', provider: 'pingfederate', identityRef: LANE.identityRef,
    };
    const first = await request(worker.app).post('/api/demo-readiness/v1/contexts').set(auth).send(contextRequest);
    const retry = await request(worker.app).post('/api/demo-readiness/v1/contexts').set(auth).send(contextRequest);

    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(retry.body.contextId).toBe(first.body.contextId);
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(first.body).toMatchObject({
      status: 'ready', targetId: 'local', provider: 'pingfederate', identityRef: LANE.identityRef,
      userSession: { authenticated: true, provider: 'pingfederate', identityRef: LANE.identityRef },
      runtimeId: 'runtime-pf-1', cookieJarId: 'cookie-jar-pf-1', sessionStoreId: 'session-store-pf-1',
    });

    const caseResponse = await request(worker.app)
      .post(`/api/demo-readiness/v1/contexts/${first.body.contextId}/operations`)
      .set(auth)
      .send({
        operation: 'execute-case', targetId: 'local', provider: 'pingfederate', identityRef: LANE.identityRef,
        input: uc40Input(),
      });
    const featureResponse = await request(worker.app)
      .post(`/api/demo-readiness/v1/contexts/${first.body.contextId}/operations`)
      .set(auth)
      .send({
        operation: 'execute-feature', targetId: 'local', provider: 'pingfederate', identityRef: LANE.identityRef,
        input: {
          featureFamily: 'pf-native-id-jag',
          check: PF_NATIVE_ID_JAG_CHECK,
          contract: featureManifest.contracts[PF_NATIVE_ID_JAG_CHECK.id],
        },
      });

    expect(caseResponse.status).toBe(200);
    expect(caseResponse.body.result.observed).toBe('PERMIT');
    expect(caseResponse.body.result.evidence.accessToken).toBe('[REDACTED]');
    expect(featureResponse.status).toBe(200);
    expect(featureResponse.body.result.evidence.exchangePath).toBe('native-id-jag');
    expect(laneSession.executeReadinessCase).toHaveBeenCalledWith(expect.objectContaining({
      caseRow: expect.objectContaining({ id: 'UC40' }), vertical: 'banking', mode: 'live-id-jag',
    }));
    expect(laneSession.executeNativeIdJagNegative).toHaveBeenCalledWith(expect.objectContaining({
      check: PF_NATIVE_ID_JAG_CHECK,
      contract: featureManifest.contracts[PF_NATIVE_ID_JAG_CHECK.id],
    }));

    const deleted = await request(worker.app)
      .delete(`/api/demo-readiness/v1/contexts/${first.body.contextId}`)
      .set(auth);
    const afterDelete = await request(worker.app)
      .post(`/api/demo-readiness/v1/contexts/${first.body.contextId}/operations`)
      .set(auth)
      .send({
        operation: 'execute-case', targetId: 'local', provider: 'pingfederate', identityRef: LANE.identityRef,
        input: uc40Input(),
      });

    expect(deleted.status).toBe(204);
    expect(laneSession.dispose).toHaveBeenCalledTimes(1);
    expect(afterDelete.status).toBe(404);
    await worker.close();
  });

  test('coalesces simultaneous retries for a run ID into one authenticated session', async () => {
    const laneSession = session();
    const createSession = jest.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      return laneSession;
    });
    const worker = service(createSession);
    const auth = { Authorization: `Bearer ${LANE.workerToken}` };
    const body = { runId: 'run-concurrent', targetId: LANE.targetId, provider: LANE.provider, identityRef: LANE.identityRef };
    const [first, retry] = await Promise.all([
      request(worker.app).post('/api/demo-readiness/v1/contexts').set(auth).send(body),
      request(worker.app).post('/api/demo-readiness/v1/contexts').set(auth).send(body),
    ]);

    expect([first.status, retry.status].sort()).toEqual([200, 201]);
    expect(first.body.contextId).toBe(retry.body.contextId);
    expect(createSession).toHaveBeenCalledTimes(1);
    await worker.close();
  });

  test('keeps shared setup alive when its first HTTP requester disconnects', async () => {
    let markSetupStarted;
    let resolveSetup;
    let setupSignal;
    const setupStarted = new Promise((resolve) => { markSetupStarted = resolve; });
    const createSession = jest.fn(({ signal }) => {
      setupSignal = signal;
      markSetupStarted();
      return new Promise((resolve) => { resolveSetup = resolve; });
    });
    const worker = service(createSession);
    const auth = { Authorization: `Bearer ${LANE.workerToken}` };
    const body = { runId: 'run-shared-setup', targetId: LANE.targetId, provider: LANE.provider, identityRef: LANE.identityRef };
    const firstRequest = request(worker.app).post('/api/demo-readiness/v1/contexts').set(auth).send(body);
    const firstResult = firstRequest.then((response) => response, (error) => error);
    await setupStarted;
    const secondResult = request(worker.app).post('/api/demo-readiness/v1/contexts').set(auth).send(body);
    const secondPromise = secondResult.then((response) => response);
    await new Promise((resolve) => setTimeout(resolve, 10));
    firstRequest.abort();
    const sharedSetupWasAborted = setupSignal.aborted;
    resolveSetup(session());
    const second = await secondPromise;
    const first = await firstResult;
    await worker.close();

    expect(first).toBeInstanceOf(Error);
    expect(sharedSetupWasAborted).toBe(false);
    expect(second.status).toBe(200);
    expect(createSession).toHaveBeenCalledTimes(1);
  });

  test('retries session setup after its only requester disconnects', async () => {
    let markSetupStarted;
    let firstSignal;
    let calls = 0;
    const setupStarted = new Promise((resolve) => { markSetupStarted = resolve; });
    const createSession = jest.fn(({ signal }) => {
      calls += 1;
      if (calls === 1) {
        firstSignal = signal;
        markSetupStarted();
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      }
      return Promise.resolve(session({
        runtimeId: 'runtime-pf-retry', cookieJarId: 'cookie-jar-pf-retry', sessionStoreId: 'session-store-pf-retry',
      }));
    });
    const worker = service(createSession);
    const auth = { Authorization: `Bearer ${LANE.workerToken}` };
    const body = { runId: 'run-aborted-setup', targetId: LANE.targetId, provider: LANE.provider, identityRef: LANE.identityRef };
    const disconnectedRequest = request(worker.app).post('/api/demo-readiness/v1/contexts').set(auth).send(body);
    const disconnectedResult = disconnectedRequest.then((response) => response, (error) => error);
    await setupStarted;
    disconnectedRequest.abort();
    const disconnected = await disconnectedResult;
    const retry = await request(worker.app).post('/api/demo-readiness/v1/contexts').set(auth).send(body);
    await worker.close();

    expect(disconnected).toBeInstanceOf(Error);
    expect(firstSignal.aborted).toBe(true);
    expect(retry.status).toBe(201);
    expect(retry.body.runtimeId).toBe('runtime-pf-retry');
    expect(createSession).toHaveBeenCalledTimes(2);
  });

  test('keeps timed-out setup capacity reserved until its late session is disposed', async () => {
    let markSetupStarted;
    let markSetupAborted;
    let resolveLateSession;
    let markLateDisposalStarted;
    let releaseLateDisposal;
    const setupStarted = new Promise((resolve) => { markSetupStarted = resolve; });
    const setupAborted = new Promise((resolve) => { markSetupAborted = resolve; });
    const lateDisposalStarted = new Promise((resolve) => { markLateDisposalStarted = resolve; });
    const lateDisposalGate = new Promise((resolve) => { releaseLateDisposal = resolve; });
    const lateSession = session({
      runtimeId: 'runtime-pf-late', cookieJarId: 'cookie-jar-pf-late', sessionStoreId: 'session-store-pf-late',
      dispose: jest.fn(async () => {
        markLateDisposalStarted();
        await lateDisposalGate;
      }),
    });
    let calls = 0;
    const createSession = jest.fn(({ signal }) => {
      calls += 1;
      if (calls === 1) {
        signal.addEventListener('abort', markSetupAborted, { once: true });
        markSetupStarted();
        return new Promise((resolve) => { resolveLateSession = resolve; });
      }
      return Promise.resolve(session({
        runtimeId: 'runtime-pf-after-timeout',
        cookieJarId: 'cookie-jar-pf-after-timeout',
        sessionStoreId: 'session-store-pf-after-timeout',
      }));
    });
    const worker = service(createSession, { createTimeoutMs: 25, cleanupTimeoutMs: 1000, maxContexts: 1 });
    const auth = { Authorization: `Bearer ${LANE.workerToken}` };
    const firstBody = { runId: 'run-timeout-retry', targetId: LANE.targetId, provider: LANE.provider, identityRef: LANE.identityRef };
    const firstPromise = request(worker.app).post('/api/demo-readiness/v1/contexts').set(auth).send(firstBody)
      .then((response) => response);
    await setupStarted;
    await setupAborted;
    const retryPromise = request(worker.app).post('/api/demo-readiness/v1/contexts').set(auth).send(firstBody)
      .then((response) => response);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const competingContext = await request(worker.app).post('/api/demo-readiness/v1/contexts').set(auth).send({
      runId: 'run-capacity-during-timeout-cleanup',
      targetId: LANE.targetId,
      provider: LANE.provider,
      identityRef: LANE.identityRef,
    });

    const callsBeforeLateResolve = createSession.mock.calls.length;
    resolveLateSession(lateSession);
    await lateDisposalStarted;
    const callsDuringLateDisposal = createSession.mock.calls.length;
    releaseLateDisposal();
    const [first, retry] = await Promise.all([firstPromise, retryPromise]);
    await worker.close();

    expect(callsBeforeLateResolve).toBe(1);
    expect(competingContext.status).toBe(429);
    expect(callsDuringLateDisposal).toBe(1);
    expect(first.status).toBe(504);
    expect(lateSession.dispose).toHaveBeenCalledTimes(1);
    expect(retry.status).toBe(201);
    expect(retry.body.runtimeId).toBe('runtime-pf-after-timeout');
    expect(createSession).toHaveBeenCalledTimes(2);
  });

  test('latches the worker unavailable when cancelled setup cleanup cannot be confirmed', async () => {
    let markSetupAborted;
    let resolveLateSession;
    let markLateDisposal;
    const setupAborted = new Promise((resolve) => { markSetupAborted = resolve; });
    const lateDisposal = new Promise((resolve) => { markLateDisposal = resolve; });
    const createSession = jest.fn(({ signal }) => {
      signal.addEventListener('abort', markSetupAborted, { once: true });
      return new Promise((resolve) => { resolveLateSession = resolve; });
    });
    const worker = service(createSession, { createTimeoutMs: 15, cleanupTimeoutMs: 20 });
    const auth = { Authorization: `Bearer ${LANE.workerToken}` };
    const body = { runId: 'run-unconfirmed-cleanup', targetId: LANE.targetId, provider: LANE.provider, identityRef: LANE.identityRef };
    const firstPromise = request(worker.app).post('/api/demo-readiness/v1/contexts').set(auth).send(body)
      .then((response) => response);
    await setupAborted;
    const first = await firstPromise;
    const health = await request(worker.app).get('/api/demo-readiness/v1/health').set(auth);
    const retry = await request(worker.app).post('/api/demo-readiness/v1/contexts').set(auth).send(body);
    const lateSession = session({
      runtimeId: 'runtime-pf-late-after-fail-closed',
      cookieJarId: 'cookie-jar-pf-late-after-fail-closed',
      sessionStoreId: 'session-store-pf-late-after-fail-closed',
      dispose: jest.fn(async () => { markLateDisposal(); }),
    });
    resolveLateSession(lateSession);
    await lateDisposal;
    await worker.close();

    expect(first.status).toBe(503);
    expect(health.body.status).toBe('unavailable');
    expect(retry.status).toBe(503);
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(lateSession.dispose).toHaveBeenCalledTimes(1);
  });

  test('rejects unsafe worker limit overrides', () => {
    for (const options of [
      { contextTtlMs: 30 * 60 * 1000 + 1 },
      { createTimeoutMs: 2 * 60 * 1000 + 1 },
      { operationTimeoutMs: 2 * 60 * 1000 + 1 },
      { cleanupTimeoutMs: 10 * 1000 + 1 },
      { maxContexts: 9 },
      { sweepIntervalMs: 60 * 1000 + 1 },
    ]) {
      expect(() => service(jest.fn(), options)).toThrow(TypeError);
    }
  });

  test('coalesces context recreation when concurrent requests race an expired context', async () => {
    let currentTime = 1000;
    const createSession = jest.fn(async () => session());
    const worker = service(createSession, { contextTtlMs: 100, now: () => currentTime });
    const auth = { Authorization: `Bearer ${LANE.workerToken}` };
    const body = { runId: 'run-expired-retry', targetId: LANE.targetId, provider: LANE.provider, identityRef: LANE.identityRef };
    const first = await request(worker.app).post('/api/demo-readiness/v1/contexts').set(auth).send(body);
    currentTime = 1200;
    const [retryA, retryB] = await Promise.all([
      request(worker.app).post('/api/demo-readiness/v1/contexts').set(auth).send(body),
      request(worker.app).post('/api/demo-readiness/v1/contexts').set(auth).send(body),
    ]);

    expect(first.status).toBe(201);
    expect([retryA.status, retryB.status].sort()).toEqual([200, 201]);
    expect(retryA.body.contextId).toBe(retryB.body.contextId);
    expect(createSession).toHaveBeenCalledTimes(2);
    expect(await worker.sweepExpired()).toBe(0);
    await worker.close();
  });

  test('keeps a closing session inside the context capacity until cleanup finishes', async () => {
    let markDisposeStarted;
    let releaseDispose;
    const disposeStarted = new Promise((resolve) => { markDisposeStarted = resolve; });
    const disposalGate = new Promise((resolve) => { releaseDispose = resolve; });
    const laneSession = session({
      dispose: jest.fn(async () => {
        markDisposeStarted();
        await disposalGate;
      }),
    });
    const worker = service(jest.fn(async () => laneSession), { maxContexts: 1 });
    const auth = { Authorization: `Bearer ${LANE.workerToken}` };
    const created = await request(worker.app).post('/api/demo-readiness/v1/contexts').set(auth).send({
      runId: 'run-closing', targetId: LANE.targetId, provider: LANE.provider, identityRef: LANE.identityRef,
    });
    const deletionPromise = request(worker.app)
      .delete(`/api/demo-readiness/v1/contexts/${created.body.contextId}`)
      .set(auth)
      .then((response) => response);
    await disposeStarted;
    const atCapacity = await request(worker.app).post('/api/demo-readiness/v1/contexts').set(auth).send({
      runId: 'run-while-closing', targetId: LANE.targetId, provider: LANE.provider, identityRef: LANE.identityRef,
    });
    releaseDispose();
    const deleted = await deletionPromise;

    expect(atCapacity.status).toBe(429);
    expect(deleted.status).toBe(204);
    await worker.close();
  });

  test('disposes a session whose provider-authenticated handshake does not match its lane', async () => {
    const badSession = session({ userSession: { authenticated: true, provider: 'pingone', identityRef: LANE.identityRef } });
    const worker = service(jest.fn(async () => badSession));

    const response = await request(worker.app)
      .post('/api/demo-readiness/v1/contexts')
      .set('Authorization', `Bearer ${LANE.workerToken}`)
      .send({ runId: 'run-1', targetId: 'local', provider: 'pingfederate', identityRef: LANE.identityRef });

    expect(response.status).toBe(502);
    expect(response.body).toEqual({ error: 'Worker could not establish the configured authenticated session.' });
    expect(badSession.dispose).toHaveBeenCalledTimes(1);
    await worker.close();
  });

  test('rejects a PF-only feature on a PingOne lane and never invokes the adapter', async () => {
    const pingOneLane = {
      ...LANE,
      provider: 'pingone',
      identityRef: 'secret://readiness/local/pingone',
    };
    const laneSession = session({
      userSession: { authenticated: true, provider: pingOneLane.provider, identityRef: pingOneLane.identityRef },
      executeNativeIdJagNegative: jest.fn(async () => ({ observed: 'DENY' })),
    });
    const worker = createReadinessWorkerHttpService({
      ...pingOneLane,
      createSession: jest.fn(async () => laneSession),
      sweepIntervalMs: 60_000,
    });
    const auth = { Authorization: `Bearer ${LANE.workerToken}` };
    const created = await request(worker.app).post('/api/demo-readiness/v1/contexts').set(auth).send({
      runId: 'run-pingone', targetId: pingOneLane.targetId, provider: pingOneLane.provider, identityRef: pingOneLane.identityRef,
    });
    const response = await request(worker.app)
      .post(`/api/demo-readiness/v1/contexts/${created.body.contextId}/operations`)
      .set(auth)
      .send({
        operation: 'execute-feature', targetId: pingOneLane.targetId, provider: pingOneLane.provider,
        identityRef: pingOneLane.identityRef, input: { featureFamily: 'pf-native-id-jag' },
      });

    expect(response.status).toBe(400);
    expect(laneSession.executeNativeIdJagNegative).not.toHaveBeenCalled();
    await worker.close();
  });

  test('closes and removes a context when a dispatched operation exceeds its timeout', async () => {
    const laneSession = session({ executeReadinessCase: jest.fn(() => new Promise(() => {})) });
    const worker = service(jest.fn(async () => laneSession), { operationTimeoutMs: 20 });
    const auth = { Authorization: `Bearer ${LANE.workerToken}` };
    const created = await request(worker.app).post('/api/demo-readiness/v1/contexts').set(auth).send({
      runId: 'run-timeout', targetId: LANE.targetId, provider: LANE.provider, identityRef: LANE.identityRef,
    });
    const timedOut = await request(worker.app)
      .post(`/api/demo-readiness/v1/contexts/${created.body.contextId}/operations`)
      .set(auth)
      .send({
        operation: 'execute-case', targetId: LANE.targetId, provider: LANE.provider, identityRef: LANE.identityRef,
        input: uc40Input(),
      });
    const deleted = await request(worker.app).delete(`/api/demo-readiness/v1/contexts/${created.body.contextId}`).set(auth);

    expect(timedOut.status).toBe(504);
    expect(laneSession.dispose).toHaveBeenCalledTimes(1);
    expect(deleted.status).toBe(204);
    await worker.close();
  });

  test('does not claim timeout cleanup succeeded when the adapter fails to dispose', async () => {
    const laneSession = session({
      executeReadinessCase: jest.fn(() => new Promise(() => {})),
      dispose: jest.fn(async () => { throw new Error('private adapter cleanup detail'); }),
    });
    const worker = service(jest.fn(async () => laneSession), { operationTimeoutMs: 20 });
    const auth = { Authorization: `Bearer ${LANE.workerToken}` };
    const created = await request(worker.app).post('/api/demo-readiness/v1/contexts').set(auth).send({
      runId: 'run-timeout-cleanup-failure', targetId: LANE.targetId, provider: LANE.provider, identityRef: LANE.identityRef,
    });
    const response = await request(worker.app)
      .post(`/api/demo-readiness/v1/contexts/${created.body.contextId}/operations`)
      .set(auth)
      .send({
        operation: 'execute-case', targetId: LANE.targetId, provider: LANE.provider, identityRef: LANE.identityRef,
        input: uc40Input(),
      });

    expect(response.status).toBe(503);
    expect(JSON.stringify(response.body)).not.toContain('private adapter');
    expect(laneSession.dispose).toHaveBeenCalledTimes(1);
    await worker.close();
  });

  test('cancels an in-flight operation before deleting its context', async () => {
    let markStarted;
    const started = new Promise((resolve) => { markStarted = resolve; });
    const laneSession = session({
      executeReadinessCase: jest.fn(() => {
        markStarted();
        return new Promise(() => {});
      }),
    });
    const worker = service(jest.fn(async () => laneSession));
    const auth = { Authorization: `Bearer ${LANE.workerToken}` };
    const created = await request(worker.app).post('/api/demo-readiness/v1/contexts').set(auth).send({
      runId: 'run-delete-operation', targetId: LANE.targetId, provider: LANE.provider, identityRef: LANE.identityRef,
    });
    const operationRequest = request(worker.app)
      .post(`/api/demo-readiness/v1/contexts/${created.body.contextId}/operations`)
      .set(auth)
      .send({
        operation: 'execute-case', targetId: LANE.targetId, provider: LANE.provider, identityRef: LANE.identityRef,
        input: uc40Input(),
      });
    const operationPromise = operationRequest.then((response) => response);
    await started;
    const [operation, deletion] = await Promise.all([
      operationPromise,
      request(worker.app).delete(`/api/demo-readiness/v1/contexts/${created.body.contextId}`).set(auth),
    ]);

    expect(operation.status).toBe(409);
    expect(deletion.status).toBe(204);
    expect(laneSession.dispose).toHaveBeenCalledTimes(1);
    await worker.close();
  });

  test('sweeps expired sessions and reports failed adapter cleanup to the caller', async () => {
    let currentTime = 1000;
    const expiredSession = session();
    const worker = service(jest.fn(async () => expiredSession), {
      contextTtlMs: 100,
      now: () => currentTime,
    });
    const auth = { Authorization: `Bearer ${LANE.workerToken}` };
    const created = await request(worker.app).post('/api/demo-readiness/v1/contexts').set(auth).send({
      runId: 'run-expire', targetId: LANE.targetId, provider: LANE.provider, identityRef: LANE.identityRef,
    });
    currentTime = 1200;
    expect(await worker.sweepExpired()).toBe(1);
    expect(expiredSession.dispose).toHaveBeenCalledTimes(1);
    expect((await request(worker.app).delete(`/api/demo-readiness/v1/contexts/${created.body.contextId}`).set(auth)).status).toBe(204);
    await worker.close();

    const cleanupFailure = session({ dispose: jest.fn(async () => { throw new Error('credential-bearing adapter detail'); }) });
    const failingWorker = service(jest.fn(async () => cleanupFailure));
    const failingCreated = await request(failingWorker.app).post('/api/demo-readiness/v1/contexts').set(auth).send({
      runId: 'run-cleanup-error', targetId: LANE.targetId, provider: LANE.provider, identityRef: LANE.identityRef,
    });
    const deleteResponse = await request(failingWorker.app).delete(`/api/demo-readiness/v1/contexts/${failingCreated.body.contextId}`).set(auth);
    expect(deleteResponse.status).toBe(503);
    expect(JSON.stringify(deleteResponse.body)).not.toContain('credential-bearing');
    const health = await request(failingWorker.app).get('/api/demo-readiness/v1/health').set(auth);
    const afterFailure = await request(failingWorker.app).post('/api/demo-readiness/v1/contexts').set(auth).send({
      runId: 'run-after-cleanup-failure', targetId: LANE.targetId, provider: LANE.provider, identityRef: LANE.identityRef,
    });
    expect(health.body.status).toBe('unavailable');
    expect(afterFailure.status).toBe(503);
    await failingWorker.close();
  });

  test('rejects malformed JSON and non-object operation inputs with safe errors', async () => {
    const worker = service(jest.fn(async () => session()));
    const auth = { Authorization: `Bearer ${LANE.workerToken}` };
    const malformed = await request(worker.app)
      .post('/api/demo-readiness/v1/contexts')
      .set(auth)
      .set('Content-Type', 'application/json')
      .send('{"runId":');
    const context = await request(worker.app).post('/api/demo-readiness/v1/contexts').set(auth).send({
      runId: 'run-input-shape', targetId: LANE.targetId, provider: LANE.provider, identityRef: LANE.identityRef,
    });
    const invalidInput = await request(worker.app)
      .post(`/api/demo-readiness/v1/contexts/${context.body.contextId}/operations`)
      .set(auth)
      .send({ operation: 'execute-case', targetId: LANE.targetId, provider: LANE.provider, identityRef: LANE.identityRef, input: [] });

    expect(malformed.status).toBe(400);
    expect(invalidInput.status).toBe(400);
    expect(JSON.stringify([malformed.body, invalidInput.body])).not.toContain(LANE.workerToken);
    await worker.close();
  });

  test('rejects operation input outside the checked-in case and feature contracts', async () => {
    const laneSession = session();
    const worker = service(jest.fn(async () => laneSession));
    const auth = { Authorization: `Bearer ${LANE.workerToken}` };
    const created = await request(worker.app).post('/api/demo-readiness/v1/contexts').set(auth).send({
      runId: 'run-reject-secrets', targetId: LANE.targetId, provider: LANE.provider, identityRef: LANE.identityRef,
    });
    const withCredentialField = await request(worker.app)
      .post(`/api/demo-readiness/v1/contexts/${created.body.contextId}/operations`)
      .set(auth)
      .send({
        operation: 'execute-case', targetId: LANE.targetId, provider: LANE.provider, identityRef: LANE.identityRef,
        input: uc40Input({ password: 'sentinel-password' }),
      });
    const withNestedCookie = await request(worker.app)
      .post(`/api/demo-readiness/v1/contexts/${created.body.contextId}/operations`)
      .set(auth)
      .send({
        operation: 'execute-case', targetId: LANE.targetId, provider: LANE.provider, identityRef: LANE.identityRef,
        input: uc40Input({ caseRow: { ...UC40_CASE, cookie: 'sentinel-cookie' } }),
      });

    expect(withCredentialField.status).toBe(400);
    expect(withNestedCookie.status).toBe(400);
    expect(laneSession.executeReadinessCase).not.toHaveBeenCalled();
    expect(JSON.stringify([withCredentialField.body, withNestedCookie.body])).not.toMatch(/sentinel-(password|cookie)/);
    await worker.close();
  });
});
