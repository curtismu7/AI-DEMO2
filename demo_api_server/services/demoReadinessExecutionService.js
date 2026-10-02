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

function defaultInventorySink({ categoryCounts }) {
  // This is intentionally a concrete, token-free sink. A caller can replace it
  // with its job logger, but inventory is always emitted before worker setup.
  console.info('[demo-readiness] inventory ' + JSON.stringify(categoryCounts));
}

function pfSourceGap(contract) {
  if (!contract || typeof contract !== 'object') {
    return {
      code: 'pf_exact_exchange_contract_missing',
      reason: 'The readiness row has no checked-in PingFederate issuer, endpoint, and credential-role contract.',
    };
  }
  if (contract.status === 'blocked' || contract.sourceGap) {
    return contract.sourceGap || {
      code: 'pf_exact_exchange_contract_source_gap',
      reason: 'The PingFederate exact exchange contract is unresolved.',
    };
  }
  return null;
}

function pfReadyContract(contract) {
  if (pfSourceGap(contract)) return false;
  const issuer = typeof contract?.issuer === 'string' ? contract.issuer : null;
  const endpoint = typeof contract?.endpoint === 'string' ? contract.endpoint : null;
  const role = contract?.credentialRole || contract?.credentialRoles?.[0]?.roleId;
  return Boolean(issuer && endpoint && role);
}

function pfEndpointShapeMatches(issuer, endpoint) {
  try {
    const parsedIssuer = new URL(issuer);
    const parsedEndpoint = new URL(endpoint);
    return parsedIssuer.protocol === 'https:'
      && parsedEndpoint.protocol === 'https:'
      && parsedIssuer.origin === parsedEndpoint.origin
      && parsedEndpoint.pathname.length > 1;
  } catch {
    return false;
  }
}

function raceDeadline(task, deadlineAt, now, controller) {
  const remaining = Math.max(0, deadlineAt - now());
  if (remaining === 0) {
    controller.abort();
    // A setup promise may already have synchronously started before the clock
    // check. Consume a later rejection so an expired lane still returns the
    // complete not-run inventory without an unhandled rejection.
    Promise.resolve(task).catch(() => {});
    return Promise.resolve({ timedOut: true });
  }
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

// Feature readiness is deliberately dispatched by family.  A worker may expose
// a single real runtime, but it cannot satisfy a feature probe by echoing the
// manifest or by returning an arbitrary label through a generic adapter.
const FEATURE_DISPATCHERS = Object.freeze({
  'a2a-fm1': 'executeA2aFm1',
  'a2a-fm2': 'executeA2aFm2',
  'a2a-fm3': 'executeA2aFm3',
  'pf-davinci-login': 'executePfDavinciLoginProof',
  'attack-tool-abuse': 'executeAttackLabToolAbuse',
  'attack-tool-poisoning': 'executeAttackLabToolPoisoning',
  'attack-schema-violation': 'executeAttackLabSchemaViolation',
  'attack-inter-agent-abuse': 'executeAttackLabInterAgentAbuse',
  'attack-malicious-content': 'executeAttackLabMaliciousContent',
  'agent-iam-core': 'executeAgentIamCore',
  'pf-cimd': 'executeCimdMetadata',
  'pf-third-party-as': 'executeThirdPartyAuthorizationServer',
  'pf-native-id-jag': 'executeNativeIdJagNegative',
  'pf-rar': 'executeRarAuthorizationDetails',
  'uc2-passenger-invalid-target': 'executeUc2PassengerInvalidTarget',
  'prompt-injection': 'executePromptInjection',
});

function canonicalObject(value) {
  if (Array.isArray(value)) return value.map(canonicalObject);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalObject(value[key])]));
}

function sameObject(actual, expected) {
  return JSON.stringify(canonicalObject(actual || {})) === JSON.stringify(canonicalObject(expected || {}));
}

function featureSourceGap(contract, provider) {
  if (contract?.status === 'blocked' || contract?.sourceGap) return contract.sourceGap || { code: 'feature_contract_source_gap', reason: 'The feature contract is blocked.' };
  if (contract?.familyContract?.status === 'blocked' || contract?.familyContract?.sourceGap) {
    return contract.familyContract.sourceGap || { code: 'feature_family_source_gap', reason: 'The feature family contract is blocked.' };
  }
  if (provider === 'pingfederate') {
    const exchangeBacked = contract?.exchangeService === 'token-exchange';
    const pfContract = exchangeBacked ? contract?.pfExchangeContract : contract?.pfCredentialContract;
    const sourceGapCode = exchangeBacked ? 'pf_exact_exchange_contract_source_gap' : 'pf_exact_credential_contract_source_gap';
    const roles = pfContract?.credentialRoles;
    const sourceBackedRoles = Array.isArray(roles) && roles.length > 0
      && roles.every((role) => typeof role?.roleId === 'string' && role.roleId
        && typeof role?.sourceRef === 'string' && role.sourceRef
        && Array.isArray(role.configurationKeys));
    const missingContract = {
      code: sourceGapCode,
      reason: exchangeBacked
        ? 'The PingFederate feature row has no exact source-backed issuer, endpoint, and credential-role contract.'
        : 'The PingFederate feature row has no exact source-backed credential contract.',
      remediation: 'Add the checked-in PingFederate contract or a named source gap before enabling this provider lane.',
    };
    if (!pfContract || !sourceBackedRoles) return missingContract;
    if (exchangeBacked) {
      const sourceGap = pfSourceGap(pfContract);
      if (sourceGap) return sourceGap;
      if (pfContract.status !== 'ready' || typeof pfContract.issuer !== 'string'
          || typeof pfContract.endpoint !== 'string' || !pfContract.issuerSourceRef || !pfContract.endpointSourceRef) {
        return missingContract;
      }
    } else if (pfContract.status === 'blocked' || pfContract.sourceGap) {
      return pfContract.sourceGap || { code: sourceGapCode, reason: 'The PingFederate credential contract is blocked.' };
    } else if (pfContract.status !== 'ready') {
      return missingContract;
    }
  }
  return null;
}

