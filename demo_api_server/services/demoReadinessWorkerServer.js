'use strict';

const crypto = require('node:crypto');
const express = require('express');
const { FEATURE_DISPATCHERS } = require('./demoReadinessExecutionService');
const { buildDemoReadinessCatalog } = require('./demoReadinessCatalog');
const { redactReadinessValue } = require('./demoReadinessReport');
const featureManifest = require('../config/demoReadinessFeatureChecks.json');

const MAX_REQUEST_BYTES = 512 * 1024;
const MAX_RESPONSE_BYTES = 512 * 1024;
const DEFAULT_CONTEXT_TTL_MS = 20 * 60 * 1000;
const DEFAULT_CREATE_TIMEOUT_MS = 60 * 1000;
const DEFAULT_OPERATION_TIMEOUT_MS = 90 * 1000;
const DEFAULT_CLEANUP_TIMEOUT_MS = 5 * 1000;
const MAX_CONTEXT_TTL_MS = 30 * 60 * 1000;
const MAX_CREATE_TIMEOUT_MS = 2 * 60 * 1000;
const MAX_OPERATION_TIMEOUT_MS = 2 * 60 * 1000;
const MAX_CLEANUP_TIMEOUT_MS = 10 * 1000;
const MAX_CONTEXTS = 8;
const MAX_SWEEP_INTERVAL_MS = 60 * 1000;
const CAPABILITIES = Object.freeze([
  'readiness-context-v1',
  'readiness-case-v1',
  'readiness-feature-v1',
]);
const PROVIDERS = new Set(['pingone', 'pingfederate']);
const RUN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SOURCE_CASES = new Map(buildDemoReadinessCatalog().map((caseRow) => [caseRow.id, caseRow]));
const SOURCE_FEATURE_CHECKS = new Map(featureManifest.checks.map((check) => [check.id, check]));

function validOpaqueId(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 256
    && ![...value].some((character) => {
      const code = character.codePointAt(0);
      return code <= 0x20 || code === 0x7f;
    });
}

