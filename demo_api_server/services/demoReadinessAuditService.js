'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { redactReadinessValue } = require('./demoReadinessReport');
const PF_PROFILES = require('../config/demoReadinessPingFederateProfiles.json');
const { getReadinessToolMetadata } = require('../config/verticals/pingone-admin/tools');
const { resolveRepositoryRoot } = require('../utils/repositoryRoot');
const REPOSITORY_ROOT = resolveRepositoryRoot(__dirname);
const healthGate = require(path.join(REPOSITORY_ROOT, 'scripts/check-demo-health-gate'));
const mcpPreflight = require(path.join(REPOSITORY_ROOT, 'scripts/check-mcp-preflight'));

// Keep the waiver limited to the known unsupported full-tree read. Remove it
// when a supported exact read path is available; never use it for read errors
// or policy mismatches.
const AUTHORIZE_POLICY_TREE_WAIVER_ID = 'temporary-authorize-policy-tree-readback';
const AUTHORIZE_POLICY_TREE_WAIVER = 'Temporary waiver: live Authorize policy-tree parity is unverified. Decision endpoint references and runtime Authorize decisions remain required.';
const P1 = ['audience', 'scope', 'mirror', 'appGrant', 'requiredFlag', 'a2aCredential',
  'parSetting', 'groupMembership', 'registeredToolScope', 'authorizeEndpoint', 'policyReadback'];
const PF = ['clientGrantProcessorAtm', 'specialistResourceUriIdJag', 'davinciClientAdapter', 'jwksAudience'];
const APPLICABILITY = { userLogin: 'required', agentIdentity: 'required', tokenIssuer: 'required', exchangeService: 'required', resourceServer: 'required' };

function expired(deadlineAt, signal) {
  return Boolean(signal?.aborted || (deadlineAt && Date.now() >= deadlineAt));
}
function readSignal(deadlineAt, signal) {
  if (!deadlineAt) return signal;
  const timeout = AbortSignal.timeout(Math.max(1, deadlineAt - Date.now()));
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
function status(value) {
  return value && typeof value === 'object' && value.status ? value.status : (value === true ? 'pass' : 'fail');
}
function auditRow(id, value, options = {}) {
  const result = status(value);
  const waiver = id === 'pingone:policyReadback'
    && result === 'blocked'
    && value?.waiver === AUTHORIZE_POLICY_TREE_WAIVER_ID
    ? AUTHORIZE_POLICY_TREE_WAIVER
    : undefined;
  return redactReadinessValue({
    id, target: options.target,
    userSessionProvider: options.userSessionProvider || 'pingone',
    agentIdentityProvider: options.agentIdentityProvider || 'pingone',
    tokenIssuer: options.tokenIssuer || 'pingone',
    exchangeService: options.exchangeService || 'pingone',
    resourceServer: options.resourceServer || 'agent-gateway',
    providerApplicability: options.providerApplicability || APPLICABILITY,
    status: ['pass', 'fail', 'blocked', 'not-run'].includes(result) ? result : 'fail',
    required: waiver ? false : options.required !== false, expected: options.expected || 'configured',
    observed: value && typeof value === 'object' && !Array.isArray(value) ? value.observed : Boolean(value),
    sourceRef: options.sourceRef,
    evidence: value && typeof value === 'object' && !Array.isArray(value) ? value.reason : undefined,
    waiver,
    repairCandidate: value && typeof value === 'object' && !Array.isArray(value) ? value.repairCandidate : undefined,
    repairCandidates: value && typeof value === 'object' && !Array.isArray(value) ? value.repairCandidates : undefined,
  });
}
function afterRead(rows, deadlineAt, signal) {
  if (!expired(deadlineAt, signal)) return rows;
  return rows.map((item) => auditRow(item.id, { status: 'not-run', reason: 'deadline exceeded or aborted' }, { ...item, required: true }));
}
function all(actual, expected) {
  return Array.isArray(expected) && expected.length > 0 && expected.every((entry) => actual.includes(entry));
}
function exactArray(actual, expected) {
  return Array.isArray(actual) && Array.isArray(expected)
    && actual.length === expected.length && expected.every((entry) => actual.includes(entry));
}
function semanticEqual(left, right) {
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right)
      && left.length === right.length && left.every((item, index) => semanticEqual(item, right[index]));
  }
  if (left && right && typeof left === 'object' && typeof right === 'object') {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return exactArray(leftKeys, rightKeys) && leftKeys.every((key) => semanticEqual(left[key], right[key]));
  }
  return left === right;
}
function boundedRead(read, { deadlineAt, signal } = {}) {
  if (expired(deadlineAt, signal)) return Promise.reject(new Error('deadline exceeded or aborted'));
  if (!deadlineAt && !signal) return Promise.resolve().then(read);
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (callback, value) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      callback(value);
    };
    const onAbort = () => finish(reject, new Error('deadline exceeded or aborted'));
    const timer = deadlineAt ? setTimeout(onAbort, Math.max(1, deadlineAt - Date.now())) : null;
    signal?.addEventListener('abort', onAbort, { once: true });
    Promise.resolve().then(read).then((value) => finish(resolve, value), (error) => finish(reject, error));
  });
}
function adapterArgs(args = {}) {
  return { ...args, signal: readSignal(args.deadlineAt, args.signal) };
}
async function get(fetchImpl, url, options = {}) {
  if (expired(options.deadlineAt, options.signal)) throw new Error('deadline exceeded or aborted');
  const requestOptions = { method: 'GET', headers: options.headers || {}, signal: readSignal(options.deadlineAt, options.signal) };
  const response = await boundedRead(() => fetchImpl(url, requestOptions), options);
  if (!response.ok) throw new Error('read returned HTTP ' + response.status);
  return boundedRead(() => response.json(), options);
}
function blocked(names, reason) {
  return Object.fromEntries(names.map((name) => [name, { status: 'blocked', reason }]));
}