function sameRoute(actual, expected) {
  try {
    const actualRoute = new URL(actual, 'https://readiness.invalid');
    const expectedRoute = new URL(expected, 'https://readiness.invalid');
    if (actualRoute.pathname !== expectedRoute.pathname) return false;
    const expectedParams = [...expectedRoute.searchParams.entries()];
    return expectedParams.every(([key, value]) => actualRoute.searchParams.get(key) === value);
  } catch {
    return false;
  }
}

function validateFeatureFamilyEvidence(failures, evidence, contract, provider) {
  const require = (condition, message) => { if (!condition) failures.push(message); };
  const family = contract.featureFamily;
  const expected = contract.familyContract || {};
  const feature = evidence.feature || {};
  require(feature.family === family, 'feature evidence family does not match the declared family contract');

  switch (family) {
    case 'a2a-fm1':
      require(sameRoute(feature.route, expected.route), 'A2A FM1 did not invoke the declared direct A2A route');
      require(feature.request?.prompt === expected.prompt, 'A2A FM1 did not use the declared out-of-allowlist prompt');
      require(feature.allowlist?.refused === true && feature.allowlist?.reason === expected.refusalReason, 'A2A FM1 did not prove the named allowlist refusal');
      require(feature.exchangeReached === false && feature.toolReached === false, 'A2A FM1 reached exchange or a specialist tool after an allowlist refusal');
      break;
    case 'a2a-fm2':
      require(sameRoute(feature.route, expected.route), 'A2A FM2 did not invoke the declared direct A2A route');
      require(feature.bearer?.hasAct === false, 'A2A FM2 did not use an act-less bearer');
      require((expected.allowedStatusCodes || []).includes(feature.response?.status), 'A2A FM2 response status is outside the source-declared outcomes');
      require(feature.toolDataExposed === false, 'A2A FM2 exposed specialist tool data');
      break;
    case 'a2a-fm3':
      require(sameRoute(feature.route, expected.route), 'A2A FM3 did not invoke the declared A2A route');
      require(orderedValues(feature.exchange?.steps, provider === 'pingfederate' ? expected.pingfederateExchangeSteps : expected.exchangeSteps), 'A2A FM3 did not preserve the declared ordered exchange chain');
      require(feature.exchange?.tool === expected.tool && feature.exchange?.toolDispatched === true, 'A2A FM3 did not dispatch the declared specialist tool');
      break;
    case 'pf-davinci-login':
      require(feature.proof?.provider === 'pingfederate' && feature.proof?.verified === true, 'DaVinci proof did not verify the dedicated PingFederate login');
      require(feature.pingoneSessionPreserved === true, 'DaVinci proof did not preserve the observed PingOne session');
      break;
    case 'attack-tool-abuse':
      require(feature.attack?.sim === expected.sim && feature.attack?.tool === expected.tool && feature.attack?.crossOwnerAttempt === true, 'Tool Abuse did not execute the declared cross-owner simulation');
      require(feature.attack?.decision === expected.decision && feature.attack?.boundary === expected.boundary, 'Tool Abuse did not record the declared authorization/resource-owner boundary');
      break;
    case 'attack-tool-poisoning':
      require(feature.attack?.tool === expected.tool && sameObject(feature.attack?.arguments, expected.arguments), 'Tool Poisoning did not submit the source-declared valid tool call');
      require(feature.attack?.responseStatus === expected.responseStatus && feature.attack?.hitlRequired === true, 'Tool Poisoning did not observe the normal HITL gate');
      break;
    case 'attack-schema-violation':
      require(feature.attack?.boundary === expected.boundary && feature.attack?.schemaRejected === true, 'Schema Violation did not stop at the MCP input-schema boundary');
      require(feature.attack?.toolReached === false, 'Schema Violation reached a tool after input validation failed');
      break;
    case 'attack-inter-agent-abuse':
      require(feature.attack?.boundary === expected.boundary && feature.attack?.delegatedIdentity === expected.delegatedIdentity, 'Inter-Agent Abuse did not exercise the declared A2A identity mismatch');
      require(feature.attack?.specialistReached === false, 'Inter-Agent Abuse reached a specialist after the wire gate failure');
      break;
    case 'attack-malicious-content':
      require(sameRoute(feature.attack?.route, expected.route) && feature.attack?.provider === expected.provider && feature.attack?.contentSubmitted === true, 'Malicious Content did not submit the source-declared Privilege LLM request');
      require(typeof feature.attack?.decision === 'string' && feature.attack.decision.length > 0, 'Malicious Content did not record the observed Privilege decision');
      require(typeof feature.attack?.modelReached === 'boolean', 'Malicious Content did not record model/backend reachability');
      break;
    case 'agent-iam-core':
      require(feature.registry?.source === expected.registrySource && feature.registry?.identityFound === true, 'Agent IAM did not prove its registered identity');
      require(feature.lifecycle?.status === expected.lifecycleStatus, 'Agent IAM did not prove its lifecycle status');
      require(feature.delegatedExchange?.completed === expected.delegatedExchange, 'Agent IAM did not prove its delegated exchange');
      break;
    case 'pf-cimd':
      require(feature.metadata?.valid === expected.metadataValid, 'CIMD metadata validity does not match the declared probe');
      require(feature.registration?.attempted === expected.registrationAttempted, 'CIMD registration reachability does not match the declared probe');
      require(feature.registration?.outcome === expected.registrationOutcome, 'CIMD registration outcome does not match the declared probe');
      break;
    case 'pf-third-party-as':
      require(feature.thirdPartyAuthorizationServer?.exchangeAttempted === true, 'third-party AS probe did not attempt its declared exchange');
      require(feature.thirdPartyAuthorizationServer?.decision === expected.decision, 'third-party AS decision does not match the declared probe');
      break;
    case 'pf-native-id-jag':
      require(feature.nativeIdJag?.invalidReason === expected.invalidReason && feature.nativeIdJag?.rejected === true, 'native ID-JAG invalidity was not rejected for the declared reason');
      require(feature.nativeIdJag?.resourceReached === false, 'native ID-JAG invalidity reached the resource');
      break;
    case 'pf-rar':
      require(feature.authorizationDetails?.valid === expected.authorizationDetailsValid, 'RAR authorization_details validity does not match the declared probe');
      require(feature.authorizationDetails?.decision === expected.decision, 'RAR decision does not match the declared probe');
      break;
    case 'uc2-passenger-invalid-target':
      require(feature.passenger?.error === 'invalid_target', 'UC2 passenger probe did not return invalid_target');
      require(feature.passenger?.exchange3Reached === false && feature.passenger?.nativeIdJagReached === false, 'UC2 passenger invalid_target proceeded to Exchange #3 or native ID-JAG');
      break;
    case 'prompt-injection':
      require(sameRoute(feature.route, expected.route), 'UC-LEARN11 did not open the declared LLM Gateway route');
      require(feature.selectedAttack === expected.attackId, 'UC-LEARN11 did not select the prompt-injection attack');
      require(feature.prefilledPayload === expected.payload, 'UC-LEARN11 did not prefill the source-declared prompt');
      require(feature.submission?.code === expected.denialCode && feature.submission?.denied === true, 'UC-LEARN11 did not submit and observe the declared denial');
      require(feature.submission?.reachedProvider === expected.providerReached, 'UC-LEARN11 provider reachability does not match the declared denial');
      break;
    default:
      require(false, 'feature family has no structured readiness validator');
  }
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
  // A public-catalog tool (catalog `enforcement`, from the use case's declared
  // evidence) is served with no user token, exchange or Authorize call. Its
  // contract is that the tool ran on that public path and nothing else was
  // claimed — not the delegated-call contract below.
  if (authorization?.enforcement === 'public-catalog') {
    require(evidence.selectedTool === authorization.primaryTool, 'selected tool does not match catalog contract');
    require(evidence.publicCatalog === true, 'public-catalog tool must be served on the public path, with token exchange and Authorize skipped');
    require(evidence.gateway?.applicable === false, 'public-catalog tool must declare Gateway evidence not applicable');
    require(evidence.authorize?.applicable === false, 'public-catalog tool must declare Authorize evidence not applicable');
    return failures;
  }
  const gatewayPolicy = authorization?.enforcement === 'gateway-policy';
  require(evidence.userSessionProvider === provider, 'user-session provider is missing or does not match provider lane');
  const expectedAgentProvider = caseRow.agentIdentityProviderByProvider?.[provider] || provider;
  require(evidence.agentIdentityProvider === expectedAgentProvider, 'agent identity provider does not match static provider-role contract');
  require(evidence.tokenIssuer === provider, 'token issuer is missing or does not match provider lane');
  require(typeof evidence.subject === 'string' && evidence.subject, 'subject is missing');
  require(Array.isArray(evidence.actorChain) && evidence.actorChain.length > 0, 'actor chain is missing');
  if (caseRow.id === 'UC38' || caseRow.id === 'UC44') require(Array.isArray(evidence.actorChain) && evidence.actorChain.length >= 2, 'actor-bound standard exchange requires the retained user and agent chain');
  require(evidence.exchangeService === (caseRow.exchangeService || 'token-exchange'), 'exchange service does not match static contract');
  require(typeof evidence.exchangeProvenance === 'string' && evidence.exchangeProvenance === caseRow.providerFlows?.[provider], 'exchange provenance does not match provider flow');
  // Compared by value: evidence from a real worker arrives over HTTP, so an
  // object-shaped resource server is never the same reference as the contract's.
  if (authorization?.resourceServer) require(evidence.resourceServer != null && sameObject({ value: evidence.resourceServer }, { value: authorization.resourceServer }), 'resource server does not match catalog contract');
  else require(typeof evidence.resourceServer === 'string' && evidence.resourceServer, 'resource server is missing');
  require(evidence.roleApplicability && typeof evidence.roleApplicability === 'object' && !Array.isArray(evidence.roleApplicability), 'role applicability is missing');
  if (authorization?.authorizeToolGroup?.role) require(evidence.roleApplicability?.authorizeRole === authorization.authorizeToolGroup.role, 'role applicability does not match Authorize role contract');
  require(evidence.exchangePath === expectedExchangePath(caseRow, provider), 'exchange path does not match case/provider contract');
  if (provider === 'pingfederate' && (caseRow.exchangeService || 'token-exchange') === 'token-exchange') {
    const exchange = evidence.pfExchange || {};
    const pfContract = caseRow.pfExchangeContract;
    const sourceGap = pfSourceGap(pfContract);
    require(!sourceGap, 'PF exact exchange contract is blocked: ' + (sourceGap?.reason || 'missing issuer, endpoint, or credential-role source'));
    require(pfReadyContract(pfContract), 'PF row has no exact endpoint and credential-role contract');
    require(exchange.issuer === pfContract?.issuer && exchange.endpoint === pfContract?.endpoint, 'PF endpoint or issuer does not match the declared token contract');
    require(pfEndpointShapeMatches(exchange.issuer, exchange.endpoint), 'PF endpoint and issuer must use HTTPS on one authority with a configured token path');
    const expectedRoles = pfContract?.credentialRoles?.map((role) => role.roleId).filter(Boolean);
    const observedRoles = exchange.credentialRoles || (exchange.credentialRole ? [exchange.credentialRole] : []);
    require(expectedRoles?.length
      ? exactValues(observedRoles, expectedRoles)
      : exchange.credentialRole === pfContract?.credentialRole,
    'PF exchanger credential role does not match the declared PF-only role');
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
    // Each required scope must be seen on the audience of the resource that
    // owns it, or on one that scope-topology.json declares as its mirror, and
    // no other audience may be reported.
    const observedAudiences = (Array.isArray(evidence.audiences) ? evidence.audiences : []).map(String);
    // An A2A run is judged on the specialist's scope and where it was minted.
    const a2aRun = Boolean(authorization.a2aScopeResources) && String(evidence.exchangePath || '').startsWith('a2a-');
    const scopeResources = a2aRun ? authorization.a2aScopeResources : authorization.scopeResources;
    const requiredScopes = a2aRun ? authorization.a2aScopeResources.map((item) => item.scope) : authorization.requiredScopes;
    const allowedAudiences = (scopeResources || []).map((item) => [item.audience, ...(item.mirrorAudiences || [])].filter(Boolean));
    require(observedAudiences.length > 0
      && allowedAudiences.every((allowed) => allowed.some((audience) => observedAudiences.includes(audience)))
      && observedAudiences.every((audience) => allowedAudiences.some((allowed) => allowed.includes(audience))), 'audience set does not match catalog contract');
    require(exactValues(evidence.scopes, requiredScopes), 'scope set does not match catalog contract');
    // The token sent to the gateway must be for the gateway resource and carry
    // only its inbound scope. An A2A run goes to the A2A gateway instead and is
    // judged above.
    if (!a2aRun && authorization.gatewayHop) {
      require(exactValues(evidence.gatewayHop?.audiences, [authorization.gatewayHop.audience])
        && exactValues(evidence.gatewayHop?.scopes, authorization.gatewayHop.scopes), 'gateway token audience or scope does not match the gateway resource');
    }
    // A permitted call to the main MCP server is made with a token the gateway
    // exchanged for that server's audience; the gateway reports that exchange.
    if (!a2aRun && !gatewayPolicy && authorization.backendHop && expected === 'PERMIT') {
      require(evidence.backendHop?.audience === authorization.backendHop.audience, 'gateway did not report an exchange for the MCP server audience');
    }
    require(Boolean(evidence.gateway?.route && evidence.gateway?.verdict), 'Gateway evidence is required for an exchanged tool call');
    // A gateway-policy tool is decided by the gateway's own filter; PingOne
    // Authorize is not called, so a reported Authorize decision would be wrong.
    if (gatewayPolicy) require(evidence.authorize?.applicable === false, 'gateway-policy tool must declare Authorize evidence not applicable');
    else require(Boolean(evidence.authorize?.reference && evidence.authorize?.decision), 'Authorize evidence is required for an exchanged tool call');
    if (['PERMIT', 'DENY', 'STEP_UP', 'HITL_REQUIRED'].includes(expected)) {
      require(evidence.gateway?.verdict === expected, 'Gateway verdict does not match declared outcome');
      if (!gatewayPolicy) require(evidence.authorize?.decision === expected, 'Authorize decision does not match declared outcome');
    }
  } else {
    require(evidence.gateway?.applicable === false, 'non-exchange case must declare Gateway evidence not applicable');
    require(evidence.authorize?.applicable === false, 'non-exchange case must declare Authorize evidence not applicable');
  }
  return failures;
}

