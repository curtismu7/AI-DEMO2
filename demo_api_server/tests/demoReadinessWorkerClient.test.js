'use strict';

const { createReadinessWorkerFactory } = require('../services/demoReadinessWorkerClient');

const LANE = { url: 'https://worker.local.example', token: 'worker-token-secret', identityRef: 'secret://readiness/local/pingone' };
const HEALTH = {
  status: 'ready', targetId: 'local', provider: 'pingone', identityRef: LANE.identityRef,
  workerId: 'worker-process-p1', capabilities: ['readiness-context-v1', 'readiness-case-v1', 'readiness-feature-v1'],
};
const CONTEXT = {
  status: 'ready', contextId: 'private-context-id', targetId: 'local', provider: 'pingone',
  identityRef: LANE.identityRef, workerId: HEALTH.workerId,
  runtimeId: 'runtime-p1', cookieJarId: 'cookies-p1', sessionStoreId: 'session-store-p1',
  userSession: { authenticated: true, provider: 'pingone', identityRef: LANE.identityRef },
};

function jsonResponse(value, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(value) };
}

function factory(fetchImpl) {
  return createReadinessWorkerFactory({
    config: { targets: { local: { workers: { pingone: LANE } } } },
    fetchImpl,
    runId: 'readiness-run-1',
  });
}