function repositoryValues() {
  const root = REPOSITORY_ROOT;
  const topology = JSON.parse(fs.readFileSync(path.join(root, 'scope-topology.json'), 'utf8'));
  const gateway = JSON.parse(fs.readFileSync(path.join(root, 'ping-gateway/config/scope-topology.json'), 'utf8'));
  const { buildDemoReadinessCatalog, loadDemoReadinessSources } = require('./demoReadinessCatalog');
  const { requiredFlagsForUseCase, needsA2aCredentials, needsParConfig } = require('./demoStepPrerequisites');
  const sources = loadDemoReadinessSources();
  const catalog = buildDemoReadinessCatalog();
  const adminToolMetadata = getReadinessToolMetadata();
  const useCases = sources.useCases;
  const requirements = catalog.map((entry) => {
    const useCase = useCases.find((candidate) => candidate.id === entry.id) || {};
    return {
      id: entry.id,
      flags: requiredFlagsForUseCase(useCase),
      a2a: needsA2aCredentials(useCase),
      par: needsParConfig(useCase),
      tool: useCase.primaryTool,
      kind: entry.kind,
      auth: entry.auth,
      authorization: entry.authorizationContractByVertical,
      prerequisites: entry.runtimePrerequisitesByVertical,
      expectedBehavior: entry.expectedBehavior,
      providerFlows: entry.providerFlows,
      sourceRef: entry.sourceRef,
      adminExpectation: sources.inventory?.adminExpectations?.[entry.id] || null,
    };
  });
  const toolNames = Object.keys(topology.tools || {});
  const values = {
    scopeTopology: { status: Object.keys(topology.scopes || {}).length ? 'pass' : 'fail', observed: { scopeCount: Object.keys(topology.scopes || {}).length } },
    verticalManifests: { status: Object.keys(sources.verticalManifests || {}).length ? 'pass' : 'fail' },
    routeAuth: { status: catalog.every((entry) => entry.auth) ? 'pass' : 'fail', observed: { catalogCount: catalog.length } },
    prerequisiteParity: { status: catalog.length === 47 && requirements.every((item) => Array.isArray(item.flags)) ? 'pass' : 'fail', observed: { cases: requirements.length } },
    registeredTools: { status: requirements.filter((item) => item.tool && !toolNames.includes(item.tool)).length ? 'fail' : 'pass' },
    gatewayConfig: { status: semanticEqual(gateway.scopes || {}, topology.scopes || {}) ? 'pass' : 'fail' },
    authorizeReferences: { status: Boolean(sources.repairability.driftClasses?.['authorize-endpoint-reference']) ? 'pass' : 'fail' },
  };
  for (const item of requirements) {
    const isAdmin = item.kind === 'admin-mcp';
    const authorizationContracts = Object.values(item.authorization || {});
    const prerequisiteContracts = Object.values(item.prerequisites || {});
    const toolContract = authorizationContracts.every((contract) => !contract.primaryTool || (
      contract.gatewayTool && contract.requiredScopes.length > 0
      && contract.scopeResources.length === contract.requiredScopes.length
      && contract.scopeResources.every((scope) => scope.audience && scope.scope)
    ));
    const prerequisiteParity = isAdmin || (prerequisiteContracts.length > 0 && prerequisiteContracts.every((contract) => (
      exactArray(contract.requiredFlags, item.flags)
      && contract.a2aCredentials === item.a2a && contract.parConfig === item.par
    )));
    const actionMetadata = adminToolMetadata[item.expectedBehavior?.expectedAction];
    const adminSourceContract = item.adminExpectation && semanticEqual(
      { expectedAction: item.expectedBehavior?.expectedAction, expectedTool: item.expectedBehavior?.expectedTool },
      { expectedAction: item.adminExpectation.expectedAction, expectedTool: item.adminExpectation.expectedTool },
    );
    const registeredAdminOperation = Boolean(actionMetadata && (
      actionMetadata.expectsHostedTool
        ? typeof item.expectedBehavior?.expectedTool === 'string' && actionMetadata.hostedTools.includes(item.expectedBehavior.expectedTool)
        : item.expectedBehavior?.expectedTool === null
    ));
    const adminContract = !isAdmin || Boolean(item.auth === 'admin'
      && item.expectedBehavior?.kind === 'admin-mcp'
      && adminSourceContract && registeredAdminOperation
      && item.providerFlows?.pingone === 'pingone-admin-mcp'
      && item.providerFlows?.pingfederate === 'pingfederate-admin-mcp');
    const staticContract = Boolean(item.auth && toolContract && prerequisiteParity && adminContract && (!item.tool || toolNames.includes(item.tool)));
    const deferred = item.a2a || item.par;
    values['case:' + item.id] = deferred
      ? { status: staticContract ? 'blocked' : 'fail', reason: staticContract ? (item.a2a ? 'A2A credential/profile parity requires live target readback' : 'PAR application configuration requires live target readback') : 'checked-in UI/backend prerequisite or authorization contract disagrees', observed: { flags: item.flags, a2a: item.a2a, par: item.par, tool: item.tool, prerequisiteParity, toolContract, adminContract, adminSourceContract, registeredAdminOperation, verticalContracts: prerequisiteContracts.length }, sourceRef: item.sourceRef }
      : { status: staticContract ? 'pass' : 'fail', observed: { flags: item.flags, a2a: item.a2a, par: item.par, tool: item.tool, prerequisiteParity, toolContract, adminContract, adminSourceContract, registeredAdminOperation, verticalContracts: prerequisiteContracts.length }, sourceRef: item.sourceRef };
  }
  return values;
}