/**
 * Expected against observed audience and scopes for each hop of one run, for
 * the report. Read-only: evidenceFailures decides pass or fail.
 */
function audienceScopeSummary({ evidence = {}, authorization }) {
  if (!authorization?.primaryTool || evidence.publicCatalog) return [];
  const a2aRun = Boolean(authorization.a2aScopeResources) && String(evidence.exchangePath || '').startsWith('a2a-');
  const scopeResources = (a2aRun ? authorization.a2aScopeResources : authorization.scopeResources) || [];
  const hops = [{
    hop: a2aRun ? 'specialist exchange' : 'tool scope',
    expectedAudiences: [...new Set(scopeResources.flatMap((item) => [item.audience, ...(item.mirrorAudiences || [])].filter(Boolean)))],
    expectedScopes: a2aRun ? scopeResources.map((item) => item.scope) : authorization.requiredScopes || [],
    observedAudiences: evidence.audiences || [],
    observedScopes: evidence.scopes || [],
  }];
  if (!a2aRun && authorization.gatewayHop) hops.push({
    hop: 'gateway token',
    expectedAudiences: [authorization.gatewayHop.audience],
    expectedScopes: authorization.gatewayHop.scopes,
    observedAudiences: evidence.gatewayHop?.audiences || [],
    observedScopes: evidence.gatewayHop?.scopes || [],
  });
  if (!a2aRun && authorization.backendHop) hops.push({
    hop: 'gateway to MCP server',
    expectedAudiences: [authorization.backendHop.audience],
    expectedScopes: null,
    observedAudiences: evidence.backendHop?.audience ? [evidence.backendHop.audience] : [],
    observedScopes: evidence.backendHop?.scopes || [],
  });
  return hops;
}

