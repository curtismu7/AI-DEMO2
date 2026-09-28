'use strict';

const crypto = require('crypto');
const repairability = require('../config/demoReadinessRepairability.json');
const { redactReadinessValue } = require('./demoReadinessReport');

const DEFAULT_PLAN_TTL_MS = 15 * 60 * 1000;

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function sameValue(left, right) {
  return stableJson(left) === stableJson(right);
}

function targetId(target) {
  if (typeof target === 'string') return target;
  return target?.id || target?.targetId || null;
}

function canonicalTargets(targets) {
  if (!Array.isArray(targets)) return [];
  return targets.map((target) => ({ id: targetId(target), kind: typeof target === 'string' ? undefined : target?.kind })).sort((left, right) => String(left.id).localeCompare(String(right.id)));
}

function digestFor(payload) {
  return crypto.createHash('sha256').update(stableJson(payload)).digest('hex');
}

function repairCandidates(finding) {
  if (Array.isArray(finding?.repairCandidates)) return finding.repairCandidates;
  return finding?.repairCandidate ? [finding.repairCandidate] : [];
}

function candidateForPreview(candidate, finding) {
  return {
    repairClass: candidate.repairClass || candidate.class,
    target: candidate.target || finding.target,
    object: candidate.object,
    current: candidate.current,
    expected: candidate.expected,
    sourceRef: candidate.sourceRef || finding.sourceRef,
    operation: candidate.operation,
    worker: candidate.worker,
  };
}

function invalidCandidate(change, selectedTargetIds) {
  if (!change.repairClass) return 'candidate does not name a repair class';
  if (!change.target || !selectedTargetIds.has(change.target)) return 'candidate target is not in the selected target set';
  if (!change.object || typeof change.object.id !== 'string' || !change.object.id || change.object.ambiguous) return 'candidate object ID is ambiguous or missing';
  if (typeof change.current === 'undefined' || typeof change.expected === 'undefined') return 'candidate lacks an exact current or expected value';
  return null;
}

function blockedChange(change, classification, reason) {
  return redactReadinessValue({
    ...change,
    repairMode: classification?.repairMode || 'manual',
    operatorAction: classification?.operation || 'Do not apply automatically; identify a declared repair class and follow its operator procedure.',
    ...(reason ? { reason } : {}),
  });
}

function sourceContractFor(change, classification, sourceReaders) {
  const reader = sourceReaders[classification.contractReader];
  if (typeof reader !== 'function') return { error: 'declared source contract reader is unavailable' };
  const contract = reader({ target: change.target, objectId: change.object?.id, repairClass: change.repairClass });
  if (!contract || typeof contract.then === 'function') return { error: 'declared source contract reader did not return a synchronous contract' };
  if (!contract.object || typeof contract.object.id !== 'string' || typeof contract.expected === 'undefined' || !contract.sourceRef || !contract.operation) {
    return { error: 'declared source contract is incomplete' };
  }
  if (contract.target !== change.target || contract.object.id !== change.object.id
      || (change.object.kind && contract.object.kind !== change.object.kind)
      || (change.sourceRef && change.sourceRef !== contract.sourceRef)
      || (typeof change.expected !== 'undefined' && !sameValue(change.expected, contract.expected))
      || (change.operation && change.operation !== contract.operation)) {
    return { error: 'candidate does not match the declared source contract' };
  }
  return { change: {
    repairClass: change.repairClass, target: contract.target, object: contract.object,
    current: change.current, expected: contract.expected, sourceRef: contract.sourceRef,
    operation: contract.operation,
  } };
}

function repairEvidenceFor(items) {
  return redactReadinessValue(items.map((item) => ({
    target: item.change.target,
    object: item.change.object,
    before: typeof item.current === 'undefined' ? item.change.current : item.current,
    after: item.after,
    restored: item.restored,
    sourceRef: item.change.sourceRef,
    operation: item.change.operation,
    outcome: item.outcome || 'not-attempted',
  })));
}

