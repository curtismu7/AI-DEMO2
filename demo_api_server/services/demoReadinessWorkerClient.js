'use strict';

const crypto = require('crypto');
const { FEATURE_DISPATCHERS } = require('./demoReadinessExecutionService');

const API_PATH = '/api/demo-readiness/v1';
const REQUIRED_CAPABILITIES = Object.freeze([
  'readiness-context-v1',
  'readiness-case-v1',
  'readiness-feature-v1',
]);
const MAX_RESPONSE_BYTES = 512 * 1024;
const CLEANUP_TIMEOUT_MS = 5_000;

function endpoint(baseUrl, path) {
  return baseUrl.replace(/\/+$/, '') + API_PATH + path;
}

function laneKey(targetId, provider) {
  return `${targetId}:${provider}`;
}

function workerError(message, code = 'readiness_worker_unavailable') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function requestSignal({ deadlineAt, signal, cleanup = false } = {}) {
  const signals = [];
  if (signal) signals.push(signal);
  if (cleanup) signals.push(AbortSignal.timeout(CLEANUP_TIMEOUT_MS));
  else if (deadlineAt) {
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) throw workerError('Readiness worker deadline expired.', 'readiness_deadline_exceeded');
    signals.push(AbortSignal.timeout(remaining));
  }
  if (!signals.length) return undefined;
  return signals.length === 1 ? signals[0] : AbortSignal.any(signals);
}

function validIdentifier(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\x00-\x20\x7f]/.test(value);
}

