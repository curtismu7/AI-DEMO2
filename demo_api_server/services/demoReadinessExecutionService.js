'use strict';

const crypto = require('crypto');
const { buildDemoReadinessCatalog } = require('./demoReadinessCatalog');
const featureCheckSource = require('../config/demoReadinessFeatureChecks.json');
const { HARD_DEADLINE_MS, TARGET_WARNING_MS, createReadinessReport, recordCheck, redactReadinessValue } = require('./demoReadinessReport');

const PROVIDERS = new Set(['pingone', 'pingfederate']);
const exactValues = (actual, expected) => JSON.stringify([...new Set((Array.isArray(actual) ? actual : actual == null ? [] : [actual]).filter(Boolean).map(String))].sort()) === JSON.stringify([...new Set((Array.isArray(expected) ? expected : expected == null ? [] : [expected]).filter(Boolean).map(String))].sort());
const orderedValues = (actual, expected) => JSON.stringify(Array.isArray(actual) ? actual : []) === JSON.stringify(Array.isArray(expected) ? expected : []);
const expired = (deadlineAt, now) => Boolean(deadlineAt && now >= deadlineAt);
const outcomeFor = (behavior) => behavior?.expectedOutcome || behavior?.expectedAction || behavior?.kind || 'unknown';
const laneKey = (targetId, provider) => targetId + ':' + provider;
function providerIsolationError(reason) { const error = new Error('provider isolation unavailable: ' + reason); error.code = 'provider_isolation_unavailable'; return error; }

function raceDeadline(task, deadlineAt, now, controller) {
  const remaining = Math.max(0, deadlineAt - now());
  if (remaining === 0) return Promise.resolve({ timedOut: true });
  return new Promise((resolve) => {
    const timer = setTimeout(() => { controller.abort(); resolve({ timedOut: true }); }, remaining);
    Promise.resolve(task).then((value) => { clearTimeout(timer); resolve({ value }); }, (error) => { clearTimeout(timer); resolve({ error }); });
  });
}

function expectedExchangePath(caseRow, provider) {
  if (caseRow.id === 'UC40') return 'native-id-jag';
  if (caseRow.id === 'UC2' || caseRow.id === 'UC2.5') return provider === 'pingfederate' ? 'a2a-id-jag-then-access' : 'a2a-access-token';
  if (caseRow.id === 'UC38' || caseRow.id === 'UC44') return 'actor-bound-standard-two-exchange';
  return 'standard-access-token';
}

function validateWorker(worker, provider, identities, key) {
  if (!worker || typeof worker !== 'object') throw providerIsolationError('worker runtime was not created');
  if (worker.provider !== provider) throw providerIsolationError('worker provider does not match requested provider');
  for (const field of ['runtime', 'cookieJar', 'sessionStore']) {
    if (!worker[field] || typeof worker[field] !== 'object') throw providerIsolationError('worker has no verifiable ' + field + ' object');
    const owner = identities.get(worker[field]);
    if (owner) throw providerIsolationError(field + ' object is reused by ' + owner);
    identities.set(worker[field], key);
  }
  if (typeof worker.executeReadinessCase !== 'function') throw providerIsolationError('worker has no readiness execution adapter');
}

function featureRows(featureChecks, targets, attackLab) {
  return featureChecks.filter((check) => Boolean(check.attackLab) === attackLab).flatMap((check) => targets.flatMap((targetId) => (check.providers || []).filter((provider) => PROVIDERS.has(provider)).map((provider) => ({ kind: attackLab ? 'attackLab' : 'feature', check, targetId, provider }))));
}

