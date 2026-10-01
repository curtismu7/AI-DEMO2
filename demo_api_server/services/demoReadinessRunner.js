'use strict';

const crypto = require('crypto');
const { createAuditService } = require('./demoReadinessAuditService');
const { createPingOneReader } = require('./demoReadinessPingOneReader');
const { createRepairService } = require('./demoReadinessRepairService');
const { createReadinessExecutionService } = require('./demoReadinessExecutionService');
const { createReadinessWorkerFactory } = require('./demoReadinessWorkerClient');
const { loadDemoReadinessRuntimeConfig } = require('./demoReadinessRuntimeConfig');
const { HARD_DEADLINE_MS, redactReadinessValue } = require('./demoReadinessReport');

const DEFAULT_TARGETS = Object.freeze(['local', 'se']);
const TERMINAL_BAD = new Set(['fail', 'blocked', 'unknown', 'not-run', 'queued', 'active']);

function nowFrom(clock) {
  if (typeof clock === 'function') return clock();
  if (clock && typeof clock.now === 'function') return clock.now();
  return Date.now();
}

function normalizeRows(rows, phase) {
  if (!Array.isArray(rows)) return [{ id: phase + ':unknown', status: 'blocked', required: true, evidence: 'adapter returned no check rows' }];
  return rows.map((row, index) => ({
    ...row,
    id: row?.id || phase + ':' + index,
    status: ['pass', 'fail', 'blocked', 'not-run'].includes(row?.status) ? row.status : 'unknown',
    required: row?.required !== false,
    phase,
  }));
}

function rowsPassed(rows) {
  return rows.every((row) => !row.required || row.status === 'pass');
}

function auditHasBlocker(rows) {
  return rows.some((row) => row.required && (row.status === 'blocked' || row.status === 'not-run' || row.status === 'unknown'));
}

function unresolvedAuditFailure(rows) {
  return rows.some((row) => row.required && row.status === 'fail' && !row.repairCandidate && !row.repairCandidates?.length);
}

function checkInventoryError(items) {
  if (!Array.isArray(items) || items.length === 0) return 'adapter returned an empty check inventory';
  if (!items.some((item) => item?.required !== false)) return 'adapter returned no required checks';
  return null;
}

function matrixCoverageError(result) {
  const rows = result?.rows;
  if (!Array.isArray(rows) || rows.length === 0) return 'scenario adapter returned no required rows';
  const ids = rows.map((row) => row?.id);
  if (ids.some((id) => typeof id !== 'string' || !id.trim())) return 'scenario adapter returned a row without an ID';
  if (new Set(ids).size !== ids.length) return 'scenario adapter returned duplicate row IDs';
  const expectedIds = result.expectedRowIds || result.manifestRowIds;
  if (!Array.isArray(expectedIds) || !expectedIds.length || expectedIds.some((id) => typeof id !== 'string' || !id.trim()) || new Set(expectedIds).size !== expectedIds.length) {
    return 'scenario manifest did not provide a valid nonempty expected row inventory';
  }
  if (expectedIds.length !== ids.length || expectedIds.some((id) => !ids.includes(id))) return 'scenario result IDs do not match the expected manifest';
  return null;
}