function validLaneConfig(lane) {
  if (!lane || typeof lane !== 'object' || !lane.url || !lane.token || !lane.identityRef) return false;
  try {
    const url = new URL(lane.url);
    return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

async function readBoundedResponse(response) {
  const contentLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    throw workerError('Readiness worker response exceeded the allowed size.', 'readiness_worker_response_too_large');
  }
  const reader = response.body?.getReader?.();
  if (!reader) {
    const raw = await response.text();
    if (Buffer.byteLength(raw) > MAX_RESPONSE_BYTES) {
      throw workerError('Readiness worker response exceeded the allowed size.', 'readiness_worker_response_too_large');
    }
    return raw;
  }

  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    totalBytes += chunk.byteLength;
    if (totalBytes > MAX_RESPONSE_BYTES) {
      try { await reader.cancel(); } catch { /* response will be discarded */ }
      throw workerError('Readiness worker response exceeded the allowed size.', 'readiness_worker_response_too_large');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, totalBytes).toString('utf8');
}

function createReadinessWorkerFactory({ config, fetchImpl = globalThis.fetch, runId = crypto.randomUUID() } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required');
  if (typeof runId !== 'string' || !runId) throw new TypeError('readiness run ID is required');

  const healthByLane = new Map();
  const workerIds = new Map();
  const isolationIds = new Map();
  const activeContexts = new Set();

  function laneConfig(targetId, provider) {
    const lane = config?.targets?.[targetId]?.workers?.[provider];
    if (!validLaneConfig(lane)) throw workerError(`Worker settings are incomplete for ${targetId} ${provider}.`, 'readiness_worker_config_missing');
    return lane;
  }

  async function request(lane, path, { method = 'GET', body, deadlineAt, signal, cleanup = false } = {}) {
    let response;
    try {
      response = await fetchImpl(endpoint(lane.url, path), {
        method,
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer ' + lane.token,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        redirect: 'error',
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: requestSignal({ deadlineAt, signal, cleanup }),
      });
    } catch (error) {
      if (signal?.aborted || (deadlineAt && Date.now() >= deadlineAt)) {
        throw workerError('Readiness worker request was cancelled or timed out.', 'readiness_worker_timeout');
      }
      if (cleanup) throw workerError('Readiness worker context cleanup request failed.', 'readiness_worker_cleanup_failed');
      throw workerError('Readiness worker request failed.', 'readiness_worker_unavailable');
    }
    if (!response?.ok) {
      throw workerError(`Readiness worker returned HTTP ${response?.status || 'unknown'}.`, cleanup ? 'readiness_worker_cleanup_failed' : 'readiness_worker_unavailable');
    }
    if (cleanup && ![200, 204].includes(response.status)) {
      throw workerError('Readiness worker did not confirm context deletion.', 'readiness_worker_cleanup_failed');
    }
    let raw;
    try {
      raw = await readBoundedResponse(response);
    } catch (error) {
      if (error?.code === 'readiness_worker_response_too_large') throw error;
      throw workerError('Readiness worker response could not be read.');
    }
    if (!raw) return {};
    try {
      return JSON.parse(raw);
    } catch {
      throw workerError('Readiness worker returned invalid JSON.');
    }
  }

  async function inspectLane({ targetId, provider, deadlineAt, signal } = {}) {
    const lane = laneConfig(targetId, provider);
    const health = await request(lane, '/health', { deadlineAt, signal });
    const isValid = health?.status === 'ready'
      && health.targetId === targetId
      && health.provider === provider
      && health.identityRef === lane.identityRef
      && validIdentifier(health.workerId)
      && REQUIRED_CAPABILITIES.every((capability) => Array.isArray(health.capabilities) && health.capabilities.includes(capability));
    const providerLabel = provider === 'pingone' ? 'PingOne' : 'PingFederate';
    if (!isValid) throw workerError(`Worker identity or capabilities do not match the configured ${targetId} ${providerLabel} lane.`);

    const key = laneKey(targetId, provider);
    const existingOwner = workerIds.get(health.workerId);
    if (existingOwner && existingOwner !== key) throw workerError('Worker process identity is reused across target/provider lanes.', 'provider_isolation_unavailable');
    workerIds.set(health.workerId, key);
    const record = { targetId, provider, lane, workerId: health.workerId };
    healthByLane.set(key, record);
    return record;
  }

  async function checkWorkers({ targets = ['local', 'se'], deadlineAt, signal } = {}) {
    const rows = [];
    for (const targetId of targets) {
      for (const provider of ['pingone', 'pingfederate']) {
        const key = laneKey(targetId, provider);
        const lane = config?.targets?.[targetId]?.workers?.[provider];
        if (!validLaneConfig(lane)) continue;
        try {
          await inspectLane({ targetId, provider, deadlineAt, signal });
          rows.push({
            id: 'worker-health:' + key,
            status: 'pass',
            required: true,
            evidence: `Dedicated ${provider === 'pingone' ? 'PingOne' : 'PingFederate'} worker is ready for ${targetId}.`,
          });
        } catch (error) {
          rows.push({
            id: 'worker-health:' + key,
            status: signal?.aborted || ['readiness_deadline_exceeded', 'readiness_worker_timeout'].includes(error.code) ? 'not-run' : 'blocked',
            required: true,
            evidence: error.message || 'Readiness worker health check failed.',
          });
        }
      }
    }
    return rows;
  }

  async function createWorker({ targetId, provider, identityRef, deadlineAt, abortSignal } = {}) {
    const key = laneKey(targetId, provider);
    const lane = laneConfig(targetId, provider);
    if (identityRef && identityRef !== lane.identityRef) throw workerError('Requested readiness identity does not match the configured provider lane.', 'provider_isolation_unavailable');
    const health = healthByLane.get(key) || await inspectLane({ targetId, provider, deadlineAt, signal: abortSignal });
    const created = await request(lane, '/contexts', {
      method: 'POST',
      deadlineAt,
      signal: abortSignal,
      body: { runId, targetId, provider, identityRef: lane.identityRef },
    });
    const userSession = created?.userSession;
    const contextValid = created?.status === 'ready'
      && validIdentifier(created.contextId)
      && created.targetId === targetId
      && created.provider === provider
      && created.identityRef === lane.identityRef
      && created.workerId === health.workerId
      && validIdentifier(created.runtimeId)
      && validIdentifier(created.cookieJarId)
      && validIdentifier(created.sessionStoreId)
      && userSession?.authenticated === true
      && userSession.provider === provider
      && userSession.identityRef === lane.identityRef;
    if (!contextValid) {
      if (validIdentifier(created?.contextId)) await bestEffortDelete(lane, created.contextId);
      throw workerError('Worker did not establish the configured authenticated provider session.', 'provider_isolation_unavailable');
    }

    const ids = [created.runtimeId, created.cookieJarId, created.sessionStoreId];
    if (ids.some((id) => isolationIds.has(id)) || new Set(ids).size !== ids.length) {
      await bestEffortDelete(lane, created.contextId);
      throw workerError('Worker runtime, cookie jar, and session store must be unique per target/provider lane.', 'provider_isolation_unavailable');
    }
    ids.forEach((id, index) => isolationIds.set(id, { key, type: ['runtime', 'cookie jar', 'session store'][index] }));

    const contextState = { targetId, provider, lane, contextId: created.contextId, disposed: false };
    activeContexts.add(contextState);
    const sendOperation = async (operation, input, requestOptions = {}) => {
      if (contextState.disposed) throw workerError('Readiness worker context has already been closed.', 'readiness_worker_context_closed');
      const result = await request(lane, '/contexts/' + encodeURIComponent(contextState.contextId) + '/operations', {
        method: 'POST',
        deadlineAt: requestOptions.deadlineAt,
        signal: requestOptions.signal,
        body: { operation, targetId, provider, identityRef: lane.identityRef, input },
      });
      if (!result || typeof result !== 'object' || !result.result || typeof result.result !== 'object') {
        throw workerError('Readiness worker operation returned an incomplete result.');
      }
      return result.result;
    };
    const worker = {
      provider,
      runtime: { id: created.runtimeId },
      cookieJar: { id: created.cookieJarId },
      sessionStore: { id: created.sessionStoreId },
      async verifyPrerequisites({ caseRow, vertical, prerequisites, deadlineAt: operationDeadline } = {}) {
        return sendOperation('verify-case-prerequisites', { caseRow, vertical, prerequisites }, { deadlineAt: operationDeadline });
      },
      async executeReadinessCase({ caseRow, vertical, mode, behavior, authorization, deadlineAt: operationDeadline, abortSignal: signal } = {}) {
        return sendOperation('execute-case', { caseRow, vertical, mode, behavior, authorization }, { deadlineAt: operationDeadline, signal });
      },
      async verifyFeaturePrerequisites({ check, configurationDependencies, deadlineAt: operationDeadline, abortSignal: signal } = {}) {
        return sendOperation('verify-feature-prerequisites', { check, configurationDependencies }, { deadlineAt: operationDeadline, signal });
      },
      async dispose() {
        if (contextState.disposed) return;
        try {
          await request(lane, '/contexts/' + encodeURIComponent(contextState.contextId), { method: 'DELETE', cleanup: true });
          contextState.disposed = true;
          activeContexts.delete(contextState);
        } catch (error) {
          throw workerError(error.code === 'readiness_worker_cleanup_failed'
            ? error.message
            : 'Readiness worker context cleanup failed.', 'readiness_worker_cleanup_failed');
        }
      },
    };
    for (const [family, method] of Object.entries(FEATURE_DISPATCHERS)) {
      worker[method] = async ({ check, contract, deadlineAt: operationDeadline, abortSignal: signal } = {}) => sendOperation(
        'execute-feature', { featureFamily: family, check, contract }, { deadlineAt: operationDeadline, signal },
      );
    }
    return worker;
  }

  async function bestEffortDelete(lane, contextId) {
    try {
      await request(lane, '/contexts/' + encodeURIComponent(contextId), { method: 'DELETE', cleanup: true });
    } catch { /* The original context validation failure is the actionable finding. */ }
  }

  async function disposeAll() {
    const failures = [];
    for (const context of [...activeContexts]) {
      try {
        await request(context.lane, '/contexts/' + encodeURIComponent(context.contextId), { method: 'DELETE', cleanup: true });
        context.disposed = true;
        activeContexts.delete(context);
      } catch {
        failures.push({ targetId: context.targetId, provider: context.provider });
      }
    }
    return { status: failures.length ? 'fail' : 'pass', failures };
  }

  return { checkWorkers, createWorker, disposeAll };
}

module.exports = {
  API_PATH,
  REQUIRED_CAPABILITIES,
  createReadinessWorkerFactory,
};