function deriveExecutionManifest({ catalog = buildDemoReadinessCatalog(), featureChecks = featureCheckSource.checks || [], targets = ['local', 'hosted'] } = {}) {
  const core = []; const variants = [];
  for (const caseRow of catalog) {
    for (const group of caseRow.runtimeVerticalGroups || []) {
      const vertical = group.vertical || group.verticals?.[0];
      const behavior = group.expectedBehavior || caseRow.expectedBehaviorByVertical?.[vertical] || caseRow.expectedBehavior;
      for (const [provider, flow] of Object.entries(caseRow.providerFlows || {})) if (flow) for (const targetId of targets) core.push({ kind: 'core', caseRow, group, targetId, provider, vertical, behavior });
    }
    for (const behavior of caseRow.alternateBehaviors || []) {
      const vertical = Object.keys(caseRow.expectedBehaviorByVertical || {})[0] || 'banking';
      for (const [provider, flow] of Object.entries(caseRow.providerFlows || {})) if (flow) for (const targetId of targets) variants.push({ kind: 'variant', caseRow, targetId, provider, vertical, behavior });
    }
  }
  const feature = featureRows(featureChecks, targets, false); const attackLab = featureRows(featureChecks, targets, true);
  return { core, variants, feature, attackLab, counts: { core: core.length, variants: variants.length, feature: feature.length, attackLab: attackLab.length, total: core.length + variants.length + feature.length + attackLab.length } };
}

function evidenceFailures({ evidence, provider, authorization, expected, caseRow }) {
  const failures = []; const require = (condition, message) => { if (!condition) failures.push(message); };
  require(evidence.userSessionProvider === provider, 'user-session provider is missing or does not match provider lane');
  const expectedAgentProvider = caseRow.agentIdentityProviderByProvider?.[provider] || provider;
  require(evidence.agentIdentityProvider === expectedAgentProvider, 'agent identity provider does not match static provider-role contract');
  require(evidence.tokenIssuer === provider, 'token issuer is missing or does not match provider lane');
  require(typeof evidence.subject === 'string' && evidence.subject, 'subject is missing');
  require(Array.isArray(evidence.actorChain) && evidence.actorChain.length > 0, 'actor chain is missing');
  if (caseRow.id === 'UC38' || caseRow.id === 'UC44') require(Array.isArray(evidence.actorChain) && evidence.actorChain.length >= 2, 'actor-bound standard exchange requires the retained user and agent chain');
  require(evidence.exchangeService === (caseRow.exchangeService || 'token-exchange'), 'exchange service does not match static contract');
  require(typeof evidence.exchangeProvenance === 'string' && evidence.exchangeProvenance === caseRow.providerFlows?.[provider], 'exchange provenance does not match provider flow');
  if (authorization?.resourceServer) require(evidence.resourceServer === authorization.resourceServer, 'resource server does not match catalog contract');
  else require(typeof evidence.resourceServer === 'string' && evidence.resourceServer, 'resource server is missing');
  require(evidence.roleApplicability && typeof evidence.roleApplicability === 'object' && !Array.isArray(evidence.roleApplicability), 'role applicability is missing');
  if (authorization?.authorizeToolGroup?.role) require(evidence.roleApplicability?.authorizeRole === authorization.authorizeToolGroup.role, 'role applicability does not match Authorize role contract');
  require(evidence.exchangePath === expectedExchangePath(caseRow, provider), 'exchange path does not match case/provider contract');
  if (provider === 'pingfederate' && (caseRow.exchangeService || 'token-exchange') === 'token-exchange') {
    const exchange = evidence.pfExchange || {};
    const pfContract = caseRow.pfExchangeContract;
    require(Boolean(pfContract?.issuer && pfContract?.endpoint && pfContract?.credentialRole), 'PF row has no exact endpoint and credential-role contract');
    require(exchange.issuer === pfContract?.issuer && exchange.endpoint === pfContract?.endpoint, 'PF endpoint or issuer does not match the declared token contract');
    require(exchange.credentialRole === pfContract?.credentialRole, 'PF exchanger credential role does not match the declared PF-only role');
    require(exchange.configurationComplete === true, 'PF exchange configuration is incomplete');
    require(exchange.subjectTokenType === (caseRow.id === 'UC40' ? 'id-jag' : 'access_token'), 'PF subject-token type does not match case provenance');
    if (authorization?.primaryTool) require(exchange.registeredToolResult === 'pass', 'PF registered-tool call did not return the expected result');
  } else if (provider === 'pingone' && (caseRow.exchangeService || 'token-exchange') === 'token-exchange') require(evidence.subjectTokenType === 'access_token', 'PingOne subject-token type must be access_token');
  if ((caseRow.id === 'UC2' || caseRow.id === 'UC2.5') && provider === 'pingfederate') {
    const hops = evidence.exchangeHops || [];
    require(hops.length === 2 && hops[0]?.step === 'exchange1-id-jag' && hops[0]?.type === 'id-jag' && hops[1]?.step === 'exchange2-access-token' && hops[1]?.type === 'access_token', 'PF A2A requires ordered intermediate ID-JAG then Exchange #2 access token');
    require(hops.length === 2 && hops.every((hop) => hop?.subject === evidence.subject && orderedValues(hop?.actorChain, evidence.actorChain)), 'PF A2A exchanges must retain the user subject and ordered actor chain');
  }
  if (caseRow.id === 'UC38' || caseRow.id === 'UC44') {
    const hops = evidence.exchangeHops || [];
    require(hops.length === 2 && hops.every((hop) => hop?.subject === evidence.subject && orderedValues(hop?.actorChain, evidence.actorChain)), 'actor-bound exchanges must retain the same subject and ordered actor chain at every hop');
  }
  if (authorization?.primaryTool) {
    require(evidence.selectedTool === authorization.primaryTool, 'selected tool does not match catalog contract');
    require(exactValues(evidence.audiences, authorization.scopeResources?.map((item) => item.audience)), 'audience set does not match catalog contract');
    require(exactValues(evidence.scopes, authorization.requiredScopes), 'scope set does not match catalog contract');
    require(Boolean(evidence.gateway?.route && evidence.gateway?.verdict), 'Gateway evidence is required for an exchanged tool call');
    require(Boolean(evidence.authorize?.reference && evidence.authorize?.decision), 'Authorize evidence is required for an exchanged tool call');
    if (['PERMIT', 'DENY', 'STEP_UP', 'HITL_REQUIRED'].includes(expected)) {
      require(evidence.gateway?.verdict === expected, 'Gateway verdict does not match declared outcome');
      require(evidence.authorize?.decision === expected, 'Authorize decision does not match declared outcome');
    }
  } else {
    require(evidence.gateway?.applicable === false, 'non-exchange case must declare Gateway evidence not applicable');
    require(evidence.authorize?.applicable === false, 'non-exchange case must declare Authorize evidence not applicable');
  }
  return failures;
}