async function pingOneRead({ environmentId, credentials = {}, expected = {}, fetchImpl, deadlineAt, signal, targetId }) {
  if (!environmentId || !credentials.accessToken) return blocked(P1, 'PingOne Management API credentials are unavailable');
  const base = 'https://api.pingone.' + (credentials.region || 'com') + '/v1/environments/' + encodeURIComponent(environmentId);
  const options = { headers: { Authorization: 'Bearer ' + credentials.accessToken }, deadlineAt, signal };
  try {
    const [resources, applications, groups, endpoints] = await Promise.all([
      get(fetchImpl, base + '/resources?limit=100', options),
      get(fetchImpl, base + '/applications?limit=100', options),
      get(fetchImpl, base + '/groups?limit=100', options),
      get(fetchImpl, base + '/decisionEndpoints?limit=100', options),
    ]);
    const resourceList = resources._embedded?.resources || [];
    const audiences = resourceList.flatMap((resource) => Array.isArray(resource.audience) ? resource.audience : [resource.audience]).filter(Boolean);
    const applicationList = applications._embedded?.applications;
    const appIds = Array.isArray(applicationList) ? applicationList.map((item) => item.id).filter(Boolean) : [];
    const completeApplicationList = Array.isArray(applicationList) && !applications._links?.next && !applications.next;
    const groupIds = (groups._embedded?.groups || []).map((item) => item.id);
    const endpointIds = (endpoints._embedded?.decisionEndpoints || []).map((item) => item.id);
    const scopeReads = await Promise.all(Object.entries(expected.resourceScopes || {}).map(async ([resourceId, scopeNames]) => {
      const body = await get(fetchImpl, base + '/resources/' + encodeURIComponent(resourceId) + '/scopes?limit=100', options);
      const actual = (body._embedded?.scopes || []).map((scope) => scope.name || scope.value);
      return { resourceId, actual, expected: scopeNames, complete: !body._links?.next && !body.next };
    }));
    const scopeCandidates = scopeReads.flatMap(({ resourceId, actual, expected: scopeNames, complete }) => {
      const missing = scopeNames.filter((scope) => !actual.includes(scope));
      const unexpected = actual.filter((scope) => !scopeNames.includes(scope));
      return complete && missing.length && !unexpected.length ? [{
        repairClass: 'pingone-scope-addition', target: targetId,
        object: { id: resourceId, kind: 'pingone-resource-scopes', missingScopes: missing },
        current: actual, expected: scopeNames,
        sourceRef: 'scope-topology.json#resources/' + resourceId + '/scopes',
        operation: 'Create only the uniquely mapped missing PingOne resource scopes: ' + missing.join(', '),
      }] : [];
    });
    const expectedGrants = expected.applicationGrants || {};
    const declaredGrantAppIds = Object.keys(expectedGrants);
    const grantReads = await Promise.all((completeApplicationList ? appIds : []).map(async (applicationId) => {
      const body = await get(fetchImpl, base + '/applications/' + encodeURIComponent(applicationId) + '/grants?limit=100', options);
      const grants = body._embedded?.grants;
      if (!Array.isArray(grants) || body._links?.next || body.next) return { applicationId, status: 'blocked' };
      const actual = grants.flatMap((grant) => (grant.scopes || []).map((scope) => scope.name || scope.value || scope.id));
      return { applicationId, actual, expected: expectedGrants[applicationId] || [], status: exactArray(actual, expectedGrants[applicationId]) ? 'pass' : 'fail' };
    }));
    const grantCandidates = grantReads.flatMap(({ applicationId, actual, expected: scopeNames, status: grantStatus }) => {
      const missing = (scopeNames || []).filter((scope) => !(actual || []).includes(scope));
      const unexpected = (actual || []).filter((scope) => !(scopeNames || []).includes(scope));
      return grantStatus === 'fail' && missing.length && !unexpected.length ? [{
        repairClass: 'pingone-app-scope-grant', target: targetId,
        object: { id: applicationId, kind: 'pingone-application-grants', missingScopes: missing },
        current: actual, expected: scopeNames,
        sourceRef: 'scope-topology.json#applications/' + applicationId + '/grants',
        operation: 'Add only the uniquely mapped required PingOne application grants: ' + missing.join(', '),
      }] : [];
    });
    const memberships = expected.groupMemberships || expected.subjectGroupMemberships || {};
    const membershipChecks = await Promise.all(Object.entries(memberships).map(async ([userId, expectedGroups]) => {
      const body = await get(fetchImpl, base + '/users/' + encodeURIComponent(userId) + '/memberOfGroups?limit=100', options);
      const rows = body._embedded?.memberOfGroups || body._embedded?.groups || body.items || [];
      const actual = rows.map((item) => item.group?.id || item.groupId || item.id).filter(Boolean);
      return exactArray(actual, expectedGroups);
    }));
    const compare = (name, actual, evidenceName) => Array.isArray(expected[name]) && expected[name].length
      ? { status: exactArray(actual, expected[name]) ? 'pass' : 'fail', observed: { [evidenceName]: actual } }
      : { status: 'blocked', reason: 'no declared expected ' + evidenceName };
    return {
      audience: compare('audiences', audiences, 'audiences'),
      scope: Object.keys(expected.resourceScopes || {}).length ? {
        status: !scopeReads.every(({ complete }) => complete) ? 'blocked' : scopeReads.every(({ actual, expected: scopeNames }) => exactArray(actual, scopeNames)) ? 'pass' : 'fail',
        reason: !scopeReads.every(({ complete }) => complete) ? 'PingOne Management API did not return a complete scope list' : undefined,
        repairCandidates: scopeCandidates,
      } : { status: 'blocked', reason: 'resource scope readback requires declared resource IDs' },
      mirror: { status: 'blocked', reason: 'scope mirror readback has no supported Management API contract' },
      appGrant: !declaredGrantAppIds.length
        ? { status: 'blocked', reason: 'application grant readback requires a complete declared application grant contract' }
        : !completeApplicationList
          ? { status: 'blocked', reason: 'PingOne application readback cannot enumerate the complete application set' }
          : !exactArray(appIds, declaredGrantAppIds)
            ? { status: 'fail', observed: { applicationIds: appIds, declaredApplicationIds: declaredGrantAppIds } }
            : grantReads.some((result) => result.status === 'blocked')
              ? { status: 'blocked', reason: 'PingOne application grant readback cannot enumerate the complete grant set' }
              : { status: grantReads.every((result) => result.status === 'pass') ? 'pass' : 'fail', observed: { applicationIds: appIds }, repairCandidates: grantCandidates },
      requiredFlag: { status: 'blocked', reason: 'effective flag readback requires authenticated BFF configuration access' },
      a2aCredential: { status: 'blocked', reason: 'credential presence is not returned by PingOne Management API' },
      parSetting: { status: 'blocked', reason: 'PAR setting readback requires declared application configuration' },
      groupMembership: Object.keys(memberships).length ? { status: membershipChecks.every(Boolean) ? 'pass' : 'fail' } : { status: 'blocked', reason: 'group membership readback requires declared subject/group contracts' },
      registeredToolScope: { status: 'blocked', reason: 'registered Agent Gateway tool scope API is unavailable' },
      authorizeEndpoint: compare('decisionEndpointIds', endpointIds, 'decisionEndpointIds'),
      policyReadback: {
        status: 'blocked',
        reason: 'complete PingOne Authorize policy-tree read is unavailable with current worker credentials',
        waiver: AUTHORIZE_POLICY_TREE_WAIVER_ID,
      },
    };
  } catch (error) {
    return blocked(P1, error.message);
  }
}

