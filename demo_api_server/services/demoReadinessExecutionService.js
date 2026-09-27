'use strict';

/**
 * Readiness execution is deliberately an adapter over isolated worker runtimes.
 * It must never borrow the presenter BFF session or change configStore's
 * process-wide oauth_provider value.  A deployer supplies workers that own
 * their provider configuration, cookie jar, and session store; this module
 * keeps only opaque handles and sanitized evidence.
 */

const crypto = require('crypto');
const { buildDemoReadinessCatalog } = require('./demoReadinessCatalog');
const featureCheckSource = require('../config/demoReadinessFeatureChecks.json');
const { redactReadinessValue } = require('./demoReadinessReport');

const PROVIDERS = new Set(['pingone', 'pingfederate']);

function expired(deadlineAt, now = Date.now()) {
  return Boolean(deadlineAt && now >= deadlineAt);
}

function exactValues(actual, expected) {
  const normalize = (values) => [...new Set((Array.isArray(values) ? values : values == null ? [] : [values])
    .filter(Boolean).map(String))].sort();
  return JSON.stringify(normalize(actual)) === JSON.stringify(normalize(expected));
}

function outcomeFor(behavior) {
  return behavior?.expectedOutcome || behavior?.expectedAction || behavior?.kind || 'unknown';
}

function workerIsolationError(reason) {
  const error = new Error('provider isolation unavailable: ' + reason);
  error.code = 'provider_isolation_unavailable';
  return error;
}

function validateWorker(worker, provider) {
  if (!worker || typeof worker !== 'object') throw workerIsolationError('worker runtime was not created');
  if (worker.provider !== provider) throw workerIsolationError('worker provider does not match requested provider');
  if (worker.isolated !== true) throw workerIsolationError('worker did not prove an isolated session and cookie store');
  if (typeof worker.executeReadinessCase !== 'function') throw workerIsolationError('worker has no readiness execution adapter');
}

function featureRows(featureChecks, targets) {
  const rows = [];
  for (const check of featureChecks) {
    for (const targetId of targets) for (const provider of check.providers || []) {
      if (PROVIDERS.has(provider)) rows.push({ kind: 'feature', check, targetId, provider });
    }
  }
  return rows;
}

/**
 * Derive, do not hand-maintain, the readiness row count.  The partition keeps
 * the 46 UI steps distinct from feature probes while making omissions visible.
 */
function deriveExecutionManifest({ catalog = buildDemoReadinessCatalog(), featureChecks = featureCheckSource.checks || [], targets = ['local', 'hosted'] } = {}) {
  const core = [];
  const variants = [];
  for (const caseRow of catalog) {
    for (const group of caseRow.runtimeVerticalGroups || []) {
      for (const provider of Object.keys(caseRow.providerFlows || {})) {
        if (!caseRow.providerFlows[provider]) continue;
        for (const targetId of targets) core.push({ kind: 'core', caseRow, group, targetId, provider });
      }
    }
    for (const behavior of caseRow.alternateBehaviors || []) {
      for (const provider of Object.keys(caseRow.providerFlows || {})) {
        if (!caseRow.providerFlows[provider]) continue;
        for (const targetId of targets) variants.push({ kind: 'variant', caseRow, behavior, targetId, provider });
      }
    }
  }
  const feature = featureRows(featureChecks.filter((check) => !check.attackLab), targets);
  const attackLab = featureRows(featureChecks.filter((check) => check.attackLab), targets);
  return {
    core, variants, feature, attackLab,
    counts: { core: core.length, variants: variants.length, feature: feature.length, attackLab: attackLab.length,
      total: core.length + variants.length + feature.length + attackLab.length },
  };
}

function evidenceFailures({ evidence, provider, authorization, expected }) {
  const failures = [];
  const hasTool = Boolean(authorization?.primaryTool);
  if (evidence.tokenIssuer && evidence.tokenIssuer !== provider) failures.push('token issuer does not match provider lane');
  if (hasTool) {
    if (evidence.selectedTool !== authorization.primaryTool) failures.push('selected tool does not match catalog contract');
    if (!exactValues(evidence.audiences, authorization.scopeResources?.map((item) => item.audience))) failures.push('audience set does not match catalog contract');
    if (!exactValues(evidence.scopes, authorization.requiredScopes)) failures.push('scope set does not match catalog contract');
    if (!evidence.gateway?.route || !evidence.gateway?.verdict) failures.push('Gateway evidence is required for an exchanged tool call');
    if (!evidence.authorize?.reference || !evidence.authorize?.decision) failures.push('Authorize evidence is required for an exchanged tool call');
    if (['PERMIT', 'DENY', 'STEP_UP', 'HITL_REQUIRED'].includes(expected)) {
      if (evidence.gateway?.verdict !== expected) failures.push('Gateway verdict does not match declared outcome');
      if (evidence.authorize?.decision !== expected) failures.push('Authorize decision does not match declared outcome');
    }
  } else if (evidence.gateway?.applicable !== false || evidence.authorize?.applicable !== false) {
    failures.push('non-exchange case must declare Gateway and Authorize evidence not applicable');
  }
  return failures;
}