function validTargetId(value) {
  return typeof value === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(value);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sameSourceValue(actual, expected) {
  const canonical = (value) => {
    if (Array.isArray(value)) return value.map(canonical);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  };
  try {
    return JSON.stringify(canonical(actual)) === JSON.stringify(canonical(expected));
  } catch {
    return false;
  }
}

function hasExactKeys(value, keys) {
  return isPlainObject(value)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}

function caseSupportsVertical(caseRow, vertical) {
  return caseRow.runtimeVerticalGroups?.some((group) => group.vertical === vertical || group.verticals?.includes(vertical))
    || Object.hasOwn(caseRow.expectedBehaviorByVertical || {}, vertical);
}

function checkedCaseInput(operation, input, provider) {
  const inputKeys = operation === 'verify-case-prerequisites'
    ? ['caseRow', 'vertical', 'prerequisites']
    : ['caseRow', 'vertical', 'mode', 'behavior', 'authorization'];
  if (!hasExactKeys(input, inputKeys) || !isPlainObject(input.caseRow) || typeof input.vertical !== 'string') return null;
  const caseRow = SOURCE_CASES.get(input.caseRow.id);
  if (!caseRow || !sameSourceValue(input.caseRow, caseRow)
    || !caseRow.providerFlows?.[provider] || !caseSupportsVertical(caseRow, input.vertical)) return null;
  if (operation === 'verify-case-prerequisites') {
    const prerequisites = caseRow.runtimePrerequisitesByVertical?.[input.vertical];
    if (!prerequisites || !sameSourceValue(input.prerequisites, prerequisites)) return null;
    return { caseRow, vertical: input.vertical, prerequisites };
  }
  const behaviorCandidates = [
    caseRow.expectedBehaviorByVertical?.[input.vertical],
    ...(caseRow.runtimeVerticalGroups || [])
      .filter((group) => group.vertical === input.vertical || group.verticals?.includes(input.vertical))
      .map((group) => group.expectedBehavior),
    ...(caseRow.alternateBehaviors || []),
  ].filter(Boolean);
  const authorization = caseRow.authorizationContractByVertical?.[input.vertical];
  if (input.mode !== caseRow.executionMode
    || !behaviorCandidates.some((behavior) => sameSourceValue(input.behavior, behavior))
    || !authorization
    || !sameSourceValue(input.authorization, authorization)) return null;
  const behavior = behaviorCandidates.find((candidate) => sameSourceValue(input.behavior, candidate));
  return { caseRow, vertical: input.vertical, mode: caseRow.executionMode, behavior, authorization };
}

function checkedFeatureInput(operation, input, provider) {
  const inputKeys = operation === 'verify-feature-prerequisites'
    ? ['check', 'configurationDependencies']
    : ['featureFamily', 'check', 'contract'];
  if (!hasExactKeys(input, inputKeys) || !isPlainObject(input.check)) return null;
  const check = SOURCE_FEATURE_CHECKS.get(input.check.id);
  const contract = featureManifest.contracts?.[input.check.id];
  if (!check || !contract || !check.providers?.includes(provider) || !sameSourceValue(input.check, check)) return null;
  if (operation === 'verify-feature-prerequisites') {
    const dependencies = check.configurationDependencies || [];
    if (!Array.isArray(input.configurationDependencies)
      || !sameSourceValue(input.configurationDependencies, dependencies)) return null;
    return { check, configurationDependencies: dependencies };
  }
  if (input.featureFamily !== contract.featureFamily
    || !Object.hasOwn(FEATURE_DISPATCHERS, contract.featureFamily)
    || (contract.featureFamily.startsWith('pf-') && provider !== 'pingfederate')
    || !sameSourceValue(input.contract, contract)) return null;
  return { featureFamily: contract.featureFamily, check, contract };
}

function checkedOperationInput(operation, input, provider) {
  switch (operation) {
    case 'verify-case-prerequisites':
    case 'execute-case':
      return checkedCaseInput(operation, input, provider);
    case 'verify-feature-prerequisites':
    case 'execute-feature':
      return checkedFeatureInput(operation, input, provider);
    default:
      return null;
  }
}

function abortError() {
  const error = new Error('Readiness worker request was cancelled.');
  error.code = 'aborted';
  return error;
}

function contextClosedError() {
  const error = new Error('Readiness worker context is closing.');
  error.code = 'context-closed';
  return error;
}

function timeoutError() {
  const error = new Error('Readiness worker operation timed out.');
  error.code = 'timeout';
  return error;
}

function makeRequestAbortSignal(req, res) {
  const controller = new AbortController();
  const abort = () => controller.abort(abortError());
  req.once('aborted', abort);
  res.once('close', () => {
    if (!res.writableEnded) abort();
  });
  if (req.aborted || (res.destroyed && !res.writableEnded)) abort();
  return controller;
}

function raceWithTimeout(task, { timeoutMs, signal, timeoutErrorFactory = timeoutError } = {}) {
  let timer;
  let abortListener;
  const pending = Promise.resolve().then(task);
  const contenders = [pending];
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    contenders.push(new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(timeoutErrorFactory());
      }, timeoutMs);
      timer.unref?.();
    }));
  }
  const cancelled = signal ? new Promise((_, reject) => {
    abortListener = () => reject(signal.reason?.code ? signal.reason : abortError());
    if (signal.aborted) abortListener();
    else signal.addEventListener('abort', abortListener, { once: true });
  }) : null;
  if (cancelled) contenders.push(cancelled);
  return Promise.race(contenders)
    .finally(() => {
      clearTimeout(timer);
      if (abortListener) signal.removeEventListener('abort', abortListener);
    });
}