async function pfRead({ baseUrl, credentials = {}, fetchImpl, deadlineAt, signal }) {
  if (!baseUrl || !credentials.accessToken) return { values: blocked(PF, 'PingFederate Admin API credentials are unavailable'), clients: null };
  try {
    const base = baseUrl.replace(/\/$/, '');
    const options = { headers: { Authorization: 'Bearer ' + credentials.accessToken }, deadlineAt, signal };
    const [clientBody, atms, policies] = await Promise.all([
      get(fetchImpl, base + '/oauth/clients', options),
      get(fetchImpl, base + '/oauth/accessTokenManagers', options),
      get(fetchImpl, base + '/authenticationPolicies', options),
    ]);
    const clients = Array.isArray(clientBody) ? clientBody : (clientBody.items || clientBody._embedded?.clients || []);
    return { clients, values: {
      clientGrantProcessorAtm: { status: 'blocked', reason: 'no authoritative client grant, processor-policy, and ATM contract is committed' },
      specialistResourceUriIdJag: { status: 'blocked', reason: 'specialist SP resource URI/ID-JAG endpoint is not documented in committed sources' },
      davinciClientAdapter: { status: 'blocked', reason: (policies ? 'DaVinci adapter contract is undocumented' : 'authentication policy read unavailable') },
      jwksAudience: { status: 'blocked', reason: (atms ? 'JWT allowed-audience contract is undocumented' : 'access-token manager read unavailable') },
    } };
  } catch (error) {
    return { values: blocked(PF, error.message), clients: null };
  }
}
function profileResult(profile, actual) {
  if (!actual) return { status: 'blocked', reason: 'PF Admin API did not return the declared role object' };
  if (profile.unresolved) return { status: 'blocked', reason: 'committed role contract is unresolved' };
  for (const [field, expected] of Object.entries(profile.expected || {})) {
    if (Array.isArray(expected) ? !exactArray(actual[field], expected) : actual[field] !== expected) return false;
  }
  return true;
}
function inspectEnv(stdout) {
  const item = (Array.isArray(JSON.parse(stdout)) ? JSON.parse(stdout)[0] : JSON.parse(stdout)) || {};
  const env = Object.fromEntries((item.Config?.Env || []).map((line) => {
    const index = line.indexOf('=');
    return [line.slice(0, index), line.slice(index + 1)];
  }));
  let authority = false; let pathPresent = false;
  try {
    const issuer = new URL(env.PF_ISSUER_URI || '');
    const endpoint = new URL(env.PF_TOKEN_ENDPOINT || '');
    authority = issuer.protocol === 'https:' && issuer.host === endpoint.host;
    pathPresent = endpoint.pathname !== '/';
  } catch { /* finding below */ }
  return { issuer: Boolean(env.PF_ISSUER_URI), issuerValue: env.PF_ISSUER_URI || '', endpointValue: env.PF_TOKEN_ENDPOINT || '', clientId: env.PF_TE_CLIENT_ID || '', authority, pathPresent,
    credentials: Boolean(env.PF_TE_CLIENT_ID && env.PF_TE_CLIENT_SECRET),
    mountSources: (item.Mounts || []).map((mount) => String(mount.Source || '')),
    provenance: (item.Mounts || []).some((mount) => String(mount.Source || '').includes('ping-gateway')) };
}
function gatewayComparison(actual, expected) {
  if (!expected || typeof expected !== 'object' || Array.isArray(expected)) {
    return { status: 'blocked', reason: 'declared Gateway Exchange #3 expectation is required' };
  }
  if (!actual || typeof actual !== 'object' || !Array.isArray(actual.mountSources)
      || typeof actual.issuerValue !== 'string' || typeof actual.endpointValue !== 'string'
      || typeof actual.clientId !== 'string' || typeof actual.authority !== 'boolean'
      || typeof actual.pathPresent !== 'boolean' || typeof actual.credentials !== 'boolean') {
    return { status: 'blocked', reason: 'Gateway Exchange #3 readback is incomplete' };
  }
  try {
    const issuer = new URL(expected.issuer);
    const endpoint = new URL(expected.tokenEndpoint);
    if (issuer.protocol !== 'https:' || endpoint.protocol !== 'https:' || issuer.host !== endpoint.host || endpoint.pathname === '/' || !expected.clientId || !expected.provenanceContains) {
      return { status: 'blocked', reason: 'declared Gateway Exchange #3 expectation is incomplete or invalid' };
    }
  } catch {
    return { status: 'blocked', reason: 'declared Gateway Exchange #3 expectation is incomplete or invalid' };
  }
  const issuer = actual.issuerValue === expected.issuer;
  const endpoint = actual.endpointValue === expected.tokenEndpoint;
  const client = expected.clientId ? actual.clientId === expected.clientId : false;
  const provenance = expected.provenanceContains ? actual.mountSources.some((source) => source.includes(expected.provenanceContains)) : false;
  const valid = issuer && endpoint && actual.authority && actual.pathPresent && actual.credentials && client && provenance;
  return {
    status: valid ? 'pass' : 'fail',
    observed: { issuer, endpoint, endpointAuthorityMatchesIssuer: actual.authority, endpointPathConfigured: actual.pathPresent, distinctCredentialsPresent: actual.credentials, clientIdMatches: client, generatedEnvironmentProvenance: provenance },
  };
}
function runtimeAudienceScope(actual, expected) {
  if (!expected?.audience || !Array.isArray(expected.scopes)) return { status: 'blocked', reason: 'declared runtime audience and scopes are required' };
  if (!actual || !actual.audience || !Array.isArray(actual.scopes)) return { status: 'blocked', reason: 'runtime audience/scope readback unavailable' };
  return actual.audience === expected.audience && exactArray(actual.scopes, expected.scopes);
}
function runtimeHealth(actual) {
  if (!actual || typeof actual !== 'object' || !['pass', 'fail', 'blocked'].includes(actual.status)) {
    return { status: 'blocked', reason: 'runtime health readback must report an explicit successful probe' };
  }
  return actual;
}