function createDefaultAdapters(clock = Date.now, {
  fetchImpl = globalThis.fetch,
  audit = createAuditService({ adapters: { pingOne: { readConfiguration: createPingOneReader({ fetchImpl }) } } }),
  repairs = createRepairService({ now: () => nowFrom(clock) }),
  execution,
  runtimeConfig = loadDemoReadinessRuntimeConfig(),
  workerRuntime,
} = {}) {
  const workers = workerRuntime || createReadinessWorkerFactory({ config: runtimeConfig, fetchImpl });
  const readinessExecution = execution || createReadinessExecutionService({ productionWorkerAdapter: workers.createWorker });
  return {
    checkPrerequisites: async ({ targets = DEFAULT_TARGETS, deadlineAt, signal } = {}) => {
      const selectedTargets = new Set(targets);
      const configFindings = runtimeConfig.findings.filter((finding) => selectedTargets.has(finding.id.split(':')[1]));
      const workerFindings = await workers.checkWorkers({ targets, deadlineAt, signal });
      return [...configFindings, ...workerFindings];
    },
    audit: async ({ targets, deadlineAt, phase, signal }) => {
      const rows = [];
      for (const targetId of targets) {
        if (nowFrom(clock) >= deadlineAt || signal?.aborted) break;
        const target = runtimeConfig.targets[targetId];
        const runtime = target ? {
          bffUrl: target.bffUrl,
          gatewayUrl: target.gatewayUrl,
          authorizeUrl: target.authorizeUrl,
          expectedRevision: target.expectedRevision,
        } : {};
        rows.push(...await audit.auditTarget({
          targetId,
          targetConfig: { kind: targetId === 'se' ? 'se' : 'local', runtime },
          deadlineAt,
          signal,
        }));
      }
      return rows.map((row) => ({ ...row, phase }));
    },
    planRepairs: (args) => repairs.planRepairs(args),
    applyRepairs: (args) => repairs.applyRepairs(args),
    execute: async ({ targets, deadlineAt, startedAt, onProgress, signal }) => {
      let result;
      let runError;
      let cleanup;
      try {
        result = await readinessExecution.runManifest({
          targets: targets.map((target) => target === 'se' ? 'hosted' : target),
          deadlineAt,
          startedAt,
          commit: process.env.GIT_COMMIT || process.env.COMMIT_SHA,
          onProgress,
          signal,
        });
      } catch {
        runError = new Error('Readiness scenario execution failed.');
      } finally {
        try {
          cleanup = await readinessExecution.dispose();
        } catch {
          cleanup = { status: 'fail', failures: [] };
        }
      }
      if (runError) {
        if (cleanup.status === 'fail') throw new Error('Readiness scenario execution and provider context cleanup failed.');
        throw runError;
      }
      const manifestRows = [...result.manifest.core, ...result.manifest.variants, ...result.manifest.feature, ...result.manifest.attackLab];
      const rowIds = manifestRows.map((row, index) => [row.kind, row.caseRow?.id || row.check?.id, row.targetId, row.provider, row.behavior?.variant || row.vertical || index].filter(Boolean).join(':'));
      const cleanupFailures = Array.isArray(cleanup?.failures) ? cleanup.failures : [];
      const validCleanupFailures = cleanupFailures.filter((failure) => failure?.targetId && ['pingone', 'pingfederate'].includes(failure.provider));
      const allManifestLanes = new Set(manifestRows.map((row) => `${row.targetId}:${row.provider}`));
      const cleanupFailed = cleanup?.status === 'fail' || cleanupFailures.length > 0;
      const unmappedCleanupFailure = validCleanupFailures.length !== cleanupFailures.length
        || validCleanupFailures.some((failure) => !allManifestLanes.has(`${failure.targetId}:${failure.provider}`));
      const unknownCleanupFailure = cleanupFailed && (validCleanupFailures.length === 0 || unmappedCleanupFailure);
      const failedLanes = new Set(unknownCleanupFailure
        ? allManifestLanes
        : validCleanupFailures.map((failure) => `${failure.targetId}:${failure.provider}`));
      const failedRowIds = new Set(manifestRows.flatMap((row, index) => failedLanes.has(`${row.targetId}:${row.provider}`) ? [rowIds[index]] : []));
      const rows = result.results.map((item, index) => {
        const row = manifestRows[index] || {};
        const mapped = {
          ...item,
          id: rowIds[index],
          target: row.targetId,
          userSessionProvider: item.evidence?.userSessionProvider || row.provider,
          useCaseId: row.caseRow?.id || row.check?.id,
          sourceRef: row.caseRow?.sourceRef || row.check?.sourceRef,
        };
        return failedRowIds.has(mapped.id) ? {
          ...mapped,
          status: 'blocked',
          observed: 'context-cleanup-failed',
          evidence: { ...(mapped.evidence || {}), reason: 'provider worker context cleanup failed' },
        } : mapped;
      });
      const executionReport = { ...result.report };
      if (failedRowIds.size) {
        executionReport.ready = false;
        executionReport.status = 'not-ready';
        if (Array.isArray(executionReport.checks)) {
          executionReport.checks = executionReport.checks.map((check) => failedRowIds.has(check.id) ? {
            ...check,
            status: 'blocked',
            observed: 'context-cleanup-failed',
            evidence: { ...(check.evidence || {}), reason: 'provider worker context cleanup failed' },
          } : check);
        }
      }
      return {
        rows,
        expectedRowIds: rowIds,
        categoryCounts: result.categoryCounts,
        timing: result.timing,
        executionReport,
        workerCleanup: { status: cleanupFailed ? 'fail' : 'pass', failures: cleanupFailures },
      };
    },
  };
}