function createReadinessExecutionService({ createWorker, catalog = buildDemoReadinessCatalog(), featureChecks = featureCheckSource.checks || [], now = () => Date.now() } = {}) {
  const contexts = new Map();

  async function createWorkerContext({ targetId, provider, identityRef, deadlineAt }) {
    if (!targetId || !PROVIDERS.has(provider)) throw workerIsolationError('target and supported provider are required');
    if (expired(deadlineAt, now())) throw new Error('deadline exceeded before provider worker creation');
    if (typeof createWorker !== 'function') throw workerIsolationError('no separate provider-configured worker runtime is available');
    const worker = await createWorker({ targetId, provider, identityRef, deadlineAt });
    validateWorker(worker, provider);
    if (expired(deadlineAt, now())) throw new Error('deadline exceeded while creating provider worker');
    const handle = crypto.randomUUID();
    contexts.set(handle, { worker, targetId, provider });
    return Object.freeze({ handle, targetId, provider });
  }

  async function executeReadinessCase({ context, caseRow, vertical, mode, deadlineAt }) {
    if (expired(deadlineAt, now())) return redactReadinessValue({ status: 'not-run', expected: null, observed: 'deadline-expired', evidence: { reason: 'deadline exceeded before dispatch' } });
    const saved = contexts.get(context?.handle);
    if (!saved || saved.targetId !== context.targetId || saved.provider !== context.provider) {
      return redactReadinessValue({ status: 'blocked', expected: null, observed: 'not-dispatched', evidence: { reason: 'unknown or forged readiness worker context' } });
    }
    const behavior = caseRow?.expectedBehaviorByVertical?.[vertical];
    const authorization = caseRow?.authorizationContractByVertical?.[vertical];
    const prerequisites = caseRow?.runtimePrerequisitesByVertical?.[vertical];
    const expected = outcomeFor(behavior);
    if (!behavior || !authorization || !prerequisites) {
      return redactReadinessValue({ status: 'blocked', expected, observed: 'not-dispatched', evidence: { reason: 'catalog has no complete contract for vertical ' + vertical } });
    }
    const prerequisite = typeof saved.worker.verifyPrerequisites === 'function'
      ? await saved.worker.verifyPrerequisites({ caseRow, vertical, prerequisites, deadlineAt })
      : { status: 'blocked', reason: 'worker cannot verify runtime prerequisites' };
    if (prerequisite?.status !== 'pass') {
      return redactReadinessValue({ status: 'blocked', expected, observed: 'not-dispatched', evidence: { reason: prerequisite?.reason || 'runtime prerequisites unavailable', prerequisites } });
    }
    if (expired(deadlineAt, now())) return redactReadinessValue({ status: 'not-run', expected, observed: 'deadline-expired', evidence: { reason: 'deadline exceeded before dispatch' } });

    try {
      const execution = await saved.worker.executeReadinessCase({ context, caseRow, vertical, mode, behavior, authorization, deadlineAt });
      const observed = execution?.observed || 'UNKNOWN';
      const evidence = {
        userSessionProvider: saved.provider,
        agentIdentityProvider: execution?.evidence?.agentIdentityProvider || saved.provider,
        tokenIssuer: execution?.evidence?.tokenIssuer || saved.provider,
        exchangeService: execution?.evidence?.exchangeService || caseRow.providerFlows?.[saved.provider] || null,
        resourceServer: execution?.evidence?.resourceServer || authorization.resourceServer || null,
        roleApplicability: execution?.evidence?.roleApplicability || {},
        ...(execution?.evidence || {}),
      };
      const failures = [
        ...(observed === expected ? [] : ['observed outcome does not match declared outcome']),
        ...evidenceFailures({ evidence, provider: saved.provider, authorization, expected }),
      ];
      if (failures.length) evidence.contractFailures = failures;
      return redactReadinessValue({ status: failures.length ? 'fail' : 'pass', expected, observed, evidence });
    } catch (error) {
      return redactReadinessValue({ status: 'fail', expected, observed: 'execution-error', evidence: { reason: error?.message || 'worker execution failed' } });
    }
  }

  async function runManifest({ targets = ['local', 'hosted'], identityRefFor, deadlineAt }) {
    const manifest = deriveExecutionManifest({ catalog, featureChecks, targets });
    const results = [];
    for (const row of [...manifest.core, ...manifest.variants]) {
      if (expired(deadlineAt, now())) break;
      try {
        const context = await createWorkerContext({ targetId: row.targetId, provider: row.provider, identityRef: identityRefFor?.(row), deadlineAt });
        const vertical = row.group?.vertical || row.group?.verticals?.[0] || 'banking';
        results.push(await executeReadinessCase({ context, caseRow: row.caseRow, vertical, mode: row.caseRow.executionMode, deadlineAt }));
      } catch (error) {
        results.push(redactReadinessValue({
          status: 'blocked', expected: outcomeFor(row.caseRow.expectedBehaviorByVertical?.[row.group?.vertical || row.group?.verticals?.[0]]),
          observed: 'not-dispatched', evidence: { reason: error?.message || 'provider worker setup failed', provider: row.provider, target: row.targetId },
        }));
      }
    }
    return { manifest, results };
  }

  return { createWorkerContext, executeReadinessCase, runManifest, deriveExecutionManifest: (options) => deriveExecutionManifest({ catalog, featureChecks, ...options }) };
}

module.exports = { createReadinessExecutionService, deriveExecutionManifest };