function createAuditService({ adapters = {}, pfProfiles = PF_PROFILES, fetch = globalThis.fetch } = {}) {
  const fetchImpl = adapters.fetch || fetch;
  const runExecFile = adapters.execFile || promisify(execFile);
  async function auditRepositoryContracts({ deadlineAt, signal } = {}) {
    try {
      const args = { deadlineAt, signal };
      const values = adapters.repository?.readContracts ? await boundedRead(() => adapters.repository.readContracts(adapterArgs(args)), args) : repositoryValues();
      return afterRead(Object.entries(values).map(([name, value]) => auditRow('repository:' + name, value, { sourceRef: value?.sourceRef || 'checked-in source contract' })), deadlineAt, signal);
    } catch (error) { return [auditRow('repository:contracts', { status: 'blocked', reason: error.message }, { sourceRef: 'checked-in source contract' })]; }
  }
  async function auditPingOneConfiguration(args = {}) {
    let values;
    try {
      values = adapters.pingOne?.readConfiguration ? await boundedRead(() => adapters.pingOne.readConfiguration(adapterArgs(args)), args)
        : await pingOneRead({ ...args, fetchImpl });
    } catch (error) {
      values = blocked(P1, error.message);
    }
    return afterRead(P1.map((name) => auditRow('pingone:' + name, values[name] || false, { target: args.targetId, sourceRef: name === 'policyReadback' ? 'PingOne Authorize policy API' : 'PingOne Management API' })), args.deadlineAt, args.signal);
  }
  async function auditPingFederateConfiguration(args = {}) {
    let live;
    try { live = adapters.pingFederate?.readConfiguration ? { values: await boundedRead(() => adapters.pingFederate.readConfiguration(adapterArgs(args)), args), clients: null } : await pfRead({ ...args, fetchImpl }); }
    catch (error) { live = { values: blocked(PF, error.message), clients: null }; }
    const base = { userSessionProvider: 'pingfederate', agentIdentityProvider: 'pingfederate', tokenIssuer: 'pingfederate', exchangeService: 'pingfederate', sourceRef: 'PingFederate Admin API' };
    const checks = PF.map((name) => auditRow('pingfederate:' + name, live.values[name] || false, base));
    if (!live.clients && !adapters.pingFederate?.readConfiguration) {
      checks.unshift(auditRow('pingfederate:admin-api', { status: 'blocked', reason: 'PingFederate Admin API readback unavailable' }, base));
    }
    for (const [role, profile] of Object.entries(pfProfiles.roles || {})) {
      let actual = null;
      if (expired(args.deadlineAt, args.signal)) {
        checks.push(auditRow('pingfederate:profile:' + role, { status: 'not-run', reason: 'deadline exceeded or aborted' }, { ...base, sourceRef: profile.sourceRef }));
        continue;
      }
      if (typeof adapters.pingFederate?.readProfile === 'function') {
        try { actual = await boundedRead(() => adapters.pingFederate.readProfile({ ...adapterArgs(args), role, profile }), args); } catch { actual = null; }
      }
      else if (Array.isArray(live.clients)) actual = live.clients.find((client) => [client.id, client.clientId, client.name].includes(profile.objectId));
      checks.push(auditRow('pingfederate:profile:' + role, profileResult(profile, actual), { ...base, sourceRef: profile.sourceRef }));
    }
    return afterRead(checks, args.deadlineAt, args.signal);
  }
  async function auditRuntimeTarget(args = {}) {
    try {
      const values = adapters.runtime?.readTarget ? await boundedRead(() => adapters.runtime.readTarget(adapterArgs(args)), args) : await (async () => {
        if (!args.bffUrl || !args.gatewayUrl || !args.authorizeUrl || !args.expectedRevision) throw new Error('BFF, Gateway, Authorize URLs and expected revision are required');
        const health = await boundedRead(() => healthGate.fetchJson(args.bffUrl.replace(/\/$/, '') + '/api/healthz', { signal: readSignal(args.deadlineAt, args.signal) }), args);
        const gateway = await mcpPreflight.probe(args.gatewayUrl, { signal: readSignal(args.deadlineAt, args.signal), timeoutMs: args.deadlineAt ? Math.max(1, args.deadlineAt - Date.now()) : undefined });
        const authorize = await get(fetchImpl, args.authorizeUrl, args);
        const routeStatus = gateway.status;
        const routeReady = [200, 401, 403].includes(routeStatus);
        return { health: routeReady && health.status === 200
          ? { status: 'pass', observed: { bffStatus: health.status, gatewayStatus: routeStatus } }
          : { status: 'blocked', reason: routeStatus ? 'Gateway probe returned HTTP ' + routeStatus : 'Gateway probe returned no status' }, revision: health.body?.revision || health.body?.commit, audienceScopes: health.body?.audienceScopes || authorize.audienceScopes };
      })();
      return afterRead([
        auditRow('runtime:health', runtimeHealth(values.health), { sourceRef: 'health and reachable route probes' }),
        auditRow('runtime:revision', args.expectedRevision ? values.revision === args.expectedRevision : { status: 'blocked', reason: 'declared expected revision is required' }, { expected: args.expectedRevision || 'declared revision', sourceRef: 'target revision/config fingerprint' }),
        auditRow('runtime:audience-scope', runtimeAudienceScope(values.audienceScopes, args.expectedAudienceScopes), { expected: args.expectedAudienceScopes, sourceRef: 'target runtime configuration' }),
      ], args.deadlineAt, args.signal);
    } catch (error) { return [auditRow('runtime:health', { status: 'blocked', reason: error.message }, { sourceRef: 'health and reachable route probes' })]; }
  }
  async function auditLocalDockerConfiguration({ targetId, targetKind, hostedConfig, deadlineAt, signal } = {}) {
    if (targetKind === 'se') {
      if (typeof adapters.hostedGateway?.readConfiguration !== 'function') {
        return [auditRow('gateway:pf-exchange3', { status: 'blocked', reason: 'hosted Gateway configuration has no supported readback adapter' }, { target: targetId, sourceRef: 'hosted Gateway runtime configuration' })];
      }
      try {
        const actual = await boundedRead(() => adapters.hostedGateway.readConfiguration(adapterArgs({ targetId, targetKind, deadlineAt, signal })), { deadlineAt, signal });
        return afterRead([auditRow('gateway:pf-exchange3', gatewayComparison(actual, hostedConfig?.expected), { target: targetId, sourceRef: 'hosted Gateway runtime configuration' })], deadlineAt, signal);
      } catch (error) {
        return [auditRow('gateway:pf-exchange3', { status: 'blocked', reason: error.message }, { target: targetId, sourceRef: 'hosted Gateway runtime configuration' })];
      }
    }
    if (targetKind !== 'local') return [];
    if (adapters.docker?.inspect) {
      try {
        const values = await boundedRead(() => adapters.docker.inspect(adapterArgs({ targetId, targetKind, deadlineAt, signal })), { deadlineAt, signal });
        return afterRead([auditRow('gateway:pf-exchange3', values ? gatewayComparison(values, hostedConfig?.expected) : { status: 'blocked', reason: 'Docker adapter did not return Gateway configuration readback' }, { target: targetId, sourceRef: 'read-only Gateway environment' })], deadlineAt, signal);
      } catch (error) {
        return [auditRow('gateway:pf-exchange3', { status: expired(deadlineAt, signal) ? 'not-run' : 'blocked', reason: error.message }, { target: targetId, sourceRef: 'read-only Gateway environment' })];
      }
    }
    try {
      const timeout = Math.max(1, (deadlineAt || (Date.now() + 15_000)) - Date.now());
      const options = { encoding: 'utf8', timeout, signal: readSignal(deadlineAt, signal) };
      const ps = await boundedRead(() => runExecFile('docker', ['ps', '--format', '{{json .}}'], options), { deadlineAt, signal });
      if (expired(deadlineAt, signal)) return [auditRow('gateway:pf-exchange3', { status: 'not-run', reason: 'deadline exceeded or aborted' }, { target: targetId, sourceRef: 'docker ps/inspect' })];
      const listed = String(ps.stdout || '').split('\n').filter(Boolean).some((line) => JSON.parse(line).Names === 'ai-demo-ping-gateway');
      const inspect = await boundedRead(() => runExecFile('docker', ['inspect', 'ai-demo-ping-gateway'], options), { deadlineAt, signal });
      if (!listed) return [auditRow('gateway:pf-exchange3', { status: 'blocked', reason: 'PingGateway container is not running' }, { target: targetId, sourceRef: 'docker ps/inspect' })];
      const config = inspectEnv(String(inspect.stdout || ''));
      return afterRead([auditRow('gateway:pf-exchange3', gatewayComparison(config, hostedConfig?.expected), { target: targetId, sourceRef: 'docker ps/inspect Gateway Exchange #3 environment' })], deadlineAt, signal);
    } catch (error) { return [auditRow('gateway:pf-exchange3', { status: 'blocked', reason: error.message }, { target: targetId, sourceRef: 'docker ps/inspect Gateway Exchange #3 environment' })]; }
  }
  async function auditTarget({ targetId, targetConfig = {}, deadlineAt, signal } = {}) {
    if (expired(deadlineAt, signal)) return [auditRow('target:' + targetId + ':deadline', { status: 'not-run', reason: 'deadline exceeded or aborted' }, { target: targetId })];
    const common = { deadlineAt, signal };
    const batches = await Promise.all([
      auditRepositoryContracts(common), auditPingOneConfiguration({ ...targetConfig.pingOne, targetId, ...common }),
      auditPingFederateConfiguration({ ...targetConfig.pingFederate, ...common }),
      auditRuntimeTarget({ ...targetConfig.runtime, ...common }),
      auditLocalDockerConfiguration({ targetId, targetKind: targetConfig.kind, hostedConfig: targetConfig.gateway, ...common }),
    ]);
    return afterRead(batches.flat().map((item) => ({ ...item, target: item.target || targetId })), deadlineAt, signal);
  }
  return { auditTarget, auditRepositoryContracts, auditPingOneConfiguration, auditPingFederateConfiguration, auditRuntimeTarget, auditLocalDockerConfiguration };
}
const defaults = createAuditService();
module.exports = { createAuditService, ...defaults, inspectEnv, semanticEqual };