function featureContract(check, provider) {
  const contract = check.executionContract || featureCheckSource.contracts?.[check.id];
  if (!contract || !contract.providerFlows?.[provider] || !contract.exchangeService || !contract.resourceServer || !Array.isArray(contract.audiences) || !Array.isArray(contract.requiredScopes) || !Array.isArray(contract.behaviorStages) || !Object.hasOwn(contract, 'selectedTool') || !Object.hasOwn(contract, 'expectedDecision')) return null;
  if (provider === 'pingfederate' && contract.exchangeService === 'token-exchange' && !contract.pfExchangeContract) return null;
  const exchangeBacked = Boolean(contract.selectedTool);
  return {
    id: check.executionMode === 'pf-native-id-jag-negative' ? 'UC40' : check.executionMode === 'a2a-passenger-negative' ? 'UC2' : check.id,
    providerFlows: { [provider]: contract.providerFlows[provider] },
    agentIdentityProviderByProvider: check.agentIdentityProviderByProvider || { [provider]: provider },
    exchangeService: contract.exchangeService,
    pfExchangeContract: contract.pfExchangeContract,
    authorizationContractByVertical: {
      feature: exchangeBacked ? {
        primaryTool: contract.selectedTool, resourceServer: contract.resourceServer, expectedDecision: contract.expectedDecision,
        requiredScopes: contract.requiredScopes, scopeResources: contract.audiences.map((audience) => ({ audience })),
        authorizeToolGroup: contract.authorizeToolGroup,
      } : { primaryTool: null, resourceServer: contract.resourceServer, expectedDecision: contract.expectedDecision, gateway: contract.gateway, authorize: contract.authorize },
    },
    contract,
  };
}