function createRepairService({ adapters = {}, sourceReaders = {}, verifyAdminConfirmation, repairabilityConfig = repairability, now: clock = Date.now, planTtlMs = DEFAULT_PLAN_TTL_MS } = {}) {
  const plans = new Map();
  const driftClasses = repairabilityConfig.driftClasses || {};

  function planRepairs({ findings = [], targets = [], now = clock() } = {}) {
    const targetSet = canonicalTargets(targets);
    const selectedTargetIds = new Set(targetSet.map((target) => target.id).filter(Boolean));
    const changes = [];
    const blocked = [];

    for (const finding of findings) {
      for (const candidate of repairCandidates(finding)) {
        const change = candidateForPreview(candidate, finding);
        const invalid = invalidCandidate(change, selectedTargetIds);
        const classification = driftClasses[change.repairClass];
        if (invalid) {
          blocked.push(blockedChange(change, classification, invalid));
          continue;
        }
        if (!classification) {
          blocked.push(blockedChange(change, classification, 'repair class is not declared'));
          continue;
        }
        if (classification.repairMode !== 'automatic') {
          blocked.push(blockedChange(change, classification));
          continue;
        }
        const source = sourceContractFor(change, classification, sourceReaders);
        if (source.error) {
          blocked.push(blockedChange(change, classification, source.error));
          continue;
        }
        const bound = source.change;
        const adapter = adapters[change.repairClass];
        if (!adapter || typeof adapter.read !== 'function' || typeof adapter.write !== 'function' || typeof adapter.readback !== 'function') {
          blocked.push(blockedChange(bound, classification, 'supported mutation and readback adapter is unavailable'));
          continue;
        }
        if (classification.requiresIsolatedWorker && (typeof adapter.createIsolatedWorker !== 'function' || typeof adapter.restore !== 'function')) {
          blocked.push(blockedChange(bound, classification, 'trusted isolated worker and restore adapters are unavailable'));
          continue;
        }
        changes.push(redactReadinessValue({ ...bound, repairMode: 'automatic' }));
      }
    }

    const planPayload = { targets: targetSet, changes, blocked };
    const digest = digestFor(planPayload);
    const plan = {
      planId: crypto.randomUUID(), digest, expiresAt: now + planTtlMs,
      targets: targetSet, changes, blocked, confirmed: false,
    };
    plans.set(digest, plan);
    return redactReadinessValue({ planId: plan.planId, digest, expiresAt: plan.expiresAt, changes, blocked });
  }

  function assertActive({ signal, deadlineAt } = {}) {
    if (signal?.aborted) throw new Error('repair cancelled by abort signal');
    if (deadlineAt && clock() >= deadlineAt) throw new Error('repair deadline expired');
  }

  async function callAdapter(adapter, method, args, control, { allowCompletionAfterCancellation = false } = {}) {
    assertActive(control);
    const result = await adapter[method]({ ...args, signal: control?.signal, deadlineAt: control?.deadlineAt });
    if (!allowCompletionAfterCancellation) assertActive(control);
    return result;
  }

  async function applyRepairs({ digest, confirmedBy, targets = [], now = clock(), deadlineAt, signal } = {}) {
    const control = { deadlineAt, signal };
    assertActive(control);
    const plan = plans.get(digest);
    if (!plan || plan.digest !== digest) throw new Error('repair plan digest does not match a displayed preview');
    if (typeof verifyAdminConfirmation !== 'function') throw new Error('a verified administrator confirmation verifier is required');
    const administrator = await verifyAdminConfirmation(confirmedBy, { signal, deadlineAt });
    assertActive(control);
    if (!administrator || typeof administrator.subject !== 'string' || !administrator.subject) throw new Error('a verified administrator assertion is required');
    if (plan.confirmed) throw new Error('repair plan is already confirmed');
    if (now >= plan.expiresAt) throw new Error('repair plan has expired');
    if (!sameValue(canonicalTargets(targets), plan.targets)) throw new Error('repair plan target set changed after preview');

    const prewrites = [];
    let applyError;
    try {
      for (const change of plan.changes) {
        assertActive(control);
        const adapter = adapters[change.repairClass];
        const needsWorker = driftClasses[change.repairClass]?.requiresIsolatedWorker;
        const workerContext = needsWorker ? await callAdapter(adapter, 'createIsolatedWorker', { target: change.target, object: change.object, sourceRef: change.sourceRef }, control, { allowCompletionAfterCancellation: true }) : undefined;
        if (needsWorker && (!workerContext || typeof workerContext !== 'object')) throw new Error('trusted isolated worker adapter did not provide a worker context');
        const item = { change, adapter, workerContext, needsWorker };
        if (needsWorker) prewrites.push(item);
        const current = await callAdapter(adapter, 'read', { target: change.target, object: change.object, sourceRef: change.sourceRef, workerContext }, control);
        item.current = current;
        item.outcome = sameValue(current, change.expected) ? 'already-applied' : 'pending';
        if (!needsWorker) prewrites.push(item);
        if (item.outcome === 'pending' && !sameValue(current, change.current)) throw new Error('repair current value changed after preview');
      }

      for (const item of prewrites) {
        const { change, adapter, current, workerContext } = item;
        if (item.outcome === 'already-applied') { item.after = current; continue; }
        assertActive(control);
        let writeError;
        try {
          await adapter.write({ ...change, current, workerContext, digest: plan.digest, idempotencyKey: plan.digest, confirmedBy: administrator.subject, signal, deadlineAt });
        } catch (error) {
          writeError = error;
        }

        // Once a write has started, always read it back after the call settles,
        // even if the run deadline has fired. This read is the evidence needed
        // to determine whether the provider accepted the write before abort.
        let after;
        let readbackError;
        try {
          after = await adapter.readback({ target: change.target, object: change.object, sourceRef: change.sourceRef, workerContext });
        } catch (error) {
          readbackError = error;
        }
        if (readbackError || !sameValue(after, change.expected)) {
          const verificationError = readbackError || new Error('repair readback does not match the expected value');
          if (writeError) throw new AggregateError([writeError, verificationError], writeError.message || 'repair write and readback failed', { cause: writeError });
          throw verificationError;
        }
        item.after = after;
        item.outcome = 'applied';
        if (writeError) throw writeError;
        assertActive(control);
      }
    } catch (error) {
      applyError = error;
    }

    const cleanupFailures = [];
    for (const item of prewrites.filter((entry) => entry.needsWorker).reverse()) {
      const original = item.change.current;
      try {
        // Restoration is compensating safety work. It must still run after the
        // readiness deadline aborts the in-flight apply, so it deliberately
        // receives no already-aborted run signal or expired deadline.
        await item.adapter.restore({ target: item.change.target, object: item.change.object, expected: original, workerContext: item.workerContext, digest: plan.digest });
      } catch (error) {
        cleanupFailures.push(error);
      }
      try {
        const restored = await item.adapter.read({ target: item.change.target, object: item.change.object, sourceRef: item.change.sourceRef, workerContext: item.workerContext });
        if (!sameValue(restored, original)) throw new Error('isolated feature-flag restore readback does not match the original value');
        item.restored = restored;
      } catch (error) {
        cleanupFailures.push(error);
      }
    }
    if (applyError) {
      let failure = applyError instanceof Error ? applyError : new Error('repair apply failed');
      if (cleanupFailures.length) {
        failure = new AggregateError([applyError, ...cleanupFailures], 'repair apply and isolated worker cleanup failed', { cause: applyError });
        failure.applyError = applyError;
      }
      failure.repairEvidence = repairEvidenceFor(prewrites);
      throw failure;
    }
    if (cleanupFailures.length) {
      const failure = new AggregateError(cleanupFailures, 'isolated worker cleanup failed');
      failure.repairEvidence = repairEvidenceFor(prewrites);
      throw failure;
    }
    const evidence = repairEvidenceFor(prewrites);
    plan.confirmed = true;
    return redactReadinessValue({ planId: plan.planId, digest: plan.digest, confirmedBy: administrator.subject, evidence, blocked: plan.blocked });
  }

  return { planRepairs, applyRepairs };
}

module.exports = { DEFAULT_PLAN_TTL_MS, createRepairService, stableJson };