function featureContract(check, provider) {
  const contract = check.executionContract || featureCheckSource.contracts?.[check.id];
  if (!contract || !contract.providerFlows?.[provider] || !contract.exchangeService || !contract.resourceServer || !Array.isArray(contract.audiences) || !Array.isArray(contract.requiredScopes) || !Array.isArray(contract.behaviorStages) || !contract.featureFamily || !contract.familyContract || !FEATURE_DISPATCHERS[contract.featureFamily] || !Object.hasOwn(contract, 'selectedTool') || !Object.hasOwn(contract, 'expectedDecision')) return null;
  const pfExchangeContract = provider === 'pingfederate' && contract.exchangeService === 'token-exchange'
    ? contract.pfExchangeContract || {
      status: 'blocked',
      sourceGap: {
        code: 'pf_exact_exchange_contract_missing',
        reason: 'The feature manifest has no checked-in PingFederate issuer, endpoint, and credential-role contract.',
        remediation: 'Add a committed PF provisioner or supported Admin API readback before enabling this feature lane.',
      },
    }
    : contract.pfExchangeContract;
  const exchangeBacked = Boolean(contract.selectedTool);
  return {
    id: check.executionMode === 'pf-native-id-jag-negative' ? 'UC40' : ['a2a-passenger-negative', 'a2a-wire-happy'].includes(check.executionMode) ? 'UC2' : check.id,
    providerFlows: { [provider]: contract.providerFlows[provider] },
    agentIdentityProviderByProvider: check.agentIdentityProviderByProvider || { [provider]: provider },
    exchangeService: contract.exchangeService,
    pfExchangeContract,
    sourceGap: featureSourceGap({ ...contract, pfExchangeContract }, provider),
    providerRoleApplicability: check.providerRoleApplicability || {},
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

function createReadinessExecutionService({ createWorker: testWorkerAdapter, productionWorkerAdapter, catalog = buildDemoReadinessCatalog(), featureChecks = featureCheckSource.checks || [], now = () => Date.now(), inventorySink: configuredInventorySink = defaultInventorySink } = {}) {
  // Only server construction can inject the production worker factory. Request
  // data cannot enable or replace it in a running BFF.
  const workerAdapter = process.env.NODE_ENV === 'test'
    ? (testWorkerAdapter || productionWorkerAdapter)
    : (productionWorkerAdapter || null);
  const isProductionWorkerAdapter = Boolean(productionWorkerAdapter && workerAdapter === productionWorkerAdapter);
  const contexts = new WeakMap(); const identities = new Map(); const activeContexts = new Map(); const pendingSetups = new Map();
  async function createWorkerContextImpl({ targetId, provider, identityRef, deadlineAt, abortSignal }) {
    if (!targetId || !PROVIDERS.has(provider)) throw providerIsolationError('target and supported provider are required');
    if (abortSignal?.aborted || expired(deadlineAt, now())) throw new Error('deadline exceeded before provider worker creation');
    if (typeof workerAdapter !== 'function') throw providerIsolationError('no private separate provider-configured worker runtime is available');
    let worker;
    try {
      worker = await workerAdapter({ targetId, provider, identityRef, deadlineAt, abortSignal });
      validateWorker(worker, provider, identities, laneKey(targetId, provider));
      if (isProductionWorkerAdapter && typeof worker.dispose !== 'function') throw providerIsolationError('production worker has no context cleanup adapter');
      if (abortSignal?.aborted || expired(deadlineAt, now())) throw new Error('deadline exceeded while creating provider worker');
      const context = Object.freeze({});
      const saved = { worker, targetId, provider, disposed: false };
      contexts.set(context, saved);
      activeContexts.set(context, saved);
      return context;
    } catch (error) {
      // A remote context can exist even when its handshake or final deadline
      // check fails. Close it before returning the setup error.
      if (isProductionWorkerAdapter && typeof worker?.dispose === 'function') {
        try { await worker.dispose(); } catch { /* setup failure remains blocking */ }
      }
      throw error;
    }
  }
  function createWorkerContext(options) {
    const pending = createWorkerContextImpl(options);
    const lane = { targetId: options?.targetId, provider: options?.provider };
    pendingSetups.set(pending, lane);
    pending.then(() => pendingSetups.delete(pending), () => pendingSetups.delete(pending));
    return pending;
  }
  async function executeReadinessCase({ context, caseRow, vertical, mode, deadlineAt, behavior: override, abortSignal }) {
    if (expired(deadlineAt, now())) return redactReadinessValue({ status: 'not-run', expected: null, observed: 'deadline-expired', evidence: { reason: 'deadline exceeded before dispatch' } });
    const saved = contexts.get(context); const behavior = override || caseRow?.expectedBehaviorByVertical?.[vertical]; const authorization = caseRow?.authorizationContractByVertical?.[vertical]; const prerequisites = caseRow?.runtimePrerequisitesByVertical?.[vertical]; const expected = outcomeFor(behavior);
    if (!saved || saved.disposed) return redactReadinessValue({ status: 'blocked', expected, observed: 'not-dispatched', evidence: { reason: 'unknown, forged, or closed readiness worker context' } });
    if (!behavior || !authorization || !prerequisites) return redactReadinessValue({ status: 'blocked', expected, observed: 'not-dispatched', evidence: { reason: 'catalog has no complete contract for vertical ' + vertical } });
    const sourceGap = saved.provider === 'pingfederate' && (caseRow.exchangeService || 'token-exchange') === 'token-exchange'
      ? pfSourceGap(caseRow.pfExchangeContract)
      : null;
    if (sourceGap) return redactReadinessValue({
      status: 'blocked', expected, observed: 'not-dispatched',
      evidence: { reason: 'PingFederate exact exchange contract is blocked: ' + sourceGap.reason, sourceGap },
    });
    const prerequisite = typeof saved.worker.verifyPrerequisites === 'function' ? await saved.worker.verifyPrerequisites({ caseRow, vertical, prerequisites, deadlineAt }) : { status: 'blocked', reason: 'worker cannot verify runtime prerequisites' };
    if (prerequisite?.status !== 'pass') return redactReadinessValue({ status: 'blocked', expected, observed: 'not-dispatched', evidence: { reason: prerequisite?.reason || 'runtime prerequisites unavailable', prerequisites } });
    if (expired(deadlineAt, now())) return redactReadinessValue({ status: 'not-run', expected, observed: 'deadline-expired', evidence: { reason: 'deadline exceeded before dispatch' } });
    try { const execution = await saved.worker.executeReadinessCase({ context, caseRow, vertical, mode, behavior, authorization, deadlineAt, abortSignal }); const evidence = execution?.evidence || {}; const observed = execution?.observed || 'UNKNOWN'; const failures = [...(observed === expected ? [] : ['observed outcome does not match declared outcome']), ...evidenceFailures({ evidence, provider: saved.provider, authorization, expected, caseRow })]; if (failures.length) evidence.contractFailures = failures; evidence.audienceScope = audienceScopeSummary({ evidence, authorization }); return redactReadinessValue({ status: failures.length ? 'fail' : 'pass', expected, observed, evidence }); } catch (error) { return redactReadinessValue({ status: 'fail', expected, observed: 'execution-error', evidence: { reason: error?.message || 'worker execution failed' } }); }
  }
  async function executeReadinessFeature({ context, check, deadlineAt, abortSignal }) {
    const saved = contexts.get(context); const expected = check.expectedByProvider?.[saved?.provider] || check.expectedOutcome;
    if (!saved || saved.disposed || !expected) return redactReadinessValue({ status: 'blocked', expected: expected || null, observed: 'not-dispatched', evidence: { reason: 'feature contract or worker context is unavailable' } });
    const staticCase = featureContract(check, saved.provider);
    if (!staticCase) return redactReadinessValue({ status: 'blocked', expected, observed: 'not-dispatched', evidence: { reason: 'feature manifest has no complete family-specific execution contract' } });
    if (staticCase.sourceGap) return redactReadinessValue({
      status: 'blocked', expected, observed: 'not-dispatched',
      evidence: { reason: 'feature source contract is blocked: ' + staticCase.sourceGap.reason, sourceGap: staticCase.sourceGap },
    });
    const workerMethod = FEATURE_DISPATCHERS[staticCase.contract.featureFamily];
    if (typeof saved.worker[workerMethod] !== 'function') return redactReadinessValue({ status: 'blocked', expected, observed: 'not-dispatched', evidence: { reason: 'worker has no ' + staticCase.contract.featureFamily + ' feature adapter' } });
    if (expired(deadlineAt, now())) return redactReadinessValue({ status: 'not-run', expected, observed: 'deadline-expired', evidence: { reason: 'deadline exceeded before feature dispatch' } });
    const configurationDependencies = check.configurationDependencies || [];
    const prerequisite = typeof saved.worker.verifyFeaturePrerequisites === 'function'
      ? await saved.worker.verifyFeaturePrerequisites({ context, check, configurationDependencies, deadlineAt })
      : { status: 'blocked', reason: 'worker cannot verify feature configuration dependencies' };
    if (prerequisite?.status !== 'pass' || !exactValues(prerequisite?.verifiedDependencies, configurationDependencies)) {
      return redactReadinessValue({ status: 'blocked', expected, observed: 'not-dispatched', evidence: { reason: prerequisite?.reason || 'feature configuration dependencies are unavailable', configurationDependencies } });
    }
    try {
      const execution = await saved.worker[workerMethod]({ context, check, contract: staticCase.contract, deadlineAt, abortSignal }); const evidence = execution?.evidence || {}; const observed = execution?.observed || '';
      const authorization = staticCase.authorizationContractByVertical.feature;
      const failures = [...(observed === expected ? [] : ['observed outcome does not match declared feature outcome']), ...evidenceFailures({ evidence, provider: saved.provider, authorization, expected: authorization.expectedDecision, caseRow: staticCase })];
      requireFeatureEvidence(failures, evidence, check, saved.provider);
      validateFeatureFamilyEvidence(failures, evidence, staticCase.contract, saved.provider);
      if (failures.length) evidence.contractFailures = failures;
      return redactReadinessValue({ status: failures.length ? 'fail' : 'pass', expected, observed, evidence });
    } catch (error) { return redactReadinessValue({ status: 'fail', expected, observed: 'execution-error', evidence: { reason: error?.message || 'feature probe failed' } }); }
  }
  function sourceGapForRow(row) {
    if (row.check) return featureContract(row.check, row.provider)?.sourceGap || null;
    if (row.provider === 'pingfederate' && (row.caseRow?.exchangeService || 'token-exchange') === 'token-exchange') {
      return pfSourceGap(row.caseRow?.pfExchangeContract);
    }
    return null;
  }
  function staticRow(row, status, reason, sourceGap) {
    return redactReadinessValue({
      status,
      expected: row.check ? (row.check.expectedByProvider?.[row.provider] || row.check.expectedOutcome) : outcomeFor(row.behavior),
      observed: status === 'not-run' ? 'deadline-expired' : 'not-dispatched',
      evidence: { reason, provider: row.provider, target: row.targetId, ...(sourceGap ? { sourceGap } : {}) },
    });
  }
  function declaredProviderApplicability(row) {
    return row.check?.providerRoleApplicability
      || row.caseRow?.providerRoleApplicability
      || { userSession: 'provider-bound', agentIdentity: 'provider-bound', tokenIssuer: 'provider-bound' };
  }
  async function runManifest({ targets = ['local', 'hosted'], identityRefFor, deadlineAt, startedAt = now(), commit, report: suppliedReport, onProgress, inventorySink } = {}) {
    const manifest = deriveExecutionManifest({ catalog, featureChecks, targets });
    const hardDeadlineAt = deadlineAt || startedAt + HARD_DEADLINE_MS;
    const report = suppliedReport || createReadinessReport({ runId: crypto.randomUUID(), commit, targets, startedAt, deadlineAt: hardDeadlineAt });
    report.categoryCounts = manifest.counts;
    const sink = inventorySink || configuredInventorySink || defaultInventorySink;
    // Emit synchronously before allocating the row array or constructing any
    // provider worker. This makes the complete workload observable even when
    // setup hangs at the hard deadline.
    sink({ phase: 'inventory', categoryCounts: manifest.counts, total: manifest.counts.total, targets });
    onProgress?.({ index: 0, total: manifest.counts.total, categoryCounts: manifest.counts, phase: 'inventory' });
    const rows = [...manifest.core, ...manifest.variants, ...manifest.feature, ...manifest.attackLab];
    const lanes = new Map(); const results = [];
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]; let result; const key = laneKey(row.targetId, row.provider); let lane = lanes.get(key); const rowSourceGap = sourceGapForRow(row);
      if (expired(hardDeadlineAt, now())) result = staticRow(row, 'not-run', 'deadline exceeded before row dispatch');
      else if (rowSourceGap) {
        result = staticRow(row, 'blocked', 'source contract is blocked: ' + rowSourceGap.reason, rowSourceGap);
      }
      else if (lane?.blocked) result = staticRow(row, lane.timedOut ? 'not-run' : 'blocked', lane.reason);
      else try {
        if (!lane) {
          const setupController = new AbortController();
          const setup = createWorkerContext({
            targetId: row.targetId,
            provider: row.provider,
            identityRef: identityRefFor?.(row),
            deadlineAt: hardDeadlineAt,
            abortSignal: setupController.signal,
          });
          const setupRace = await raceDeadline(setup, hardDeadlineAt, now, setupController);
          if (setupRace.timedOut) {
            lane = { blocked: true, timedOut: true, reason: 'deadline exceeded during provider worker setup' };
            lanes.set(key, lane);
            result = staticRow(row, 'not-run', lane.reason);
          } else if (setupRace.error) {
            throw setupRace.error;
          } else {
            lane = { context: setupRace.value, blocked: false };
            lanes.set(key, lane);
          }
        }
        if (!result) {
          const controller = new AbortController();
          const task = row.check
            ? executeReadinessFeature({ context: lane.context, check: row.check, deadlineAt: hardDeadlineAt, abortSignal: controller.signal })
            : executeReadinessCase({ context: lane.context, caseRow: row.caseRow, vertical: row.vertical, mode: row.caseRow.executionMode, behavior: row.behavior, deadlineAt: hardDeadlineAt, abortSignal: controller.signal });
          const raced = await raceDeadline(task, hardDeadlineAt, now, controller);
          if (raced.timedOut) result = staticRow(row, 'not-run', 'deadline exceeded during row dispatch');
          else if (raced.error) throw raced.error;
          else result = raced.value;
        }
      } catch (error) {
        lane = { blocked: true, reason: error?.message || 'provider worker setup failed' };
        lanes.set(key, lane);
        result = staticRow(row, 'blocked', lane.reason);
      }
      result = redactReadinessValue(result); results.push(result);
      recordCheck(report, {
        id: [row.kind, row.caseRow?.id || row.check?.id, row.targetId, row.provider, row.behavior?.variant || row.vertical || index].filter(Boolean).join(':'),
        target: row.targetId,
        useCaseId: row.caseRow?.id || row.check?.id,
        userSessionProvider: result.evidence?.userSessionProvider,
        agentIdentityProvider: result.evidence?.agentIdentityProvider,
        tokenIssuer: result.evidence?.tokenIssuer,
        exchangeService: result.evidence?.exchangeService,
        resourceServer: result.evidence?.resourceServer,
        // Applicability is declared by the checked-in row. A worker's observed
        // map remains only in sanitized evidence and can never rewrite a report.
        providerApplicability: declaredProviderApplicability(row),
        status: result.status,
        expected: result.expected,
        observed: result.observed,
        sourceRef: row.caseRow?.sourceRef || row.check?.sourceRef,
        evidence: result.evidence,
      });
      onProgress?.({ index: index + 1, total: rows.length, categoryCounts: manifest.counts, row, result });
    }
    const elapsedMs = Math.max(0, now() - startedAt); const timing = { elapsedMs, targetMs: TARGET_WARNING_MS, hardLimitMs: HARD_DEADLINE_MS, targetMet: elapsedMs < TARGET_WARNING_MS && results.every((result) => result.status !== 'not-run'), deadlineExceeded: elapsedMs >= HARD_DEADLINE_MS || results.some((result) => result.status === 'not-run') }; report.elapsedMs = elapsedMs; report.targetWarning = elapsedMs >= TARGET_WARNING_MS; if (timing.deadlineExceeded) { report.status = 'deadline_exceeded'; report.ready = false; } else if (!timing.targetMet) { report.status = 'not-ready'; report.ready = false; }
    return { manifest, categoryCounts: manifest.counts, results, report, timing };
  }
  async function dispose() {
    const failures = [];
    if (pendingSetups.size) {
      const pending = [...pendingSetups.keys()];
      let timer;
      const timedOut = await Promise.race([
        Promise.allSettled(pending).then(() => false),
        new Promise((resolve) => { timer = setTimeout(() => resolve(true), 5_000); }),
      ]);
      if (timer) clearTimeout(timer);
      if (timedOut) {
        failures.push(...pendingSetups.values());
      }
    }
    const cleanupResults = await Promise.all([...activeContexts].map(async ([context, saved]) => {
      try {
        if (typeof saved.worker.dispose === 'function') await saved.worker.dispose({ context });
        saved.disposed = true;
        activeContexts.delete(context);
        return null;
      } catch {
        return { targetId: saved.targetId, provider: saved.provider };
      }
    }));
    failures.push(...cleanupResults.filter(Boolean));
    return { status: failures.length ? 'fail' : 'pass', failures };
  }

  return { createWorkerContext, executeReadinessCase, executeReadinessFeature, runManifest, dispose, deriveExecutionManifest: (options) => deriveExecutionManifest({ catalog, featureChecks, ...options }) };
}

