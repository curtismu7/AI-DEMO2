'use strict';

const fs = require('node:fs');
const path = require('node:path');
const inventory = require('../config/demoReadinessInventory.json');
const repairability = require('../config/demoReadinessRepairability.json');
const featureChecks = require('../config/demoReadinessFeatureChecks.json');
const pingFederateProfiles = require('../config/demoReadinessPingFederateProfiles.json');
const { USE_CASES, VERTICALS, resolveUseCase } = require('../config/useCases');
const { ADMIN_DEMO_STEPS } = require('../config/admin/demoSteps');
const authRequirements = require('../config/auth-requirements.json');
const { resolveRepositoryRoot } = require('../utils/repositoryRoot');
const repositoryRoot = resolveRepositoryRoot(__dirname);
const {
  requiredFlagsForUseCase,
  needsA2aCredentials,
  needsParConfig,
} = require('./demoStepPrerequisites');

function loadDemoReadinessSources({ repositoryRoot: sourceRoot = repositoryRoot } = {}) {
  const scopeTopology = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'scope-topology.json'), 'utf8'));
  const gatewayScopeTopology = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'ping-gateway/config/scope-topology.json'), 'utf8'));
  const verticalManifests = Object.fromEntries(VERTICALS.map((vertical) => [
    vertical,
    require(`../config/verticals/${vertical}/manifest.json`),
  ]));
  return {
    inventory,
    repairability,
    featureChecks,
    pingFederateProfiles,
    useCases: USE_CASES,
    adminSteps: ADMIN_DEMO_STEPS,
    authRequirements,
    verticals: VERTICALS,
    scopeTopology,
    gatewayScopeTopology,
    verticalManifests,
  };
}

function pushIssue(issues, message) {
  issues.push(message);
}

function hasSourceBackedCredentialRoles(contract) {
  return Array.isArray(contract?.credentialRoles)
    && contract.credentialRoles.length > 0
    && contract.credentialRoles.every((role) => typeof role?.roleId === 'string' && role.roleId
      && typeof role?.sourceRef === 'string' && role.sourceRef
      && Array.isArray(role.configurationKeys));
}

function hasActionablePfSourceGap(contract) {
  return contract?.status === 'blocked'
    && typeof contract.sourceGap?.code === 'string' && contract.sourceGap.code
    && typeof contract.sourceGap?.reason === 'string' && contract.sourceGap.reason
    && typeof contract.sourceGap?.remediation === 'string' && contract.sourceGap.remediation
    && hasSourceBackedCredentialRoles(contract);
}

function hasExactPfFeatureContract(contract, exchangeBacked) {
  if (hasActionablePfSourceGap(contract)) {
    return !exchangeBacked || Boolean(
      contract.issuer?.configurationKey && contract.issuer?.sourceRef
      && contract.endpoint?.configurationKey && contract.endpoint?.sourceRef,
    );
  }
  if (contract?.status !== 'ready' || !hasSourceBackedCredentialRoles(contract)) return false;
  if (!exchangeBacked) return true;
  return typeof contract.issuer === 'string' && Boolean(contract.issuerSourceRef)
    && typeof contract.endpoint === 'string' && Boolean(contract.endpointSourceRef);
}

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