function createReadinessExecutionService({ createWorker: testWorkerAdapter, catalog = buildDemoReadinessCatalog(), featureChecks = featureCheckSource.checks || [], now = () => Date.now() } = {}) {
  // There is deliberately no production worker factory. Jest may inject this
  // adapter directly; request data can never enable it in a running BFF.
  const workerAdapter = process.env.NODE_ENV === 'test' ? testWorkerAdapter : null;
  const contexts = new WeakMap(); const identities = new Map();
  async function createWorkerContext({ targetId, provider, identityRef, deadlineAt }) {
    if (!targetId || !PROVIDERS.has(provider)) throw providerIsolationError('target and supported provider are required');
    if (expired(deadlineAt, now())) throw new Error('deadline exceeded before provider worker creation');
    if (typeof workerAdapter !== 'function') throw providerIsolationError('no private separate provider-configured worker runtime is available');
    const worker = await workerAdapter({ targetId, provider, identityRef, deadlineAt });
    validateWorker(worker, provider, identities, laneKey(targetId, provider));
    if (expired(deadlineAt, now())) throw new Error('deadline exceeded while creating provider worker');
    const context = Object.freeze({}); contexts.set(context, { worker, targetId, provider }); return context;
  }
  async function executeReadinessCase({ context, caseRow, vertical, mode, deadlineAt, behavior: override, abortSignal }) {
    if (expired(deadlineAt, now())) return redactReadinessValue({ status: 'not-run', expected: null, observed: 'deadline-expired', evidence: { reason: 'deadline exceeded before dispatch' } });
    const saved = contexts.get(context); const behavior = override || caseRow?.expectedBehaviorByVertical?.[vertical]; const authorization = caseRow?.authorizationContractByVertical?.[vertical]; const prerequisites = caseRow?.runtimePrerequisitesByVertical?.[vertical]; const expected = outcomeFor(behavior);
    if (!saved) return redactReadinessValue({ status: 'blocked', expected, observed: 'not-dispatched', evidence: { reason: 'unknown or forged readiness worker context' } });
    if (!behavior || !authorization || !prerequisites) return redactReadinessValue({ status: 'blocked', expected, observed: 'not-dispatched', evidence: { reason: 'catalog has no complete contract for vertical ' + vertical } });
    const prerequisite = typeof saved.worker.verifyPrerequisites === 'function' ? await saved.worker.verifyPrerequisites({ caseRow, vertical, prerequisites, deadlineAt }) : { status: 'blocked', reason: 'worker cannot verify runtime prerequisites' };
    if (prerequisite?.status !== 'pass') return redactReadinessValue({ status: 'blocked', expected, observed: 'not-dispatched', evidence: { reason: prerequisite?.reason || 'runtime prerequisites unavailable', prerequisites } });
    if (expired(deadlineAt, now())) return redactReadinessValue({ status: 'not-run', expected, observed: 'deadline-expired', evidence: { reason: 'deadline exceeded before dispatch' } });
    try { const execution = await saved.worker.executeReadinessCase({ context, caseRow, vertical, mode, behavior, authorization, deadlineAt, abortSignal }); const evidence = execution?.evidence || {}; const observed = execution?.observed || 'UNKNOWN'; const failures = [...(observed === expected ? [] : ['observed outcome does not match declared outcome']), ...evidenceFailures({ evidence, provider: saved.provider, authorization, expected, caseRow })]; if (failures.length) evidence.contractFailures = failures; return redactReadinessValue({ status: failures.length ? 'fail' : 'pass', expected, observed, evidence }); } catch (error) { return redactReadinessValue({ status: 'fail', expected, observed: 'execution-error', evidence: { reason: error?.message || 'worker execution failed' } }); }
  }
  async function executeReadinessFeature({ context, check, deadlineAt, abortSignal }) {
    const saved = contexts.get(context); const expected = check.expectedByProvider?.[saved?.provider] || check.expectedOutcome;
    if (!saved || !expected) return redactReadinessValue({ status: 'blocked', expected: expected || null, observed: 'not-dispatched', evidence: { reason: 'feature contract or worker context is unavailable' } });
    if (typeof saved.worker.executeReadinessFeature !== 'function') return redactReadinessValue({ status: 'blocked', expected, observed: 'not-dispatched', evidence: { reason: 'worker has no feature-probe execution adapter' } });
    if (expired(deadlineAt, now())) return redactReadinessValue({ status: 'not-run', expected, observed: 'deadline-expired', evidence: { reason: 'deadline exceeded before feature dispatch' } });
    const configurationDependencies = check.configurationDependencies || [];
    const prerequisite = typeof saved.worker.verifyFeaturePrerequisites === 'function'
      ? await saved.worker.verifyFeaturePrerequisites({ context, check, configurationDependencies, deadlineAt })
      : { status: 'blocked', reason: 'worker cannot verify feature configuration dependencies' };
    if (prerequisite?.status !== 'pass' || !exactValues(prerequisite?.verifiedDependencies, configurationDependencies)) {
      return redactReadinessValue({ status: 'blocked', expected, observed: 'not-dispatched', evidence: { reason: prerequisite?.reason || 'feature configuration dependencies are unavailable', configurationDependencies } });
    }
    try {
      const execution = await saved.worker.executeReadinessFeature({ context, check, deadlineAt, abortSignal }); const evidence = execution?.evidence || {}; const observed = execution?.observed || '';
      const staticCase = featureContract(check, saved.provider);
      if (!staticCase) return redactReadinessValue({ status: 'blocked', expected, observed: 'not-dispatched', evidence: { reason: 'feature manifest has no complete static execution contract' } });
      const authorization = staticCase.authorizationContractByVertical.feature;
      const failures = [...(observed === expected ? [] : ['observed outcome does not match declared feature outcome']), ...evidenceFailures({ evidence, provider: saved.provider, authorization, expected: authorization.expectedDecision, caseRow: staticCase })];
      requireFeatureEvidence(failures, evidence, check, saved.provider);
      if (failures.length) evidence.contractFailures = failures;
      return redactReadinessValue({ status: failures.length ? 'fail' : 'pass', expected, observed, evidence });
    } catch (error) { return redactReadinessValue({ status: 'fail', expected, observed: 'execution-error', evidence: { reason: error?.message || 'feature probe failed' } }); }
  }
  function staticRow(row, status, reason) { return redactReadinessValue({ status, expected: row.check ? (row.check.expectedByProvider?.[row.provider] || row.check.expectedOutcome) : outcomeFor(row.behavior), observed: status === 'not-run' ? 'deadline-expired' : 'not-dispatched', evidence: { reason, provider: row.provider, target: row.targetId } }); }
  async function runManifest({ targets = ['local', 'hosted'], identityRefFor, deadlineAt, startedAt = now(), commit, report: suppliedReport, onProgress } = {}) {
    const manifest = deriveExecutionManifest({ catalog, featureChecks, targets }); const hardDeadlineAt = deadlineAt || startedAt + HARD_DEADLINE_MS; const report = suppliedReport || createReadinessReport({ runId: crypto.randomUUID(), commit, targets, startedAt, deadlineAt: hardDeadlineAt }); report.categoryCounts = manifest.counts; onProgress?.({ index: 0, total: manifest.counts.total, categoryCounts: manifest.counts, phase: 'inventory' }); const rows = [...manifest.core, ...manifest.variants, ...manifest.feature, ...manifest.attackLab]; const lanes = new Map(); const results = [];
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]; let result; const key = laneKey(row.targetId, row.provider); let lane = lanes.get(key);
      if (expired(hardDeadlineAt, now())) result = staticRow(row, 'not-run', 'deadline exceeded before row dispatch');
      else if (lane?.blocked) result = staticRow(row, 'blocked', lane.reason);
      else try {
        if (!lane) { lane = { context: await createWorkerContext({ targetId: row.targetId, provider: row.provider, identityRef: identityRefFor?.(row), deadlineAt: hardDeadlineAt }), blocked: false }; lanes.set(key, lane); }
        const controller = new AbortController();
        const task = row.check
          ? executeReadinessFeature({ context: lane.context, check: row.check, deadlineAt: hardDeadlineAt, abortSignal: controller.signal })
          : executeReadinessCase({ context: lane.context, caseRow: row.caseRow, vertical: row.vertical, mode: row.caseRow.executionMode, behavior: row.behavior, deadlineAt: hardDeadlineAt, abortSignal: controller.signal });
        const raced = await raceDeadline(task, hardDeadlineAt, now, controller);
        if (raced.timedOut) result = staticRow(row, 'not-run', 'deadline exceeded during row dispatch');
        else if (raced.error) throw raced.error;
        else result = raced.value;
      } catch (error) { lane = { blocked: true, reason: error?.message || 'provider worker setup failed' }; lanes.set(key, lane); result = staticRow(row, 'blocked', lane.reason); }
      result = redactReadinessValue(result); results.push(result);
      recordCheck(report, { id: [row.kind, row.caseRow?.id || row.check?.id, row.targetId, row.provider, row.behavior?.variant || row.vertical || index].filter(Boolean).join(':'), target: row.targetId, useCaseId: row.caseRow?.id || row.check?.id, userSessionProvider: result.evidence?.userSessionProvider, agentIdentityProvider: result.evidence?.agentIdentityProvider, tokenIssuer: result.evidence?.tokenIssuer, exchangeService: result.evidence?.exchangeService, resourceServer: result.evidence?.resourceServer, providerApplicability: result.evidence?.providerRoleApplicability || row.check?.providerRoleApplicability || result.evidence?.roleApplicability || { [row.provider]: 'applicable' }, status: result.status, expected: result.expected, observed: result.observed, sourceRef: row.caseRow?.sourceRef || row.check?.sourceRef, evidence: result.evidence }); onProgress?.({ index: index + 1, total: rows.length, categoryCounts: manifest.counts, row, result });
    }
    const elapsedMs = Math.max(0, now() - startedAt); const timing = { elapsedMs, targetMs: TARGET_WARNING_MS, hardLimitMs: HARD_DEADLINE_MS, targetMet: elapsedMs < TARGET_WARNING_MS && results.every((result) => result.status !== 'not-run'), deadlineExceeded: elapsedMs >= HARD_DEADLINE_MS || results.some((result) => result.status === 'not-run') }; report.elapsedMs = elapsedMs; report.targetWarning = elapsedMs >= TARGET_WARNING_MS; if (timing.deadlineExceeded) { report.status = 'deadline_exceeded'; report.ready = false; } else if (!timing.targetMet) { report.status = 'not-ready'; report.ready = false; }
    return { manifest, categoryCounts: manifest.counts, results, report, timing };
  }
  return { createWorkerContext, executeReadinessCase, executeReadinessFeature, runManifest, deriveExecutionManifest: (options) => deriveExecutionManifest({ catalog, featureChecks, ...options }) };
}

function requireFeatureEvidence(failures, evidence, check, provider) {
  const require = (condition, message) => { if (!condition) failures.push(message); };
  const contract = check.executionContract || featureCheckSource.contracts?.[check.id];
  const supplied = evidence.requiredEvidence || [];
  require(Array.isArray(check.requiredEvidence) && exactValues(supplied, check.requiredEvidence), 'required feature evidence does not match static contract');
  require(JSON.stringify(evidence.providerRoleApplicability || {}) === JSON.stringify(check.providerRoleApplicability || {}), 'feature provider-role applicability does not match static contract');
  require(evidence.userSessionProvider === provider && evidence.agentIdentityProvider === (check.agentIdentityProviderByProvider?.[provider] || provider), 'feature observed provider roles do not match static contract');
  require(Array.isArray(evidence.behaviorStages) && JSON.stringify(evidence.behaviorStages) === JSON.stringify(contract?.behaviorStages), 'feature behavior stages do not match static execution contract');
}

module.exports = { createReadinessExecutionService, deriveExecutionManifest, expectedExchangePath };