function createReadinessWorkerHttpService({
  targetId,
  provider,
  identityRef,
  workerToken,
  createSession,
  contextTtlMs = DEFAULT_CONTEXT_TTL_MS,
  createTimeoutMs = DEFAULT_CREATE_TIMEOUT_MS,
  operationTimeoutMs = DEFAULT_OPERATION_TIMEOUT_MS,
  cleanupTimeoutMs = DEFAULT_CLEANUP_TIMEOUT_MS,
  maxContexts = 2,
  sweepIntervalMs = 15_000,
  now = Date.now,
} = {}) {
  if (!validTargetId(targetId)) throw new TypeError('A valid readiness worker target is required.');
  if (!PROVIDERS.has(provider)) throw new TypeError('A supported readiness worker provider is required.');
  if (!validOpaqueId(identityRef)) throw new TypeError('A readiness worker identity reference is required.');
  if (typeof workerToken !== 'string' || workerToken.length < 32 || workerToken.length > 512) {
    throw new TypeError('A readiness worker bearer token of at least 32 characters is required.');
  }
  if (typeof createSession !== 'function') throw new TypeError('A readiness worker session adapter is required.');
  for (const [name, value] of Object.entries({ contextTtlMs, createTimeoutMs, operationTimeoutMs, cleanupTimeoutMs, maxContexts, sweepIntervalMs })) {
    if (!Number.isFinite(value) || value <= 0) throw new TypeError(`A positive ${name} is required.`);
  }
  if (!Number.isInteger(maxContexts)) throw new TypeError('maxContexts must be an integer.');
  if (contextTtlMs > MAX_CONTEXT_TTL_MS
    || createTimeoutMs > MAX_CREATE_TIMEOUT_MS
    || operationTimeoutMs > MAX_OPERATION_TIMEOUT_MS
    || cleanupTimeoutMs > MAX_CLEANUP_TIMEOUT_MS
    || maxContexts > MAX_CONTEXTS
    || sweepIntervalMs > MAX_SWEEP_INTERVAL_MS) {
    throw new TypeError('Readiness worker limits exceed the supported maximum.');
  }

  const workerId = crypto.randomUUID();
  const tokenDigest = crypto.createHash('sha256').update(workerToken, 'utf8').digest();
  const contexts = new Map();
  const contextsByRunId = new Map();
  const pendingByRunId = new Map();
  const closingByContextId = new Map();
  let closed = false;
  let cleanupFailed = false;

  function authorized(req) {
    const match = /^Bearer ([^\s]+)$/i.exec(req.get('authorization') || '');
    if (!match) return false;
    const presentedDigest = crypto.createHash('sha256').update(match[1], 'utf8').digest();
    return crypto.timingSafeEqual(tokenDigest, presentedDigest);
  }

  function sendError(res, status, message) {
    return res.status(status).json({ error: message });
  }

  function matchesLane(body) {
    return body?.targetId === targetId && body?.provider === provider && body?.identityRef === identityRef;
  }

  function laneForRequest(req, res) {
    if (!matchesLane(req.body)) {
      sendError(res, 409, 'Requested worker target, provider, or identity does not match this lane.');
      return false;
    }
    return true;
  }

  function checkAndNormalizeSession(session) {
    const userSession = session?.userSession;
    const ids = [session?.runtimeId, session?.cookieJarId, session?.sessionStoreId];
    if (!session || typeof session !== 'object'
      || userSession?.authenticated !== true
      || userSession.provider !== provider
      || userSession.identityRef !== identityRef
      || ids.some((id) => !validOpaqueId(id))
      || new Set(ids).size !== ids.length
      || typeof session.dispose !== 'function') return null;
    for (const context of contexts.values()) {
      const activeIds = [context.session.runtimeId, context.session.cookieJarId, context.session.sessionStoreId];
      if (ids.some((id) => activeIds.includes(id))) return null;
    }
    return {
      authenticated: true,
      provider,
      identityRef,
    };
  }

  async function disposeSession(session) {
    if (session === null || session === undefined || (typeof session !== 'object' && typeof session !== 'function')) return;
    if (typeof session.dispose !== 'function') {
      cleanupFailed = true;
      throw new Error('Readiness worker context cleanup failed.');
    }
    try {
      await raceWithTimeout(() => session.dispose(), { timeoutMs: cleanupTimeoutMs });
    } catch {
      cleanupFailed = true;
      throw new Error('Readiness worker context cleanup failed.');
    }
  }

  async function disposeContext(context) {
    if (!context) return;
    if (context.disposePromise) return context.disposePromise;
    context.closing = true;
    context.disposePromise = (async () => {
      for (const controller of context.operationControllers) controller.abort(contextClosedError());
      if (context.operationPromise) {
        await raceWithTimeout(() => context.operationPromise.catch(() => {}), { timeoutMs: cleanupTimeoutMs }).catch(() => {});
      }
      await disposeSession(context.session);
      contexts.delete(context.contextId);
      if (contextsByRunId.get(context.runId) === context) contextsByRunId.delete(context.runId);
    })().catch(() => {
      context.cleanupFailed = true;
      cleanupFailed = true;
      throw new Error('Readiness worker context cleanup failed.');
    });
    closingByContextId.set(context.contextId, context.disposePromise);
    context.disposePromise.finally(() => {
      if (closingByContextId.get(context.contextId) === context.disposePromise) {
        closingByContextId.delete(context.contextId);
      }
    }).catch(() => {});
    return context.disposePromise;
  }

  async function sweepExpired() {
    const cutoff = now();
    const expired = [...contexts.values()].filter((context) => context.expiresAt <= cutoff);
    await Promise.allSettled(expired.map((context) => disposeContext(context)));
    return expired.length;
  }

  async function establishContext(runId, controller) {
    const { signal } = controller;
    const existing = contextsByRunId.get(runId);
    if (existing && !existing.closing && existing.expiresAt > now()) return { context: existing, created: false };
    if (existing) {
      try {
        await disposeContext(existing);
      } catch {
        const error = new Error('Worker could not confirm cleanup of the previous readiness context.');
        error.code = 'cleanup-failed';
        throw error;
      }
    }

    let session;
    const creation = Promise.resolve().then(() => {
      if (signal.aborted) throw signal.reason?.code ? signal.reason : abortError();
      return createSession({ targetId, provider, identityRef, runId, signal });
    });
    try {
      session = await raceWithTimeout(() => creation, {
        timeoutMs: createTimeoutMs,
        signal,
      });
    } catch (error) {
      if (error?.code === 'timeout' || signal.aborted) {
        if (!signal.aborted) controller.abort(error);
        try {
          const lateSession = await raceWithTimeout(() => creation, {
            timeoutMs: cleanupTimeoutMs,
            timeoutErrorFactory: () => {
              const drainTimeout = timeoutError();
              drainTimeout.code = 'cleanup-drain-timeout';
              return drainTimeout;
            },
          });
          await disposeSession(lateSession);
        } catch (cleanupError) {
          if (cleanupError?.code === 'cleanup-drain-timeout') {
            cleanupFailed = true;
            creation.then((lateSession) => disposeSession(lateSession)).catch(() => {});
          }
          if (cleanupFailed) {
            const failure = new Error('Readiness worker could not confirm session setup cleanup.');
            failure.code = 'cleanup-failed';
            throw failure;
          }
        }
      }
      throw error;
    }

    const userSession = checkAndNormalizeSession(session);
    if (!userSession) {
      await disposeSession(session).catch(() => {});
      const error = new Error('Worker could not establish the configured authenticated session.');
      error.code = 'invalid-session';
      throw error;
    }
    const context = {
      contextId: crypto.randomUUID(),
      runId,
      createdAt: now(),
      expiresAt: now() + contextTtlMs,
      session,
      userSession,
      busy: false,
      closing: false,
      operationControllers: new Set(),
      operationPromise: null,
    };
    contexts.set(context.contextId, context);
    contextsByRunId.set(runId, context);
    return { context, created: true };
  }

  function startContextCreation(runId) {
    const entry = { controller: new AbortController(), waiters: 0, settled: false, promise: null };
    pendingByRunId.set(runId, entry);
    entry.promise = establishContext(runId, entry.controller)
      .then(({ context }) => context)
      .finally(() => {
        entry.settled = true;
        if (pendingByRunId.get(runId) === entry) pendingByRunId.delete(runId);
      });
    return entry;
  }

  async function awaitContextCreation(entry, requestSignal) {
    entry.waiters += 1;
    try {
      return await raceWithTimeout(() => entry.promise, { signal: requestSignal });
    } finally {
      entry.waiters -= 1;
      if (entry.waiters === 0 && !entry.settled) entry.controller.abort(abortError());
    }
  }

  function contextPayload(context) {
    return {
      status: 'ready',
      targetId,
      provider,
      identityRef,
      workerId,
      contextId: context.contextId,
      runtimeId: context.session.runtimeId,
      cookieJarId: context.session.cookieJarId,
      sessionStoreId: context.session.sessionStoreId,
      userSession: context.userSession,
    };
  }

  async function executeOperation(context, operation, input, signal) {
    const operationInput = checkedOperationInput(operation, input, provider);
    if (!operationInput) {
      const error = new Error('Readiness operation input does not match the checked-in lane contract.');
      error.code = 'invalid-input';
      throw error;
    }
    let method;
    if (operation === 'verify-case-prerequisites') method = context.session.verifyPrerequisites;
    else if (operation === 'execute-case') method = context.session.executeReadinessCase;
    else if (operation === 'verify-feature-prerequisites') method = context.session.verifyFeaturePrerequisites;
    else if (operation === 'execute-feature') {
      const family = operationInput.featureFamily;
      const methodName = FEATURE_DISPATCHERS[family];
      if (!Object.hasOwn(FEATURE_DISPATCHERS, family) || !methodName) {
        const error = new Error('Requested readiness feature is not supported by this provider lane.');
        error.code = 'invalid-operation';
        throw error;
      }
      method = context.session[methodName];
    } else {
      const error = new Error('Requested readiness operation is not supported.');
      error.code = 'invalid-operation';
      throw error;
    }
    if (typeof method !== 'function') {
      const error = new Error('Configured worker adapter does not implement this readiness operation.');
      error.code = 'unsupported-operation';
      throw error;
    }
    const result = await raceWithTimeout(
      () => method.call(context.session, { ...operationInput, signal }),
      { timeoutMs: operationTimeoutMs, signal },
    );
    if (!isPlainObject(result) && !Array.isArray(result)) {
      const error = new Error('Readiness operation returned an invalid result.');
      error.code = 'invalid-result';
      throw error;
    }
    const safeResult = redactReadinessValue(result);
    const encoded = JSON.stringify({ result: safeResult });
    if (Buffer.byteLength(encoded) > MAX_RESPONSE_BYTES) {
      const error = new Error('Readiness operation result exceeded the allowed size.');
      error.code = 'result-too-large';
      throw error;
    }
    return safeResult;
  }

  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    if (!authorized(req)) return sendError(res, 401, 'Worker authentication is required.');
    return next();
  });
  app.use(express.json({ limit: MAX_REQUEST_BYTES, strict: true }));

  app.get('/api/demo-readiness/v1/health', (_req, res) => {
    res.json({
      status: closed || cleanupFailed ? 'unavailable' : 'ready',
      targetId,
      provider,
      identityRef,
      workerId,
      capabilities: CAPABILITIES,
    });
  });

  app.post('/api/demo-readiness/v1/contexts', async (req, res) => {
    if (closed || cleanupFailed) return sendError(res, 503, 'Readiness worker is unavailable.');
    if (!isPlainObject(req.body)) return sendError(res, 400, 'A valid readiness context request is required.');
    if (!laneForRequest(req, res)) return undefined;
    const { runId } = req.body;
    if (typeof runId !== 'string' || !RUN_ID_RE.test(runId)) return sendError(res, 400, 'A valid readiness run ID is required.');
    const existing = contextsByRunId.get(runId);
    if (existing && !existing.closing && existing.expiresAt > now()) return res.json(contextPayload(existing));
    const requestController = makeRequestAbortSignal(req, res);
    if (requestController.signal.aborted) return undefined;
    const awaitEntry = async (entry, created) => {
      try {
        const context = await awaitContextCreation(entry, requestController.signal);
        return res.status(created ? 201 : 200).json(contextPayload(context));
      } catch (error) {
        if (cleanupFailed || error?.code === 'cleanup-failed') return sendError(res, 503, 'Readiness worker could not confirm session cleanup.');
        if (error?.code === 'invalid-session') return sendError(res, 502, 'Worker could not establish the configured authenticated session.');
        if (error?.code === 'timeout') return sendError(res, 504, 'Readiness worker session setup timed out.');
        if (error?.code === 'aborted' || requestController.signal.aborted) return undefined;
        return sendError(res, 502, 'Readiness worker session setup failed.');
      }
    };
    const pendingEntry = pendingByRunId.get(runId);
    if (pendingEntry && !pendingEntry.controller.signal.aborted) return awaitEntry(pendingEntry, false);
    if (pendingEntry) {
      await pendingEntry.promise.catch(() => {});
      if (requestController.signal.aborted) return undefined;
      const contextAfterAbortedSetup = contextsByRunId.get(runId);
      if (contextAfterAbortedSetup && !contextAfterAbortedSetup.closing && contextAfterAbortedSetup.expiresAt > now()) {
        return res.json(contextPayload(contextAfterAbortedSetup));
      }
    }
    await sweepExpired();
    if (requestController.signal.aborted) return undefined;
    if (closed || cleanupFailed) return sendError(res, 503, 'Readiness worker is unavailable.');
    const contextAfterSweep = contextsByRunId.get(runId);
    if (contextAfterSweep && !contextAfterSweep.closing && contextAfterSweep.expiresAt > now()) {
      return res.json(contextPayload(contextAfterSweep));
    }
    let pendingEntryAfterSweep = pendingByRunId.get(runId);
    if (pendingEntryAfterSweep?.controller.signal.aborted) {
      await pendingEntryAfterSweep.promise.catch(() => {});
      if (requestController.signal.aborted) return undefined;
      const contextAfterAbortedSetup = contextsByRunId.get(runId);
      if (contextAfterAbortedSetup && !contextAfterAbortedSetup.closing && contextAfterAbortedSetup.expiresAt > now()) {
        return res.json(contextPayload(contextAfterAbortedSetup));
      }
      pendingEntryAfterSweep = pendingByRunId.get(runId);
    }
    if (pendingEntryAfterSweep) return awaitEntry(pendingEntryAfterSweep, false);
    if (contexts.size + pendingByRunId.size >= maxContexts) return sendError(res, 429, 'Readiness worker has no available context capacity.');
    return awaitEntry(startContextCreation(runId), true);
  });

  app.post('/api/demo-readiness/v1/contexts/:contextId/operations', async (req, res) => {
    if (closed || cleanupFailed) return sendError(res, 503, 'Readiness worker is unavailable.');
    if (!isPlainObject(req.body)) return sendError(res, 400, 'A valid readiness operation request is required.');
    if (!laneForRequest(req, res)) return undefined;
    const context = contexts.get(req.params.contextId);
    if (!context || context.closing || context.expiresAt <= now()) {
      if (context) await disposeContext(context).catch(() => {});
      return sendError(res, 404, 'Readiness worker context was not found.');
    }
    if (context.busy) return sendError(res, 409, 'Readiness worker context already has an operation in progress.');
    const input = req.body.input === undefined ? {} : req.body.input;
    if (typeof req.body.operation !== 'string' || !isPlainObject(input)) {
      return sendError(res, 400, 'A valid readiness operation and input are required.');
    }
    context.busy = true;
    const requestController = makeRequestAbortSignal(req, res);
    context.operationControllers.add(requestController);
    try {
      context.operationPromise = executeOperation(context, req.body.operation, input, requestController.signal);
      const result = await context.operationPromise;
      return res.json({ result });
    } catch (error) {
      if (error?.code === 'invalid-operation') return sendError(res, 400, 'Requested readiness operation is not supported by this provider lane.');
      if (error?.code === 'unsupported-operation') return sendError(res, 501, 'Worker adapter does not implement this readiness operation.');
      if (error?.code === 'timeout') {
        try {
          await disposeContext(context);
        } catch {
          return sendError(res, 503, 'Readiness worker timed out and could not confirm session cleanup.');
        }
        return sendError(res, 504, 'Readiness worker operation timed out; its session was closed.');
      }
      if (error?.code === 'invalid-input') return sendError(res, 400, 'Readiness operation input does not match the checked-in lane contract.');
      if (error?.code === 'context-closed') return sendError(res, 409, 'Readiness worker context is closing.');
      if (error?.code === 'aborted' || requestController.signal.aborted) {
        void disposeContext(context).catch(() => {});
        return undefined;
      }
      if (error?.code === 'result-too-large') return sendError(res, 502, 'Readiness worker operation returned an oversized result.');
      return sendError(res, 502, 'Readiness worker operation failed.');
    } finally {
      context.operationControllers.delete(requestController);
      context.operationPromise = null;
      context.busy = false;
    }
  });

  app.delete('/api/demo-readiness/v1/contexts/:contextId', async (req, res) => {
    const context = contexts.get(req.params.contextId);
    if (!context) {
      const closing = closingByContextId.get(req.params.contextId);
      if (!closing) return res.status(204).end();
      try {
        await closing;
        return res.status(204).end();
      } catch {
        return sendError(res, 503, 'Readiness worker context cleanup failed.');
      }
    }
    try {
      await disposeContext(context);
      return res.status(204).end();
    } catch {
      return sendError(res, 503, 'Readiness worker context cleanup failed.');
    }
  });

  app.use((error, _req, res, next) => {
    if (res.headersSent) return next(error);
    if (error?.type === 'entity.too.large') return sendError(res, 413, 'Readiness worker request exceeded the allowed size.');
    if (error instanceof SyntaxError && Object.hasOwn(error, 'body')) return sendError(res, 400, 'Readiness worker request must contain valid JSON.');
    return sendError(res, 500, 'Readiness worker request failed.');
  });

  app.use((_req, res) => sendError(res, 404, 'Readiness worker endpoint was not found.'));

  const sweeper = setInterval(() => { void sweepExpired(); }, sweepIntervalMs);
  sweeper.unref?.();

  return {
    app,
    workerId,
    sweepExpired,
    async close() {
      if (closed) return;
      closed = true;
      clearInterval(sweeper);
      for (const entry of pendingByRunId.values()) entry.controller.abort(abortError());
      const pending = [...pendingByRunId.values()].map((entry) => entry.promise);
      for (const promise of pending) await promise.catch(() => {});
      await Promise.allSettled([...contexts.values()].map((context) => disposeContext(context)));
      await Promise.allSettled([...closingByContextId.values()]);
    },
  };
}

module.exports = {
  CAPABILITIES,
  createReadinessWorkerHttpService,
};