describe('demo readiness HTTPS worker client', () => {
  test('creates an authenticated provider-bound context and sends case operations through its private context', async () => {
    const fetchImpl = jest.fn(async (url) => {
      if (url.endsWith('/api/demo-readiness/v1/health')) return jsonResponse(HEALTH);
      if (url.endsWith('/api/demo-readiness/v1/contexts')) return jsonResponse(CONTEXT, 201);
      if (url.endsWith('/private-context-id/operations')) return jsonResponse({ result: { observed: 'PERMIT', evidence: { userSessionProvider: 'pingone' } } });
      if (url.endsWith('/private-context-id')) return jsonResponse({}, 204);
      return jsonResponse({ error: 'unexpected path' }, 404);
    });
    const workerFactory = factory(fetchImpl);

    const healthRows = await workerFactory.checkWorkers({ targets: ['local'], deadlineAt: Date.now() + 5_000 });
    expect(healthRows).toEqual([{ id: 'worker-health:local:pingone', status: 'pass', required: true, evidence: 'Dedicated PingOne worker is ready for local.' }]);
    const worker = await workerFactory.createWorker({ targetId: 'local', provider: 'pingone', deadlineAt: Date.now() + 5_000 });
    const operation = await worker.executeReadinessCase({
      caseRow: { id: 'UC40' }, vertical: 'banking', mode: 'live-id-jag',
      behavior: { kind: 'id-jag' }, authorization: { resourceServer: 'olb' },
      deadlineAt: Date.now() + 5_000,
    });

    expect(worker.provider).toBe('pingone');
    expect(operation).toEqual({ observed: 'PERMIT', evidence: { userSessionProvider: 'pingone' } });
    const createRequest = fetchImpl.mock.calls.find(([url]) => url.endsWith('/api/demo-readiness/v1/contexts'));
    expect(createRequest[1]).toMatchObject({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer worker-token-secret' }),
    });
    expect(JSON.parse(createRequest[1].body)).toMatchObject({
      runId: 'readiness-run-1', targetId: 'local', provider: 'pingone', identityRef: LANE.identityRef,
    });
    const operationRequest = fetchImpl.mock.calls.find(([url]) => url.endsWith('/private-context-id/operations'));
    expect(JSON.parse(operationRequest[1].body)).toMatchObject({
      operation: 'execute-case', targetId: 'local', provider: 'pingone', input: { caseRow: { id: 'UC40' }, mode: 'live-id-jag' },
    });
    expect(fetchImpl.mock.calls.find(([url]) => url.endsWith('/api/demo-readiness/v1/health'))[1].headers.Authorization)
      .toBe('Bearer worker-token-secret');
    await worker.dispose();
    expect(fetchImpl.mock.calls.some(([url, options]) => url.endsWith('/private-context-id') && options.method === 'DELETE')).toBe(true);
    expect(JSON.stringify(healthRows)).not.toContain('worker-token-secret');
  });

  test('blocks a worker whose health response names a different provider lane', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse({ ...HEALTH, provider: 'pingfederate' }));
    const workerFactory = factory(fetchImpl);

    const rows = await workerFactory.checkWorkers({ targets: ['local'], deadlineAt: Date.now() + 5_000 });

    expect(rows).toEqual([expect.objectContaining({
      id: 'worker-health:local:pingone', status: 'blocked',
      evidence: 'Worker identity or capabilities do not match the configured local PingOne lane.',
    })]);
  });

  test('cancels an oversized streamed worker response at the byte limit', async () => {
    const cancel = jest.fn();
    const oversized = new ReadableStream({
      pull(controller) { controller.enqueue(new Uint8Array(256 * 1024)); },
      cancel,
    });
    const fetchImpl = jest.fn(async () => ({ ok: true, status: 200, body: oversized, text: jest.fn() }));
    const rows = await factory(fetchImpl).checkWorkers({ targets: ['local'], deadlineAt: Date.now() + 5_000 });

    expect(rows[0]).toMatchObject({ id: 'worker-health:local:pingone', status: 'blocked', evidence: 'Readiness worker response exceeded the allowed size.' });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  test('routes the PF native ID-JAG proof through the feature-family operation', async () => {
    const pfLane = { url: 'https://worker.pf.local.example', token: 'pf-worker-token', identityRef: 'secret://readiness/local/pingfederate' };
    const pfHealth = {
      ...HEALTH, provider: 'pingfederate', identityRef: pfLane.identityRef, workerId: 'worker-process-pf',
    };
    const pfContext = {
      ...CONTEXT, contextId: 'private-pf-context-id', provider: 'pingfederate', identityRef: pfLane.identityRef,
      workerId: pfHealth.workerId, runtimeId: 'runtime-pf', cookieJarId: 'cookies-pf', sessionStoreId: 'session-store-pf',
      userSession: { authenticated: true, provider: 'pingfederate', identityRef: pfLane.identityRef },
    };
    const fetchImpl = jest.fn(async (url) => {
      if (url.endsWith('/api/demo-readiness/v1/health')) return jsonResponse(pfHealth);
      if (url.endsWith('/api/demo-readiness/v1/contexts')) return jsonResponse(pfContext, 201);
      if (url.endsWith('/operations')) return jsonResponse({ result: { observed: 'PERMIT' } });
      if (url.endsWith('/private-pf-context-id')) return jsonResponse({}, 204);
      return jsonResponse({}, 404);
    });
    const workerFactory = createReadinessWorkerFactory({
      config: { targets: { local: { workers: { pingfederate: pfLane } } } },
      fetchImpl, runId: 'readiness-pf-run',
    });
    const worker = await workerFactory.createWorker({ targetId: 'local', provider: 'pingfederate', deadlineAt: Date.now() + 5_000 });

    const result = await worker.executeNativeIdJagNegative({
      check: { id: 'PF-NATIVE-ID-JAG' },
      contract: { featureFamily: 'pf-native-id-jag', executionMode: 'pf-native-id-jag-negative' },
      deadlineAt: Date.now() + 5_000,
    });

    expect(result).toEqual({ observed: 'PERMIT' });
    const operation = fetchImpl.mock.calls.find(([url]) => url.endsWith('/operations'));
    expect(JSON.parse(operation[1].body)).toMatchObject({
      operation: 'execute-feature', targetId: 'local', provider: 'pingfederate',
      input: { featureFamily: 'pf-native-id-jag', check: { id: 'PF-NATIVE-ID-JAG' } },
    });
    await worker.dispose();
  });

  test('refuses to create a context unless the worker proves a matching authenticated user session', async () => {
    const fetchImpl = jest.fn(async (url) => {
      if (url.endsWith('/api/demo-readiness/v1/health')) return jsonResponse(HEALTH);
      return jsonResponse({ ...CONTEXT, userSession: { authenticated: false, provider: 'pingone', identityRef: LANE.identityRef } }, 201);
    });
    const workerFactory = factory(fetchImpl);

    await expect(workerFactory.createWorker({ targetId: 'local', provider: 'pingone', deadlineAt: Date.now() + 5_000 }))
      .rejects.toThrow('Worker did not establish the configured authenticated provider session.');
  });

  test('treats asynchronous acceptance without confirmed deletion as cleanup failure', async () => {
    const fetchImpl = jest.fn(async (url, options = {}) => {
      if (url.endsWith('/api/demo-readiness/v1/health')) return jsonResponse(HEALTH);
      if (url.endsWith('/api/demo-readiness/v1/contexts')) return jsonResponse(CONTEXT, 201);
      if (options.method === 'DELETE') return jsonResponse({}, 202);
      return jsonResponse({}, 404);
    });
    const worker = await factory(fetchImpl).createWorker({ targetId: 'local', provider: 'pingone', deadlineAt: Date.now() + 5_000 });

    await expect(worker.dispose()).rejects.toThrow('Readiness worker did not confirm context deletion.');
  });

  test('rejects a worker that reuses isolation identifiers across provider lanes', async () => {
    const secondLane = { url: 'https://worker.pf.local.example', token: 'pf-token', identityRef: 'secret://readiness/local/pingfederate' };
    const fetchImpl = jest.fn(async (url) => {
      if (url.includes('worker.pf.local.example') && url.endsWith('/api/demo-readiness/v1/health')) return jsonResponse({
        ...HEALTH, provider: 'pingfederate', identityRef: secondLane.identityRef, workerId: 'worker-process-pf',
      });
      if (url.endsWith('/api/demo-readiness/v1/health')) return jsonResponse(HEALTH);
      if (url.includes('worker.pf.local.example')) return jsonResponse({
        ...CONTEXT, contextId: 'context-pf', provider: 'pingfederate', identityRef: secondLane.identityRef,
        workerId: 'worker-process-pf', runtimeId: CONTEXT.runtimeId,
        userSession: { authenticated: true, provider: 'pingfederate', identityRef: secondLane.identityRef },
      }, 201);
      return jsonResponse(CONTEXT, 201);
    });
    const workerFactory = createReadinessWorkerFactory({
      config: { targets: { local: { workers: { pingone: LANE, pingfederate: secondLane } } } },
      fetchImpl, runId: 'readiness-run-2',
    });

    await workerFactory.createWorker({ targetId: 'local', provider: 'pingone', deadlineAt: Date.now() + 5_000 });
    await expect(workerFactory.createWorker({ targetId: 'local', provider: 'pingfederate', deadlineAt: Date.now() + 5_000 }))
      .rejects.toThrow('Worker runtime, cookie jar, and session store must be unique per target/provider lane.');
  });

  test('does not put worker credentials or context identifiers in health errors', async () => {
    const fetchImpl = jest.fn(async () => { throw new Error('failed https://worker.local.example/private-context-id worker-token-secret'); });
    const workerFactory = factory(fetchImpl);

    const rows = await workerFactory.checkWorkers({ targets: ['local'], deadlineAt: Date.now() + 5_000 });

    expect(rows[0].status).toBe('blocked');
    expect(JSON.stringify(rows)).not.toMatch(/worker-token-secret|private-context-id|worker\.local\.example/);
  });

  test('cancels an unresponsive health request at the shared deadline and reports it as not-run', async () => {
    const fetchImpl = jest.fn((url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('request aborted')), { once: true });
    }));
    const workerFactory = factory(fetchImpl);
    const startedAt = Date.now();

    const rows = await workerFactory.checkWorkers({ targets: ['local'], deadlineAt: startedAt + 35 });

    expect(rows).toEqual([expect.objectContaining({ id: 'worker-health:local:pingone', status: 'not-run' })]);
    expect(Date.now() - startedAt).toBeLessThan(500);
  });
});