function coerceAdapters(adapters = {}, clock) {
  return { ...createDefaultAdapters(clock), ...adapters };
}

function confirmationDigest(answer, digest) {
  if (answer === digest) return true;
  return Boolean(answer && typeof answer === 'object' && answer.confirmed === true && answer.digest === digest);
}

/** Coordinate the readiness phases under one wall-clock deadline. */
async function startReadinessRun({
  targets = DEFAULT_TARGETS,
  confirmRepairs,
  onProgress = () => {},
  clock = Date.now,
  adapters: suppliedAdapters = {},
  deadlineMs = HARD_DEADLINE_MS,
} = {}) {
  const selectedTargets = [...new Set(targets || [])];
  const startedAt = nowFrom(clock);
  const deadlineAt = startedAt + Math.min(HARD_DEADLINE_MS, Math.max(1, deadlineMs));
  const runId = crypto.randomUUID();
  const commit = process.env.GIT_COMMIT || process.env.COMMIT_SHA || undefined;
  const adapters = coerceAdapters(suppliedAdapters, clock);
  const checks = [];
  const rows = [];
  const phases = [];
  let repairPreview = null;
  let repairEvidence = null;
  let matrixCompleted = false;
  let matrixAttempted = false;
  let matrixDetails = null;

  let deadlineElapsed = false;
  const expired = () => deadlineElapsed || nowFrom(clock) >= deadlineAt;
  const progress = async (phase, details = {}) => {
    phases.push({ phase, at: nowFrom(clock) });
    await onProgress(redactReadinessValue({ phase, deadlineAt, ...details }));
  };
  const waitUntilDeadline = (callback, onTimeout = () => {}) => {
    if (expired()) return Promise.resolve({ timedOut: true });
    let timer;
    return new Promise((resolve) => {
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolve(result);
      };
      const remaining = Math.max(1, deadlineAt - nowFrom(clock));
      timer = setTimeout(() => {
        deadlineElapsed = true;
        onTimeout();
        finish({ timedOut: true });
      }, remaining);
      Promise.resolve().then(callback).then(
        (value) => finish({ value }),
        (error) => finish({ error }),
      );
    });
  };
  const addRows = (items, phase) => {
    const normalized = normalizeRows(items, phase);
    checks.push(...normalized);
    return normalized;
  };
  const finishDeadline = () => {
    const notRun = [{ id: 'run:deadline', status: 'not-run', required: true, phase: 'deadline', evidence: '15-minute readiness deadline exceeded' }];
    checks.push(...notRun);
    rows.push(...notRun);
    return makeResult();
  };
  const makeResult = () => {
    const allRows = [...checks, ...rows];
    const bad = allRows.some((row) => row.required && TERMINAL_BAD.has(row.status));
    const deadlineExceeded = expired();
    const complete = matrixCompleted && !bad && !deadlineExceeded && selectedTargets.length === 2 && DEFAULT_TARGETS.every((target) => selectedTargets.includes(target));
    return redactReadinessValue({
      status: deadlineExceeded ? 'deadline-exceeded' : complete ? 'ready' : 'not-ready',
      ready: complete,
      label: complete ? 'READY — BOTH TARGETS' : selectedTargets.length === 1 && !bad ? 'DIAGNOSTIC — ' + selectedTargets[0].toUpperCase() + ' ONLY' : 'NOT READY',
      targets: selectedTargets,
      startedAt,
      deadlineAt,
      elapsedMs: Math.max(0, nowFrom(clock) - startedAt),
      phases,
      checks,
      rows,
      repairPreview,
      repairEvidence,
      report: {
        runId,
        commit,
        targets: selectedTargets,
        providerMatrix: selectedTargets.flatMap((target) => ['pingone', 'pingfederate'].map((provider) => ({ target, provider }))),
        matrixAttempted,
        matrixDetails,
        status: deadlineExceeded ? 'deadline_exceeded' : complete ? 'ready' : 'not-ready',
        ready: complete,
        startedAt,
        deadlineAt,
        elapsedMs: Math.max(0, nowFrom(clock) - startedAt),
        phases,
        checks,
        rows,
        repairPreview,
        repairEvidence,
      },
    });
  };
  const runAdapter = async (phase, work, { drainOnTimeout = false, drainTimeoutMs } = {}) => {
    if (expired()) return { timedOut: true };
    const progressResult = await waitUntilDeadline(() => progress(phase));
    if (progressResult.timedOut || expired()) return { timedOut: true };
    if (progressResult.error) return { adapterError: redactReadinessValue(progressResult.error?.message || 'progress callback failed') };
    const controller = new AbortController();
    const operation = Promise.resolve().then(() => work({ signal: controller.signal, deadlineAt }));
    try {
      const operationResult = await waitUntilDeadline(() => operation, () => controller.abort());
      if (operationResult.timedOut && drainOnTimeout) {
        let drainTimer;
        try {
          const drained = await (Number.isFinite(drainTimeoutMs)
            ? Promise.race([
              operation.then((value) => ({ value }), (error) => ({ error })),
              new Promise((resolve) => { drainTimer = setTimeout(() => resolve({ drainTimedOut: true }), drainTimeoutMs); }),
            ])
            : operation.then((value) => ({ value }), (error) => ({ error })));
          if (drainTimer) clearTimeout(drainTimer);
          if (drained.drainTimedOut) return { timedOut: true, adapterError: 'scenario execution or worker cleanup did not settle within the bounded drain' };
          if (drained.error) throw drained.error;
          return { timedOut: true, completedResult: redactReadinessValue(drained.value) };
        } catch (error) {
          return {
            timedOut: true,
            adapterError: redactReadinessValue(error?.message || 'adapter failed'),
            ...(Array.isArray(error?.repairEvidence) ? { repairEvidence: redactReadinessValue(error.repairEvidence) } : {}),
          };
        } finally {
          if (drainTimer) clearTimeout(drainTimer);
        }
      }
      if (operationResult.error) return {
        adapterError: redactReadinessValue(operationResult.error?.message || 'adapter failed'),
        ...(Array.isArray(operationResult.error?.repairEvidence) ? { repairEvidence: redactReadinessValue(operationResult.error.repairEvidence) } : {}),
      };
      if (expired()) controller.abort();
      return operationResult.value;
    } catch (error) {
      return {
        adapterError: redactReadinessValue(error?.message || 'adapter failed'),
        ...(Array.isArray(error?.repairEvidence) ? { repairEvidence: redactReadinessValue(error.repairEvidence) } : {}),
      };
    }
  };

  if (!selectedTargets.length || selectedTargets.some((target) => !DEFAULT_TARGETS.includes(target))) {
    checks.push({ id: 'run:targets', status: 'blocked', required: true, phase: 'validation', evidence: 'targets must include local, se, or both' });
    return makeResult();
  }
  if (expired()) return finishDeadline();

  const prerequisiteResult = await runAdapter('prerequisites', ({ signal }) => adapters.checkPrerequisites({ targets: selectedTargets, startedAt, deadlineAt, signal }));
  if (prerequisiteResult?.timedOut || expired()) return finishDeadline();
  if (prerequisiteResult?.adapterError) {
    checks.push({ id: 'prerequisites:adapter', status: 'blocked', required: true, phase: 'prerequisites', evidence: prerequisiteResult.adapterError });
    return makeResult();
  }
  const prerequisiteInventoryError = checkInventoryError(prerequisiteResult);
  if (prerequisiteInventoryError) {
    checks.push({ id: 'prerequisites:inventory', status: 'blocked', required: true, phase: 'prerequisites', evidence: prerequisiteInventoryError });
    return makeResult();
  }
  const prerequisiteRows = addRows(prerequisiteResult, 'prerequisites');
  if (!rowsPassed(prerequisiteRows)) return makeResult();

  const initialResult = await runAdapter('audit', ({ signal }) => adapters.audit({ targets: selectedTargets, deadlineAt, phase: 'initial', signal }));
  if (initialResult?.timedOut || expired()) return finishDeadline();
  if (initialResult?.adapterError) {
    checks.push({ id: 'audit:adapter', status: 'blocked', required: true, phase: 'audit-initial', evidence: initialResult.adapterError });
    return makeResult();
  }
  const initialInventoryError = checkInventoryError(initialResult);
  if (initialInventoryError) {
    checks.push({ id: 'audit:initial-inventory', status: 'blocked', required: true, phase: 'audit-initial', evidence: initialInventoryError });
    return makeResult();
  }
  const initialRows = addRows(initialResult, 'audit-initial');
  if (auditHasBlocker(initialRows) || unresolvedAuditFailure(initialRows)) return makeResult();

  const previewResult = await runAdapter('repair-preview', ({ signal }) => adapters.planRepairs({ findings: initialRows, targets: selectedTargets, now: nowFrom(clock), signal }));
  if (previewResult?.timedOut || expired()) return finishDeadline();
  if (previewResult?.adapterError) {
    checks.push({ id: 'repair:preview', status: 'blocked', required: true, phase: 'repair-preview', evidence: previewResult.adapterError });
    return makeResult();
  }
  repairPreview = redactReadinessValue(previewResult || { changes: [], blocked: [], digest: null });
  const previewProgress = await waitUntilDeadline(() => onProgress(redactReadinessValue({
    phase: 'repair-preview-ready',
    preview: repairPreview,
    checks: [...checks],
    rows: [...rows],
    deadlineAt,
  })));
  if (previewProgress.timedOut || expired()) return finishDeadline();
  if (previewProgress.error) {
    checks.push({ id: 'repair:preview-progress', status: 'blocked', required: true, phase: 'repair-preview', evidence: redactReadinessValue(previewProgress.error?.message || 'progress callback failed') });
    return makeResult();
  }
  if ((repairPreview.blocked || []).length) return makeResult();

  if ((repairPreview.changes || []).length) {
    if (typeof repairPreview.digest !== 'string' || !repairPreview.digest) {
      checks.push({ id: 'repair:preview-digest', status: 'blocked', required: true, phase: 'repair-preview', evidence: 'repair preview did not contain an exact plan digest' });
      return makeResult();
    }
    if (typeof confirmRepairs !== 'function') {
      checks.push({ id: 'repair:confirmation', status: 'blocked', required: true, phase: 'repair-confirmation', evidence: 'exact digest confirmation callback is unavailable' });
      return makeResult();
    }
    const answer = await runAdapter('repair-confirmation', ({ signal }) => confirmRepairs({
      digest: repairPreview.digest,
      preview: repairPreview,
      targets: selectedTargets,
      deadlineAt,
      signal,
    }));
    if (answer?.timedOut || expired()) return finishDeadline();
    if (answer?.adapterError) {
      checks.push({ id: 'repair:confirmation', status: 'blocked', required: true, phase: 'repair-confirmation', evidence: answer.adapterError });
      return makeResult();
    }
    if (!confirmationDigest(answer, repairPreview.digest)) {
      checks.push({ id: 'repair:confirmation', status: 'blocked', required: true, phase: 'repair-confirmation', evidence: 'repair preview was declined or confirmation did not match the displayed digest' });
      return makeResult();
    }
    const confirmedBy = answer && typeof answer === 'object' ? answer.adminAssertion : undefined;
    if (!confirmedBy) {
      checks.push({ id: 'repair:administrator-assertion', status: 'blocked', required: true, phase: 'repair-confirmation', evidence: 'exact plan digest was confirmed but no verified administrator assertion was supplied' });
      return makeResult();
    }
    const applyResult = await runAdapter('repair-apply', ({ signal }) => adapters.applyRepairs({ digest: repairPreview.digest, confirmedBy, targets: selectedTargets, deadlineAt, signal, now: nowFrom(clock) }), { drainOnTimeout: true });
    if (applyResult?.timedOut || expired()) {
      if (applyResult?.completedResult) repairEvidence = redactReadinessValue(applyResult.completedResult);
      else if (Array.isArray(applyResult?.evidence)) repairEvidence = redactReadinessValue(applyResult);
      else if (Array.isArray(applyResult?.repairEvidence)) repairEvidence = redactReadinessValue({ digest: repairPreview.digest, evidence: applyResult.repairEvidence });
      return finishDeadline();
    }
    if (applyResult?.adapterError) {
      if (Array.isArray(applyResult.repairEvidence)) repairEvidence = redactReadinessValue({ digest: repairPreview.digest, evidence: applyResult.repairEvidence });
      checks.push({ id: 'repair:apply', status: 'blocked', required: true, phase: 'repair-apply', evidence: applyResult.adapterError });
      return makeResult();
    }
    if (applyResult?.digest !== repairPreview.digest) {
      checks.push({ id: 'repair:apply-digest', status: 'blocked', required: true, phase: 'repair-apply', evidence: 'repair service did not confirm the displayed plan digest' });
      return makeResult();
    }
    repairEvidence = redactReadinessValue(applyResult);
  }

  const reAuditResult = await runAdapter('re-audit', ({ signal }) => adapters.audit({ targets: selectedTargets, deadlineAt, phase: 'after-repair', signal }));
  if (reAuditResult?.timedOut || expired()) return finishDeadline();
  if (reAuditResult?.adapterError) {
    checks.push({ id: 'audit:recheck', status: 'blocked', required: true, phase: 'audit-after-repair', evidence: reAuditResult.adapterError });
    return makeResult();
  }
  const reAuditInventoryError = checkInventoryError(reAuditResult);
  if (reAuditInventoryError) {
    checks.push({ id: 'audit:after-repair-inventory', status: 'blocked', required: true, phase: 'audit-after-repair', evidence: reAuditInventoryError });
    return makeResult();
  }
  const reAuditRows = addRows(reAuditResult, 'audit-after-repair');
  if (!rowsPassed(reAuditRows)) return makeResult();

  for (const row of initialRows) {
    if (row.status === 'fail' && (row.repairCandidate || row.repairCandidates?.length)) {
      row.required = false;
      row.resolvedByRepair = true;
    }
  }

  matrixAttempted = true;
  const executionResult = await runAdapter('scenario-matrix', ({ signal }) => adapters.execute({ targets: selectedTargets, deadlineAt, startedAt, onProgress, signal }), { drainOnTimeout: true, drainTimeoutMs: 10_500 });
  if (executionResult?.timedOut || expired()) {
    const completed = executionResult?.completedResult;
    if (completed && Array.isArray(completed.rows)) {
      const completedRows = normalizeRows(completed.rows, 'scenario-matrix');
      matrixDetails = {
        categoryCounts: completed.categoryCounts,
        timing: completed.timing,
        report: completed.executionReport,
      };
      rows.push(...completedRows);
      const coverageError = matrixCoverageError(completed);
      if (coverageError) rows.push({ id: 'scenario-matrix:coverage', status: 'blocked', required: true, phase: 'scenario-matrix', evidence: coverageError });
    } else if (executionResult?.adapterError) {
      rows.push({ id: 'scenario-matrix:adapter', status: 'blocked', required: true, phase: 'scenario-matrix', evidence: executionResult.adapterError });
    }
    return finishDeadline();
  }
  if (executionResult?.adapterError) {
    rows.push({ id: 'scenario-matrix:adapter', status: 'blocked', required: true, phase: 'scenario-matrix', evidence: executionResult.adapterError });
    return makeResult();
  }
  const executionRows = normalizeRows(executionResult?.rows, 'scenario-matrix');
  matrixDetails = {
    categoryCounts: executionResult.categoryCounts,
    timing: executionResult.timing,
    report: executionResult.executionReport,
  };
  rows.push(...executionRows);
  const coverageError = matrixCoverageError(executionResult);
  if (coverageError) rows.push({ id: 'scenario-matrix:coverage', status: 'blocked', required: true, phase: 'scenario-matrix', evidence: coverageError });
  matrixCompleted = !coverageError && rowsPassed(executionRows);
  return makeResult();
}

module.exports = { DEFAULT_TARGETS, createDefaultAdapters, startReadinessRun };
