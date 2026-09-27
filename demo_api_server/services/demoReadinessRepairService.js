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
  if (!change.sourceRef || !change.operation) return 'candidate lacks an exact source reference or operation';
  if (typeof change.current === 'undefined' || typeof change.expected === 'undefined') return 'candidate lacks an exact current or expected value';
  return null;
}

function createRepairService({ adapters = {}, repairabilityConfig = repairability, now: clock = Date.now, planTtlMs = DEFAULT_PLAN_TTL_MS } = {}) {
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
          blocked.push(redactReadinessValue({ ...change, reason: invalid, repairMode: classification?.repairMode || 'manual' }));
          continue;
        }
        if (!classification) {
          blocked.push(redactReadinessValue({ ...change, reason: 'repair class is not declared', repairMode: 'manual' }));
          continue;
        }
        if (classification.repairMode !== 'automatic') {
          blocked.push(redactReadinessValue({ ...change, repairMode: classification.repairMode, operatorAction: classification.operation }));
          continue;
        }
        if (classification.requiresIsolatedWorker && change.worker !== 'isolated-readiness-worker') {
          blocked.push(redactReadinessValue({ ...change, repairMode: 'manual', reason: 'feature-flag repair requires an isolated readiness worker' }));
          continue;
        }
        const adapter = adapters[change.repairClass];
        if (!adapter || typeof adapter.read !== 'function' || typeof adapter.write !== 'function' || typeof adapter.readback !== 'function') {
          blocked.push(redactReadinessValue({ ...change, repairMode: 'manual', reason: 'supported mutation and readback adapter is unavailable' }));
          continue;
        }
        if (classification.requiresIsolatedWorker && typeof adapter.restore !== 'function') {
          blocked.push(redactReadinessValue({ ...change, repairMode: 'manual', reason: 'isolated readiness worker restore adapter is unavailable' }));
          continue;
        }
        changes.push(redactReadinessValue({ ...change, repairMode: 'automatic' }));
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

  async function applyRepairs({ digest, confirmedBy, targets = [], now = clock() } = {}) {
    const plan = plans.get(digest);
    if (!plan || plan.digest !== digest) throw new Error('repair plan digest does not match a displayed preview');
    if (!confirmedBy || typeof confirmedBy !== 'string') throw new Error('an administrator confirmation is required');
    if (plan.confirmed) throw new Error('repair plan is already confirmed');
    if (now >= plan.expiresAt) throw new Error('repair plan has expired');
    if (!sameValue(canonicalTargets(targets), plan.targets)) throw new Error('repair plan target set changed after preview');

    const prewrites = [];
    for (const change of plan.changes) {
      const adapter = adapters[change.repairClass];
      const current = await adapter.read({ target: change.target, object: change.object, sourceRef: change.sourceRef, worker: change.worker });
      if (sameValue(current, change.expected)) {
        prewrites.push({ change, adapter, current, outcome: 'already-applied' });
        continue;
      }
      if (!sameValue(current, change.current)) {
        throw new Error('repair current value changed after preview');
      }
      prewrites.push({ change, adapter, current, outcome: 'pending' });
    }

    const evidence = [];
    for (const item of prewrites) {
      const { change, adapter, current } = item;
      if (item.outcome === 'already-applied') {
        evidence.push(redactReadinessValue({ target: change.target, object: change.object, before: current, after: current, sourceRef: change.sourceRef, operation: change.operation, outcome: item.outcome }));
        continue;
      }
      let writeAttempted = false;
      try {
        writeAttempted = true;
        await adapter.write({ ...change, current, digest: plan.digest, idempotencyKey: plan.digest, confirmedBy });
        const after = await adapter.readback({ target: change.target, object: change.object, sourceRef: change.sourceRef, worker: change.worker });
        if (!sameValue(after, change.expected)) throw new Error('repair readback does not match the expected value');
        evidence.push(redactReadinessValue({ target: change.target, object: change.object, before: current, after, sourceRef: change.sourceRef, operation: change.operation, outcome: 'applied' }));
      } finally {
        if (writeAttempted && driftClasses[change.repairClass]?.requiresIsolatedWorker) {
          await adapter.restore({ target: change.target, object: change.object, current, worker: change.worker, digest: plan.digest });
        }
      }
    }
    plan.confirmed = true;
    return redactReadinessValue({ planId: plan.planId, digest: plan.digest, confirmedBy, evidence, blocked: plan.blocked });
  }

  return { planRepairs, applyRepairs };
}

module.exports = { DEFAULT_PLAN_TTL_MS, createRepairService, stableJson };