function routePath(path) {
  const pathname = String(path || '').split(/[?#]/, 1)[0];
  return pathname.replace(/\/$/, '') || '/';
}

function routeSearchParams(path) {
  const query = String(path || '').split('?', 2)[1]?.split('#', 1)[0] || '';
  return Object.fromEntries(new URLSearchParams(query).entries());
}

function routeHash(path) {
  return String(path || '').split('#', 2)[1] || '';
}

function executionModeFor(id, trigger, isAdmin) {
  if (isAdmin) return 'admin-mcp';
  if (id === 'UC40') return 'live-id-jag';
  if (id === 'UC2.5') return 'a2a';
  if (id === 'UC14b') return 'intent-binding-quick';
  if (id === 'UC38' || id === 'UC44') return 'agent-chip';
  if (trigger?.type === 'chip') return 'agent-chip';
  if (trigger?.type === 'attack') return 'attack-sim';
  if (trigger?.type === 'link') return 'page';
  if (trigger?.type === 'edu') return 'education-panel';
  return null;
}

function providerFlowFor(id, isAdmin, provider) {
  if (isAdmin) return provider === 'pingone' ? 'pingone-admin-mcp' : 'pingfederate-admin-mcp';
  if (id === 'UC40' && provider === 'pingone') return null;
  if (provider === 'pingone') return ['UC2', 'UC2.5'].includes(id) ? 'pingone-a2a' : 'pingone-standard';
  if (id === 'UC40') return 'pingfederate-native-id-jag';
  if (['UC2', 'UC2.5'].includes(id)) return 'pingfederate-a2a';
  if (['UC38', 'UC44'].includes(id)) return 'pingfederate-workload';
  return 'pingfederate-standard';
}

function pfCredentialRoleIdsFor(id, flowId) {
  if (flowId === 'pingfederate-native-id-jag') return ['uc40-native-id-jag'];
  if (flowId === 'pingfederate-a2a') return ['standard-agent-exchanger', 'ai-agent-actor', 'a2a-specialist'];
  if (flowId === 'pingfederate-workload') {
    return ['standard-agent-exchanger', 'standard-mcp-exchanger', 'ai-agent-actor', 'mcp-service-actor'];
  }
  if (flowId === 'pingfederate-admin-mcp') return ['standard-agent-exchanger', 'standard-mcp-exchanger'];
  return ['standard-agent-exchanger', 'standard-mcp-exchanger', 'ai-agent-actor', 'mcp-service-actor'];
}

/**
 * The BFF's ordinary PF issuer and endpoint are intentionally runtime-configured
 * (`pf_issuer` and `pf_token_endpoint`), while the checked-in profile currently
 * has no committed PF Admin API readback. Keep the source/key/role mapping on
 * every PF row, and make the missing literal contract an explicit blocker rather
 * than letting a worker invent endpoint or credential values.
 */
function pfExchangeContractFor({ id, flowId, profiles = pingFederateProfiles }) {
  const roleIds = pfCredentialRoleIdsFor(id, flowId);
  const roles = profiles?.roles || {};
  const credentialRoles = roleIds.map((roleId) => ({
    roleId,
    objectId: roles[roleId]?.objectId || null,
    sourceRef: roles[roleId]?.sourceRef || null,
    configurationKeys: roles[roleId]?.configurationKeys || [],
    unresolved: roles[roleId]?.unresolved !== false,
  }));
  const unresolved = credentialRoles.filter((role) => role.unresolved || !role.objectId);
  const sourceGap = unresolved.length
    ? {
      code: 'pf_exact_exchange_contract_source_gap',
      reason: 'A committed PingFederate provisioner or supported PF Admin API readback must record the literal PF issuer, token endpoint, and registered credential roles before this lane can run.',
      missingRoleIds: unresolved.map((role) => role.roleId),
      remediation: 'Record the readback in demoReadinessPingFederateProfiles.json, including the resolved issuer, endpoint, and role registration, then mark the role resolved.',
    }
    : null;
  return {
    status: sourceGap ? 'blocked' : 'ready',
    issuer: { configurationKey: 'pf_issuer', sourceRef: 'demo_api_server/services/oauthEndpointResolver.js#issuer' },
    endpoint: { configurationKey: 'pf_token_endpoint', sourceRef: 'demo_api_server/services/pfStandardTokenExchangeService.js#resolveConfig' },
    credentialRoles,
    sourceGap,
  };
}

function providerRoleApplicabilityFor({ id, providerFlows }) {
  return {
    userSession: id === 'UC40' ? 'pingfederate-required' : 'provider-bound',
    agentIdentity: 'provider-bound',
    tokenIssuer: 'provider-bound',
    exchangeService: 'provider-flow-bound',
    resourceServer: 'vertical-contract-bound',
    pingone: providerFlows.pingone ? 'applicable' : 'not-applicable',
    pingfederate: providerFlows.pingfederate ? 'applicable' : 'not-applicable',
  };
}

/**
 * Which control decides a tool step, read from the use case's own declared
 * evidence (`config/useCases.js` evidence.tokenChain). Two narrow profiles are
 * recognised; everything else keeps the full exchange-plus-Authorize contract.
 *   public-catalog  the chain declares only `tool-dispatched`: the tool is
 *                   served without a user token, an exchange or Authorize.
 *   gateway-policy  the chain declares only `user-token` and `tool-dispatched`:
 *                   the token is exchanged and the gateway's own policy
 *                   decides; PingOne Authorize is not called.
 * The chain is a floor, not a full list (some Authorize-backed steps omit
 * `authorize-decision`), so a step is narrowed only on an exact match.
 */
function enforcementFor(step) {
  const chain = [...new Set(Array.isArray(step?.evidence?.tokenChain) ? step.evidence.tokenChain : [])].sort();
  if (chain.length === 1 && chain[0] === 'tool-dispatched') return 'public-catalog';
  if (chain.length === 2 && chain[0] === 'tool-dispatched' && chain[1] === 'user-token') return 'gateway-policy';
  return 'authorize';
}

function authorizationContractFor(step, sources, issues, useCaseId, vertical) {
  const toolName = step.primaryTool || null;
  const resourceServer = step.resourceServer || null;
  if (!toolName) {
    return {
      primaryTool: null,
      resourceServer,
      a2aDelegated: Boolean(step.a2aDelegated),
      gatewayTool: null,
      requiredScopes: [],
      scopeResources: [],
    };
  }

  const topology = sources.scopeTopology || {};
  const gatewayTopology = sources.gatewayScopeTopology || {};
  const manifest = sources.verticalManifests?.[vertical];
  if (!manifest) pushIssue(issues, `${useCaseId} ${vertical} has no vertical manifest for authorization checks`);
  const tool = topology.tools?.[toolName];
  const gatewayTool = gatewayTopology.tools?.[toolName];
  if (!tool) pushIssue(issues, `${useCaseId} ${vertical} tool ${toolName} is missing from scope-topology.json`);
  if (!gatewayTool) pushIssue(issues, `${useCaseId} ${vertical} tool ${toolName} is missing from Agent Gateway scope topology`);

  const requiredScopes = Array.isArray(tool?.requiredScopes) ? [...tool.requiredScopes] : [];
  if (tool && requiredScopes.length === 0) {
    pushIssue(issues, `${useCaseId} ${vertical} tool ${toolName} has no required scopes`);
  }
  const sorted = (values) => [...(Array.isArray(values) ? values : [])].sort();
  if (tool && gatewayTool
      && JSON.stringify(sorted(requiredScopes)) !== JSON.stringify(sorted(gatewayTool.requiredScopes))) {
    pushIssue(issues, `${useCaseId} ${vertical} tool ${toolName} has different required scopes in Agent Gateway topology`);
  }
  for (const field of ['a2aDelegated', 'a2aDelegatedScope', 'requiresAgentMediation', 'challengeType']) {
    if (tool && gatewayTool && JSON.stringify(tool[field]) !== JSON.stringify(gatewayTool[field])
        && (tool[field] !== undefined || gatewayTool[field] !== undefined)) {
      pushIssue(issues, `${useCaseId} ${vertical} tool ${toolName} has different ${field} metadata in Agent Gateway topology`);
    }
  }

  const scopeResources = requiredScopes.map((scope) => {
    const canonicalScope = topology.aliases?.[scope] || scope;
    const definition = topology.scopes?.[canonicalScope];
    const gatewayCanonicalScope = gatewayTopology.aliases?.[scope] || scope;
    const gatewayDefinition = gatewayTopology.scopes?.[gatewayCanonicalScope];
    if (!definition) {
      pushIssue(issues, `${useCaseId} ${vertical} tool ${toolName} requires undeclared scope ${scope}`);
    }
    if (!gatewayDefinition) {
      pushIssue(issues, `${useCaseId} ${vertical} tool ${toolName} requires undeclared scope ${scope} in Agent Gateway topology`);
    }

    const resourceName = definition?.resource || null;
    const resource = resourceName ? topology.resources?.[resourceName] : null;
    if (!resource || !resource.uri) {
      pushIssue(issues, `${useCaseId} ${vertical} scope ${scope} has no resource audience in scope-topology.json`);
    } else if (!Array.isArray(resource.scopes) || !resource.scopes.includes(canonicalScope)) {
      pushIssue(issues, `${useCaseId} ${vertical} resource ${resourceName} does not register scope ${canonicalScope}`);
    }
    const gatewayResourceName = gatewayDefinition?.resource || null;
    const gatewayResource = gatewayResourceName ? gatewayTopology.resources?.[gatewayResourceName] : null;
    if (!gatewayResource || !gatewayResource.uri) {
      pushIssue(issues, `${useCaseId} ${vertical} scope ${scope} has no resource audience in Agent Gateway topology`);
    } else if (!Array.isArray(gatewayResource.scopes) || !gatewayResource.scopes.includes(gatewayCanonicalScope)) {
      pushIssue(issues, `${useCaseId} ${vertical} Agent Gateway resource ${gatewayResourceName} does not register scope ${gatewayCanonicalScope}`);
    }

    if (definition && gatewayDefinition && canonicalScope !== gatewayCanonicalScope) {
      pushIssue(issues, `${useCaseId} ${vertical} scope ${scope} resolves to different canonical scopes in Agent Gateway topology`);
    }
    if (definition && gatewayDefinition && resourceName !== gatewayResourceName) {
      pushIssue(issues, `${useCaseId} ${vertical} scope ${scope} has different resource names in Agent Gateway topology`);
    }
    if (resource?.uri && gatewayResource?.uri && resource.uri !== gatewayResource.uri) {
      pushIssue(issues, `${useCaseId} ${vertical} scope ${scope} has different resource audience in Agent Gateway topology`);
    }
    return {
      scope,
      canonicalScope,
      resource: resourceName,
      audience: resource?.uri || null,
      // Resources that declare this scope as a mirror. PingOne mints a scope
      // the user's own token does not carry on one of these at the exchange.
      mirrorAudiences: Object.values(topology.resources || {})
        .filter((item) => item?.uri && Array.isArray(item.mirroredScopes) && item.mirroredScopes.includes(canonicalScope))
        .map((item) => item.uri),
    };
  });
  const restrictedRole = manifest?.groups?.restrictedTools?.[toolName] || null;
  const restrictedRoleConfig = restrictedRole ? manifest?.groups?.categories?.[restrictedRole] : null;
  if (restrictedRole && !restrictedRoleConfig?.name) {
    pushIssue(issues, `${useCaseId} ${vertical} tool ${toolName} references an undefined Authorize group ${restrictedRole}`);
  }

  return {
    primaryTool: toolName,
    resourceServer,
    enforcement: enforcementFor(step),
    a2aDelegated: Boolean(step.a2aDelegated),
    gatewayTool: tool ? {
      surface: tool.surface || null,
      requiredScopes,
      challengeType: tool.challengeType || null,
      requiresAgentMediation: Boolean(tool.requiresAgentMediation),
      a2aDelegated: Boolean(tool.a2aDelegated),
      a2aDelegatedScope: tool.a2aDelegatedScope || null,
    } : null,
    requiredScopes,
    scopeResources,
    authorizeToolGroup: restrictedRole ? {
      role: restrictedRole,
      groupName: restrictedRoleConfig?.name || null,
      userMemberships: manifest?.groups?.userMemberships || {},
    } : null,
  };
}

function groupRuntimeVerticalBehaviors(expectedByVertical, authorizationByVertical, prerequisitesByVertical, fallbackBehavior, fallbackAuthorization, fallbackPrerequisites, fallbackVerticals) {
  const entries = Object.entries(expectedByVertical);
  if (!entries.length) {
    return [{
      vertical: fallbackVerticals[0] || 'default',
      verticals: [...fallbackVerticals],
      expectedBehavior: fallbackBehavior,
      authorizationContract: fallbackAuthorization,
      runtimePrerequisites: fallbackPrerequisites,
    }];
  }

  const groups = new Map();
  for (const [vertical, expectedBehavior] of entries) {
    const authorizationContract = authorizationByVertical[vertical];
    const runtimePrerequisites = prerequisitesByVertical[vertical];
    const signature = JSON.stringify({ expectedBehavior, authorizationContract, runtimePrerequisites });
    const existing = groups.get(signature);
    if (existing) existing.verticals.push(vertical);
    else groups.set(signature, { vertical, verticals: [vertical], expectedBehavior, authorizationContract, runtimePrerequisites });
  }
  return [...groups.values()];
}

function expectedBehaviorFor({ id, step, isAdmin, expectation }) {
  const trigger = step.trigger || {};

  if (isAdmin) {
    return {
      kind: 'admin-mcp',
      expectedAction: expectation.expectedAction,
      expectedTool: expectation.expectedTool,
      expectedArguments: expectation.expectedArguments || {},
      expectedFilter: expectation.expectedFilter || null,
      queryInput: expectation.queryInput || null,
    };
  }

  if (id === 'UC40') {
    return { kind: 'id-jag', provider: 'pingfederate', expectedOutcome: step.expectedOutcome };
  }
  if (id === 'UC2.5') {
    return {
      kind: 'a2a',
      expectedOutcome: step.expectedOutcome,
      triggerText: trigger.text,
      route: ['/api/a2a/init', '/api/a2a/message'],
    };
  }
  if (id === 'UC14b') {
    return {
      kind: 'intent-binding-quick',
      expectedOutcome: step.expectedOutcome,
      endpoint: '/api/demo/intent-binding/run',
      action: 'permit',
      requestedAmount: 80,
    };
  }
  if (id === 'UC38' || id === 'UC44') {
    return {
      kind: 'agent-outcome',
      expectedOutcome: step.expectedOutcome,
      triggerText: step.runPrompt || trigger.label || trigger.text,
      adaptedFromLink: true,
      primaryTool: step.primaryTool || null,
    };
  }
  if (trigger.type === 'chip') {
    return {
      kind: 'agent-outcome',
      expectedOutcome: step.expectedOutcome,
      triggerText: trigger.text,
      primaryTool: step.primaryTool || null,
    };
  }
  if (trigger.type === 'attack') {
    return {
      kind: 'attack-outcome',
      expectedOutcome: step.expectedOutcome,
      sim: trigger.sim,
    };
  }
  if (trigger.type === 'link') {
    return {
      kind: 'page-load',
      path: trigger.path,
      pathname: routePath(trigger.path),
      searchParams: routeSearchParams(trigger.path),
      hash: routeHash(trigger.path),
    };
  }
  if (trigger.type === 'edu') {
    return {
      kind: 'education-panel',
      panel: trigger.panel,
      tab: trigger.tab || null,
    };
  }
  return null;
}

function validateDemoReadinessCatalog(sources, { uiInventory, educationPanelIds } = {}) {
  const issues = [];
  const inventoryConfig = sources?.inventory || {};
  const repairConfig = sources?.repairability || {};
  const useCases = Array.isArray(sources?.useCases) ? sources.useCases : [];
  const adminSteps = Array.isArray(sources?.adminSteps) ? sources.adminSteps : [];
  const auth = sources?.authRequirements || {};
  const providerFlowConfig = repairConfig.providerFlows || {};
  const featureCheckConfig = sources?.featureChecks || {};
  const verticals = Array.isArray(sources?.verticals) ? sources.verticals : [];
  const lanes = ['primary', 'advanced', 'ciam', 'privilege', 'admin'];

  const featureChecks = Array.isArray(featureCheckConfig.checks) ? featureCheckConfig.checks : [];
  const featureCheckIds = featureChecks.map((check) => check.id);
  const requiredA2aChecks = ['A2A-FM1', 'A2A-FM2', 'A2A-FM3'];
  if (featureCheckConfig.countsTowardDemoSteps !== false
      || requiredA2aChecks.some((id) => !featureCheckIds.includes(id))) {
    pushIssue(issues, 'The separate feature-check inventory must contain A2A FM1, FM2, and FM3 without changing the Demo Steps count');
  }
  if (new Set(featureCheckIds).size !== featureCheckIds.length) {
    pushIssue(issues, 'Provider feature-check IDs must be unique');
  }
  for (const check of featureChecks) {
    const hasSharedOutcome = typeof check.expectedOutcome === 'string' && check.expectedOutcome.length > 0;
    const hasProviderOutcomes = Array.isArray(check.providers) && check.providers.length > 0
      && check.providers.every((provider) => typeof check.expectedByProvider?.[provider] === 'string'
        && check.expectedByProvider[provider].length > 0);
    if (!check.id || !check.sourceRef || !check.testTitle || !check.executionMode
        || (!hasSharedOutcome && !hasProviderOutcomes)
        || !Array.isArray(check.providers) || check.providers.length === 0
        || !Array.isArray(check.configurationDependencies) || check.configurationDependencies.length === 0
        || check.sourceCodeChanges !== 'never') {
      pushIssue(issues, `${check.id || '(missing ID)'} feature check lacks its source, expected outcome, provider applicability, configuration dependencies, or sourceCodeChanges=never`);
    }
    for (const relatedTest of check.relatedTests || []) {
      if (!relatedTest.sourceRef || !relatedTest.testTitle) {
        pushIssue(issues, `${check.id} has an incomplete related test reference`);
      }
    }
    for (const dependency of check.configurationDependencies || []) {
      const drift = repairConfig.driftClasses?.[dependency];
      if (!drift || !['automatic', 'manual', 'release-only'].includes(drift.repairMode)) {
        pushIssue(issues, `${check.id} references unknown repairability drift class ${dependency}`);
      } else if (drift.repairMode === 'automatic' && (!drift.configurationOnly || !drift.operation || !drift.readback)) {
        pushIssue(issues, `${dependency} is automatic but lacks a config-only operation and readback`);
      }
    }
    const contract = featureCheckConfig.contracts?.[check.id];
    if (!contract || !contract.featureFamily || !contract.familyContract
        || !contract.providerFlows || !contract.exchangeService || !contract.resourceServer
        || !Array.isArray(contract.audiences) || !Array.isArray(contract.requiredScopes)
        || !Array.isArray(contract.behaviorStages) || !Object.hasOwn(contract, 'selectedTool')
        || !Object.hasOwn(contract, 'expectedDecision')) {
      pushIssue(issues, `${check.id} has no complete family-specific feature contract`);
      continue;
    }
    for (const provider of check.providers || []) {
      if (!contract.providerFlows[provider]) {
        pushIssue(issues, `${check.id} has no ${provider} feature flow contract`);
      }
      if (provider === 'pingfederate' && contract.exchangeService === 'token-exchange') {
        const pfContract = contract.pfExchangeContract;
        if (!hasExactPfFeatureContract(pfContract, true)) {
          pushIssue(issues, `${check.id} PingFederate exchange probe lacks an exact contract or actionable source gap`);
        }
      }
      if (provider === 'pingfederate' && contract.exchangeService !== 'token-exchange'
          && !hasExactPfFeatureContract(contract.pfCredentialContract, false)) {
        pushIssue(issues, `${check.id} PingFederate feature probe lacks an exact credential contract or actionable source gap`);
      }
    }
    if (contract.selectedTool && (contract.gateway?.applicable === false || contract.authorize?.applicable === false)) {
      pushIssue(issues, `${check.id} is exchange-backed and must not declare Gateway or Authorize not applicable`);
    }
  }
  for (const check of featureChecks) {
    if (!check.testTitle || !check.sourceCodeChanges || check.sourceCodeChanges !== 'never'
        || !check.sourceRef || !Array.isArray(check.providers) || check.providers.length === 0
        || check.providers.some((provider) => !['pingone', 'pingfederate'].includes(provider))
        || !Array.isArray(check.configurationDependencies) || check.configurationDependencies.length === 0) {
      pushIssue(issues, `${check.id || '(unnamed feature check)'} lacks its test, provider lanes, or configuration-only classification`);
    }
    if (requiredA2aChecks.includes(check.id)
        && (!check.providers?.includes('pingone') || !check.providers?.includes('pingfederate')
        || !check.configurationDependencies?.includes('pingfederate-a2a-runtime'))) {
      pushIssue(issues, `${check.id} must cover both session providers and the PingFederate A2A configuration`);
    }
    if (check.id === 'A2A-FM3' && (!check.providers?.every((provider) => check.expectedByProvider?.[provider])
        || !check.expectedByProvider?.pingone || !check.expectedByProvider?.pingfederate
        || !Array.isArray(check.requiredEvidence) || check.requiredEvidence.length === 0)) {
      pushIssue(issues, 'A2A-FM3 must declare an outcome for every provider, provider-specific exchange expectations, and required evidence');
    }
    for (const dependency of check.configurationDependencies || []) {
      if (!repairConfig.driftClasses?.[dependency]) {
        pushIssue(issues, `${check.id} references unknown repairability drift class ${dependency}`);
      }
    }
  }

  for (const lane of lanes) {
    if (!Array.isArray(inventoryConfig[lane])) {
      pushIssue(issues, `Inventory lane ${lane} must be an array`);
      continue;
    }
    const duplicates = duplicateValues(inventoryConfig[lane]);
    if (duplicates.length) pushIssue(issues, `Duplicate ID inside ${lane} lane: ${duplicates.join(', ')}`);
  }

  if (uiInventory) {
    for (const lane of lanes) {
      const uiValues = uiInventory[lane];
      const configuredValues = inventoryConfig[lane];
      if (!Array.isArray(uiValues) || JSON.stringify(uiValues) !== JSON.stringify(configuredValues)) {
        pushIssue(issues, `UI ${lane} lane differs from the BFF readiness inventory`);
      }
    }
  }

  const allowedOverlaps = Array.isArray(inventoryConfig.allowedCrossLaneOverlaps)
    ? inventoryConfig.allowedCrossLaneOverlaps
    : [];
  const seen = new Set();
  const actualOverlaps = new Set();
  const orderedIds = [];
  for (const lane of ['primary', 'advanced', 'ciam', 'privilege', 'admin']) {
    for (const id of inventoryConfig[lane] || []) {
      if (seen.has(id)) actualOverlaps.add(id);
      else {
        seen.add(id);
        orderedIds.push(id);
      }
    }
  }
  const expectedOverlapSet = new Set(allowedOverlaps);
  if (actualOverlaps.size !== expectedOverlapSet.size
      || [...actualOverlaps].some((id) => !expectedOverlapSet.has(id))) {
    pushIssue(issues, `Cross-lane overlaps must be exactly ${[...expectedOverlapSet].join(', ')}`);
  }

  const excluded = inventoryConfig.excluded || {};
  if (Object.keys(excluded).join(',') !== 'ADMIN13' || excluded.ADMIN13 !== 'navigation-only') {
    pushIssue(issues, 'ADMIN13 must be the only excluded navigation entry');
  }
  const executableAdminIds = (inventoryConfig.admin || []).filter((id) => !Object.hasOwn(excluded, id));
  const caseIds = [
    ...(inventoryConfig.primary || []),
    ...(inventoryConfig.advanced || []),
    ...(inventoryConfig.ciam || []).filter((id) => !seenIn(inventoryConfig.primary, id)),
    ...(inventoryConfig.privilege || []).filter((id) => !seenIn([
      ...(inventoryConfig.primary || []), ...(inventoryConfig.ciam || []),
    ], id)),
    ...executableAdminIds,
  ];
  if (caseIds.length !== 47 || new Set(caseIds).size !== 47) {
    pushIssue(issues, `Expected exactly 47 executable Demo Steps entries; found ${caseIds.length} entries (${new Set(caseIds).size} unique)`);
  }
  const ciAmCount = (inventoryConfig.ciam || []).filter((id) => !seenIn(inventoryConfig.primary, id)).length;
  const privilegeCount = (inventoryConfig.privilege || []).filter((id) => !seenIn([
    ...(inventoryConfig.primary || []), ...(inventoryConfig.ciam || []),
  ], id)).length;
  if ((inventoryConfig.primary || []).length !== 25 || ciAmCount !== 4 || privilegeCount !== 6 || executableAdminIds.length !== 12) {
    pushIssue(issues, `Expected lane counts 25 + 4 + 6 + 12; found ${(inventoryConfig.primary || []).length} + ${ciAmCount} + ${privilegeCount} + ${executableAdminIds.length}`);
  }

  const useCaseById = new Map(useCases.map((item) => [item.id, item]));
  const adminById = new Map(adminSteps.map((item) => [item.id, item]));
  const adminExpectations = inventoryConfig.adminExpectations || {};
  const rows = [];

  for (const id of caseIds) {
    const isAdmin = id.startsWith('ADMIN');
    const step = isAdmin ? adminById.get(id) : useCaseById.get(id);
    if (!step) {
      pushIssue(issues, `${id} is missing from the backend ${isAdmin ? 'Admin' : 'use-case'} catalog`);
      continue;
    }
    if (!Object.hasOwn(auth.useCases || {}, id)) {
      pushIssue(issues, `${id} is missing from auth-requirements.json`);
    }
    if (step.maturity === 'needs-build') {
      pushIssue(issues, `${id} is marked needs-build`);
    }

    const expectation = isAdmin ? adminExpectations[id] : null;
    if (isAdmin && (!expectation || !expectation.expectedAction || !Object.hasOwn(expectation, 'expectedTool'))) {
      pushIssue(issues, `${id} is missing its expected Admin MCP operation`);
    }

    const mode = executionModeFor(id, step.trigger, isAdmin);
    const modeConfig = repairConfig.executionModes?.[mode];
    if (!mode) pushIssue(issues, `${id} has unsupported trigger type ${step.trigger?.type || '(missing)'}`);
    if (!modeConfig) pushIssue(issues, `${id} execution mode ${mode || '(missing)'} has no repairability classification`);
    if (modeConfig && (modeConfig.sourceCodeChanges !== 'never'
        || !['configuration-first', 'release-required'].includes(modeConfig.repairClass)
        || !Array.isArray(modeConfig.configurationDependencies)
        || modeConfig.configurationDependencies.length === 0)) {
      pushIssue(issues, `${mode} repairability must declare configuration dependencies and sourceCodeChanges=never`);
    }
    for (const dependency of modeConfig?.configurationDependencies || []) {
      const drift = repairConfig.driftClasses?.[dependency];
      if (!drift || !['automatic', 'manual', 'release-only'].includes(drift.repairMode)) {
        pushIssue(issues, `${mode} references unknown repairability drift class ${dependency}`);
      } else if (drift.repairMode === 'automatic' && (!drift.configurationOnly || !drift.operation || !drift.readback)) {
        pushIssue(issues, `${dependency} is automatic but lacks a config-only operation and readback`);
      }
    }

    const behaviorVerticals = isAdmin ? [] : verticals;
    const resolvedStepsByVertical = Object.fromEntries(behaviorVerticals.map((vertical) => [
      vertical,
      resolveUseCase(id, vertical) || step,
    ]));
    const expectedBehaviorByVertical = Object.fromEntries(Object.entries(resolvedStepsByVertical).map(([vertical, verticalStep]) => [
      vertical,
      expectedBehaviorFor({ id, step: verticalStep, isAdmin, expectation }),
    ]));
    const authorizationContractByVertical = Object.fromEntries(Object.entries(resolvedStepsByVertical).map(([vertical, verticalStep]) => [
      vertical,
      authorizationContractFor(verticalStep, sources, issues, id, vertical),
    ]));
    const runtimePrerequisitesByVertical = Object.fromEntries(Object.entries(resolvedStepsByVertical).map(([vertical, verticalStep]) => [
      vertical,
      {
        requiredFlags: requiredFlagsForUseCase(verticalStep),
        a2aCredentials: needsA2aCredentials(verticalStep),
        parConfig: needsParConfig(verticalStep),
        groupRequirement: verticalStep.requiresGroup || null,
      },
    ]));
    for (const [vertical, prerequisites] of Object.entries(runtimePrerequisitesByVertical)) {
      const prerequisiteClasses = [
        ...(prerequisites.requiredFlags.length ? ['demo-feature-flag'] : []),
        ...(prerequisites.a2aCredentials ? ['a2a-specialist-credentials'] : []),
        ...(prerequisites.parConfig ? ['pingone-par-runtime'] : []),
        ...(prerequisites.groupRequirement ? ['authorize-group-membership'] : []),
      ];
      for (const dependency of prerequisiteClasses) {
        const drift = repairConfig.driftClasses?.[dependency];
        if (!drift || !['automatic', 'manual', 'release-only'].includes(drift.repairMode)) {
          pushIssue(issues, `${id} ${vertical} prerequisite references unknown repairability drift class ${dependency}`);
        } else if (drift.repairMode === 'automatic' && (!drift.configurationOnly || !drift.operation || !drift.readback)) {
          pushIssue(issues, `${dependency} is automatic but lacks a config-only operation and readback`);
        }
      }
    }
    const expectedBehavior = expectedBehaviorByVertical.banking
      || Object.values(expectedBehaviorByVertical)[0]
      || expectedBehaviorFor({ id, step, isAdmin, expectation });
    const rowVerticals = isAdmin ? ['pingone-admin'] : [...verticals];
    const runtimeVerticalGroups = groupRuntimeVerticalBehaviors(
      expectedBehaviorByVertical,
      authorizationContractByVertical,
      runtimePrerequisitesByVertical,
      expectedBehavior,
      null,
      null,
      rowVerticals,
    );
    const alternateBehaviors = id === 'UC14b'
      ? [{
        kind: 'page-load',
        path: step.trigger?.path,
        pathname: routePath(step.trigger?.path),
        searchParams: routeSearchParams(step.trigger?.path),
        hash: routeHash(step.trigger?.path),
        variant: 'full-page-live-par',
      }]
      : [];
    const behaviorContracts = Object.entries(expectedBehaviorByVertical).length
      ? Object.entries(expectedBehaviorByVertical)
      : [['default', expectedBehavior]];

    for (const [vertical, behavior] of [...behaviorContracts, ...alternateBehaviors.map((behavior) => ['alternate', behavior])]) {
      if (!behavior) {
        pushIssue(issues, `${id} has no expected behavior contract${vertical === 'default' ? '' : ` for ${vertical}`}`);
      } else if (behavior.kind === 'agent-outcome' || behavior.kind === 'a2a'
          || behavior.kind === 'attack-outcome' || behavior.kind === 'intent-binding-quick'
          || behavior.kind === 'id-jag') {
        if (!behavior.expectedOutcome) pushIssue(issues, `${id} has no expected outcome${vertical === 'default' ? '' : ` for ${vertical}`}`);
        if (['agent-outcome', 'a2a'].includes(behavior.kind) && !behavior.triggerText) {
          pushIssue(issues, `${id} has no runnable trigger text${vertical === 'default' ? '' : ` for ${vertical}`}`);
        }
        if (behavior.kind === 'attack-outcome' && !behavior.sim) {
          pushIssue(issues, `${id} has no attack simulation${vertical === 'default' ? '' : ` for ${vertical}`}`);
        }
      }

      if (behavior?.kind === 'page-load') {
        if (!behavior.pathname || !Object.hasOwn(auth.routes || {}, behavior.pathname)) {
          pushIssue(issues, `${id} page route ${behavior.pathname || '(missing)'} is absent from the auth route contract`);
        }
      }
      if (behavior?.kind === 'education-panel' && educationPanelIds
          && !educationPanelIds.includes(behavior.panel)) {
        pushIssue(issues, `${id} education panel ${behavior.panel || '(missing)'} is not registered in the UI`);
      }
    }

    if (isAdmin && step.trigger?.type !== 'chip') {
      pushIssue(issues, `${id} is an executable Admin step but its UI trigger is not a chip`);
    }
    if (!isAdmin && !step.expectedOutcome && ['agent-chip', 'attack-sim', 'a2a', 'intent-binding-quick', 'live-id-jag'].includes(mode)) {
      pushIssue(issues, `${id} has no expected outcome in the backend catalog`);
    }

    const providerFlows = {
      pingone: providerFlowFor(id, isAdmin, 'pingone'),
      pingfederate: providerFlowFor(id, isAdmin, 'pingfederate'),
    };
    const providerNotApplicableReasons = id === 'UC40'
      ? { pingone: 'UC40 is a native PingFederate ID-JAG journey and requires a PingFederate-authenticated session' }
      : {};
    for (const [provider, flowId] of Object.entries(providerFlows)) {
      if (!flowId) {
        if (!providerNotApplicableReasons[provider]) {
          pushIssue(issues, `${id} ${provider} flow is not applicable without an explicit reason`);
        }
        continue;
      }
      const flow = providerFlowConfig[flowId];
      if (!flow || flow.sourceCodeChanges !== 'never'
          || !Array.isArray(flow.configurationDependencies) || flow.configurationDependencies.length === 0) {
        pushIssue(issues, `${id} ${provider} flow ${flowId} lacks a configuration-only classification`);
        continue;
      }
      for (const dependency of flow.configurationDependencies) {
        const drift = repairConfig.driftClasses?.[dependency];
        if (!drift || !['automatic', 'manual', 'release-only'].includes(drift.repairMode)) {
          pushIssue(issues, `${id} ${provider} flow references unknown repairability drift class ${dependency}`);
        } else if (drift.repairMode === 'automatic' && (!drift.configurationOnly || !drift.operation || !drift.readback)) {
          pushIssue(issues, `${dependency} is automatic but lacks a config-only operation and readback`);
        }
      }
      if (provider === 'pingfederate') {
        const pfContract = pfExchangeContractFor({ id, flowId, profiles: sources.pingFederateProfiles });
        if (pfContract.issuer?.configurationKey !== 'pf_issuer'
            || pfContract.endpoint?.configurationKey !== 'pf_token_endpoint'
            || !Array.isArray(pfContract.credentialRoles) || pfContract.credentialRoles.length === 0) {
          pushIssue(issues, `${id} PingFederate flow lacks its checked-in issuer, endpoint-key, and credential-role contract`);
        }
      }
    }

    rows.push({
      id,
      kind: isAdmin ? 'admin-mcp' : 'demo-step',
      triggerType: step.trigger?.type || null,
      expectedOutcome: step.expectedOutcome || null,
      expectedBehavior,
      expectedBehaviorByVertical,
      authorizationContractByVertical,
      runtimePrerequisitesByVertical,
      alternateBehaviors,
      providerFlows,
      providerNotApplicableReasons,
      providerRoleApplicability: providerRoleApplicabilityFor({ id, providerFlows }),
      pfExchangeContract: providerFlows.pingfederate
        ? pfExchangeContractFor({ id, flowId: providerFlows.pingfederate, profiles: sources.pingFederateProfiles })
        : null,
      auth: auth.useCases?.[id] || auth.defaultLevel || null,
      verticals: isAdmin ? ['pingone-admin'] : [...verticals],
      runtimeVerticalGroups,
      executionMode: mode,
      repairability: modeConfig ? {
        repairClass: modeConfig.repairClass,
        sourceCodeChanges: modeConfig.sourceCodeChanges,
        configurationDependencies: [...modeConfig.configurationDependencies],
      } : null,
      sourceRef: isAdmin
        ? `demo_api_server/config/admin/demoSteps.js#${id}`
        : `demo_api_server/config/useCases.js#${id}`,
      codeRefs: Array.isArray(step.codeRefs) ? [...step.codeRefs] : [],
    });
  }

  if (issues.length) {
    throw new Error(`Demo readiness contract failed:\n- ${issues.join('\n- ')}`);
  }
  return rows;
}

function seenIn(values, id) {
  return Array.isArray(values) && values.includes(id);
}

function buildDemoReadinessCatalog({ verticals = VERTICALS, includeAdmin = true } = {}) {
  const sources = loadDemoReadinessSources();
  sources.verticals = verticals;
  const rows = validateDemoReadinessCatalog(sources);
  return includeAdmin ? rows : rows.filter((row) => row.kind !== 'admin-mcp');
}

module.exports = {
  buildDemoReadinessCatalog,
  loadDemoReadinessSources,
  validateDemoReadinessCatalog,
  pfExchangeContractFor,
  providerRoleApplicabilityFor,
  routePath,
};