function requireFeatureEvidence(failures, evidence, check, provider) {
  const require = (condition, message) => { if (!condition) failures.push(message); };
  const contract = check.executionContract || featureCheckSource.contracts?.[check.id];
  const supplied = evidence.requiredEvidence || [];
  require(Array.isArray(check.requiredEvidence) && exactValues(supplied, check.requiredEvidence), 'required feature evidence does not match static contract');
  if (!sameObject(evidence.providerRoleApplicability, check.providerRoleApplicability)) {
    // Preserve an observed disagreement as evidence, while the report always
    // serializes the checked-in row contract in runManifest.
    evidence.observedProviderRoleApplicability = evidence.providerRoleApplicability || {};
    require(false, 'feature provider-role applicability does not match static contract');
  }
  require(evidence.userSessionProvider === provider && evidence.agentIdentityProvider === (check.agentIdentityProviderByProvider?.[provider] || provider), 'feature observed provider roles do not match static contract');
  require(Array.isArray(evidence.behaviorStages) && JSON.stringify(evidence.behaviorStages) === JSON.stringify(contract?.behaviorStages), 'feature behavior stages do not match static execution contract');
}

module.exports = { audienceScopeSummary, createReadinessExecutionService, deriveExecutionManifest, evidenceFailures, expectedExchangePath, FEATURE_DISPATCHERS, validateFeatureFamilyEvidence };
