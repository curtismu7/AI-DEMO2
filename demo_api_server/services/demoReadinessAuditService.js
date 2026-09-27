'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { redactReadinessValue } = require('./demoReadinessReport');
const PF_PROFILES = require('../config/demoReadinessPingFederateProfiles.json');
const healthGate = require('../../scripts/check-demo-health-gate');
const mcpPreflight = require('../../scripts/check-mcp-preflight');

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
  return redactReadinessValue({
    id, target: options.target,
    userSessionProvider: options.userSessionProvider || 'pingone',
    agentIdentityProvider: options.agentIdentityProvider || 'pingone',
    tokenIssuer: options.tokenIssuer || 'pingone',
    exchangeService: options.exchangeService || 'pingone',
    resourceServer: options.resourceServer || 'agent-gateway',
    providerApplicability: options.providerApplicability || APPLICABILITY,
    status: ['pass', 'fail', 'blocked', 'not-run'].includes(result) ? result : 'fail',
    required: options.required !== false, expected: options.expected || 'configured',
    observed: value && typeof value === 'object' && !Array.isArray(value) ? value.observed : Boolean(value),
    sourceRef: options.sourceRef,
    evidence: value && typeof value === 'object' && !Array.isArray(value) ? value.reason : undefined,
  });
}
function afterRead(rows, deadlineAt, signal) {
  if (!expired(deadlineAt, signal)) return rows;
  return rows.map((item) => auditRow(item.id, { status: 'not-run', reason: 'deadline exceeded or aborted' }, item));
}
function all(actual, expected) {
  return Array.isArray(expected) && expected.length > 0 && expected.every((entry) => actual.includes(entry));
}
async function get(fetchImpl, url, options = {}) {
  if (expired(options.deadlineAt, options.signal)) throw new Error('deadline exceeded or aborted');
  const response = await fetchImpl(url, { method: 'GET', headers: options.headers || {}, signal: readSignal(options.deadlineAt, options.signal) });
  if (!response.ok) throw new Error('read returned HTTP ' + response.status);
  return response.json();
}
function blocked(names, reason) {
  return Object.fromEntries(names.map((name) => [name, { status: 'blocked', reason }]));
}

function repositoryValues() {
  const root = path.resolve(__dirname, '..', '..');
  const topology = JSON.parse(fs.readFileSync(path.join(root, 'scope-topology.json'), 'utf8'));
  const gateway = JSON.parse(fs.readFileSync(path.join(root, 'ping-gateway/config/scope-topology.json'), 'utf8'));
  const { buildDemoReadinessCatalog, loadDemoReadinessSources } = require('./demoReadinessCatalog');
  const { requiredFlagsForUseCase, needsA2aCredentials, needsParConfig } = require('./demoStepPrerequisites');
  const sources = loadDemoReadinessSources();
  const catalog = buildDemoReadinessCatalog();
  const useCases = sources.useCases;
  const requirements = catalog.map((entry) => {
    const useCase = useCases.find((candidate) => candidate.id === entry.id) || {};
    return { id: entry.id, flags: requiredFlagsForUseCase(useCase), a2a: needsA2aCredentials(useCase), par: needsParConfig(useCase), tool: useCase.primaryTool };
  });
  const toolNames = Object.keys(topology.tools || {});
  return {
    scopeTopology: { status: Object.keys(topology.scopes || {}).length ? 'pass' : 'fail', observed: { scopeCount: Object.keys(topology.scopes || {}).length } },
    verticalManifests: { status: Object.keys(sources.verticalManifests || {}).length ? 'pass' : 'fail' },
    routeAuth: { status: catalog.every((entry) => entry.auth) ? 'pass' : 'fail', observed: { catalogCount: catalog.length } },
    prerequisiteParity: { status: catalog.length === 46 && requirements.every((item) => Array.isArray(item.flags)) ? 'pass' : 'fail', observed: { cases: requirements.length } },
    registeredTools: { status: requirements.filter((item) => item.tool && !toolNames.includes(item.tool)).length ? 'fail' : 'pass' },
    gatewayConfig: { status: JSON.stringify(gateway.scopes || {}) === JSON.stringify(topology.scopes || {}) ? 'pass' : 'fail' },
    authorizeReferences: { status: Boolean(sources.repairability.driftClasses?.['authorize-endpoint-reference']) ? 'pass' : 'fail' },
  };
}

async function pingOneRead({ environmentId, credentials = {}, expected = {}, fetchImpl, deadlineAt, signal }) {
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
    const appIds = (applications._embedded?.applications || []).map((item) => item.id);
    const groupIds = (groups._embedded?.groups || []).map((item) => item.id);
    const endpointIds = (endpoints._embedded?.decisionEndpoints || []).map((item) => item.id);
    const scopeChecks = await Promise.all(Object.entries(expected.resourceScopes || {}).map(async ([resourceId, scopeNames]) => {
      const body = await get(fetchImpl, base + '/resources/' + encodeURIComponent(resourceId) + '/scopes?limit=100', options);
      const actual = (body._embedded?.scopes || []).map((scope) => scope.name || scope.value);
      return all(actual, scopeNames);
    }));
    const grantChecks = await Promise.all(Object.entries(expected.applicationGrants || {}).map(async ([applicationId, scopeNames]) => {
      const body = await get(fetchImpl, base + '/applications/' + encodeURIComponent(applicationId) + '/grants?limit=100', options);
      const actual = (body._embedded?.grants || []).flatMap((grant) => (grant.scopes || []).map((scope) => scope.name || scope.value || scope.id));
      return all(actual, scopeNames);
    }));
    const compare = (name, actual, evidenceName) => Array.isArray(expected[name]) && expected[name].length
      ? { status: all(actual, expected[name]) ? 'pass' : 'fail', observed: { [evidenceName]: actual } }
      : { status: 'blocked', reason: 'no declared expected ' + evidenceName };
    return {
      audience: compare('audiences', audiences, 'audiences'),
      scope: Object.keys(expected.resourceScopes || {}).length ? { status: scopeChecks.every(Boolean) ? 'pass' : 'fail' } : { status: 'blocked', reason: 'resource scope readback requires declared resource IDs' },
      mirror: { status: 'blocked', reason: 'scope mirror readback has no supported Management API contract' },
      appGrant: Object.keys(expected.applicationGrants || {}).length ? { status: grantChecks.every(Boolean) ? 'pass' : 'fail' } : compare('applicationIds', appIds, 'applicationIds'),
      requiredFlag: { status: 'blocked', reason: 'effective flag readback requires authenticated BFF configuration access' },
      a2aCredential: { status: 'blocked', reason: 'credential presence is not returned by PingOne Management API' },
      parSetting: { status: 'blocked', reason: 'PAR setting readback requires declared application configuration' },
      groupMembership: compare('groupIds', groupIds, 'groupIds'),
      registeredToolScope: { status: 'blocked', reason: 'registered Agent Gateway tool scope API is unavailable' },
      authorizeEndpoint: compare('decisionEndpointIds', endpointIds, 'decisionEndpointIds'),
      policyReadback: { status: 'blocked', reason: 'complete PingOne Authorize policy-tree read is unavailable with current worker credentials' },
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
      clientGrantProcessorAtm: { status: Array.isArray(clients) ? 'pass' : 'blocked', observed: { clients: clients.length } },
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
    if (Array.isArray(expected) ? !all(actual[field] || [], expected) : actual[field] !== expected) return false;
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
  return { issuer: Boolean(env.PF_ISSUER_URI), authority, pathPresent,
    credentials: Boolean(env.PF_TE_CLIENT_ID && env.PF_TE_CLIENT_SECRET),
    provenance: (item.Mounts || []).some((mount) => String(mount.Source || '').includes('ping-gateway')) };
}

function createAuditService({ adapters = {}, pfProfiles = PF_PROFILES, fetch = globalThis.fetch } = {}) {
  const fetchImpl = adapters.fetch || fetch;
  const runExecFile = adapters.execFile || promisify(execFile);
  async function auditRepositoryContracts({ deadlineAt, signal } = {}) {
    try {
      const values = adapters.repository?.readContracts ? await adapters.repository.readContracts({ deadlineAt, signal }) : repositoryValues();
      return afterRead(Object.entries(values).map(([name, value]) => auditRow('repository:' + name, value, { sourceRef: 'checked-in source contract' })), deadlineAt, signal);
    } catch (error) { return [auditRow('repository:contracts', { status: 'blocked', reason: error.message }, { sourceRef: 'checked-in source contract' })]; }
  }
  async function auditPingOneConfiguration(args = {}) {
    const values = adapters.pingOne?.readConfiguration ? await adapters.pingOne.readConfiguration(args)
      : await pingOneRead({ ...args, fetchImpl });
    return afterRead(P1.map((name) => auditRow('pingone:' + name, values[name] || false, { sourceRef: name === 'policyReadback' ? 'PingOne Authorize policy API' : 'PingOne Management API' })), args.deadlineAt, args.signal);
  }
  async function auditPingFederateConfiguration(args = {}) {
    let live;
    try { live = adapters.pingFederate?.readConfiguration ? { values: await adapters.pingFederate.readConfiguration(args), clients: null } : await pfRead({ ...args, fetchImpl }); }
    catch (error) { live = { values: blocked(PF, error.message), clients: null }; }
    const base = { userSessionProvider: 'pingfederate', agentIdentityProvider: 'pingfederate', tokenIssuer: 'pingfederate', exchangeService: 'pingfederate', sourceRef: 'PingFederate Admin API' };
    const checks = PF.map((name) => auditRow('pingfederate:' + name, live.values[name] || false, base));
    if (!live.clients && !adapters.pingFederate?.readConfiguration) {
      checks.unshift(auditRow('pingfederate:admin-api', { status: 'blocked', reason: 'PingFederate Admin API readback unavailable' }, base));
    }
    for (const [role, profile] of Object.entries(pfProfiles.roles || {})) {
      let actual = null;
      if (typeof adapters.pingFederate?.readProfile === 'function') actual = await adapters.pingFederate.readProfile({ ...args, role, profile });
      else if (Array.isArray(live.clients)) actual = live.clients.find((client) => [client.id, client.clientId, client.name].includes(profile.objectId));
      checks.push(auditRow('pingfederate:profile:' + role, profileResult(profile, actual), { ...base, sourceRef: profile.sourceRef }));
    }
    return afterRead(checks, args.deadlineAt, args.signal);
  }
  async function auditRuntimeTarget(args = {}) {
    try {
      const values = adapters.runtime?.readTarget ? await adapters.runtime.readTarget(args) : await (async () => {
        if (!args.bffUrl || !args.gatewayUrl || !args.authorizeUrl || !args.expectedRevision) throw new Error('BFF, Gateway, Authorize URLs and expected revision are required');
        const health = await healthGate.fetchJson(args.bffUrl.replace(/\/$/, '') + '/api/healthz', { signal: readSignal(args.deadlineAt, args.signal) });
        const gateway = await mcpPreflight.probe(args.gatewayUrl);
        const authorize = await get(fetchImpl, args.authorizeUrl, args);
        return { health: health.status === 200 && Boolean(gateway.status), revision: health.body?.revision || health.body?.commit, audienceScopes: health.body?.audienceScopes || authorize.audienceScopes };
      })();
      return afterRead([
        auditRow('runtime:health', values.health, { sourceRef: 'health and reachable route probes' }),
        auditRow('runtime:revision', (args.expectedRevision || values.expectedRevision) ? values.revision === (args.expectedRevision || values.expectedRevision) : { status: 'blocked', reason: 'expected revision is required' }, { expected: args.expectedRevision || values.expectedRevision || 'declared revision', sourceRef: 'target revision/config fingerprint' }),
        auditRow('runtime:audience-scope', values.audienceScopes ? true : { status: 'blocked', reason: 'runtime audience/scope readback unavailable' }, { sourceRef: 'target runtime configuration' }),
      ], args.deadlineAt, args.signal);
    } catch (error) { return [auditRow('runtime:health', { status: 'blocked', reason: error.message }, { sourceRef: 'health and reachable route probes' })]; }
  }
  async function auditLocalDockerConfiguration({ targetId, targetKind, hostedConfig, deadlineAt, signal } = {}) {
    if (targetKind === 'se') return afterRead([auditRow('gateway:pf-exchange3', hostedConfig?.pfExchange3 || { status: 'blocked', reason: 'hosted Gateway configuration readback unavailable' }, { target: targetId, sourceRef: 'hosted Gateway runtime configuration' })], deadlineAt, signal);
    if (targetKind !== 'local') return [];
    if (adapters.docker?.inspect) {
      const values = await adapters.docker.inspect({ targetId, targetKind });
      return afterRead(Object.entries(values).map(([name, value]) => auditRow('gateway:' + name, value, { target: targetId, sourceRef: 'read-only Gateway environment' })), deadlineAt, signal);
    }
    try {
      const ps = await runExecFile('docker', ['ps', '--format', '{{json .}}'], { encoding: 'utf8' });
      const listed = String(ps.stdout || '').split('\n').filter(Boolean).some((line) => JSON.parse(line).Names === 'ai-demo-ping-gateway');
      const inspect = await runExecFile('docker', ['inspect', 'ai-demo-ping-gateway'], { encoding: 'utf8' });
      if (!listed) return [auditRow('gateway:pf-exchange3', { status: 'blocked', reason: 'PingGateway container is not running' }, { target: targetId, sourceRef: 'docker ps/inspect' })];
      const config = inspectEnv(String(inspect.stdout || ''));
      const valid = config.issuer && config.authority && config.pathPresent && config.credentials && config.provenance;
      return afterRead([auditRow('gateway:pf-exchange3', { status: valid ? 'pass' : 'fail', observed: { pfIssuerConfigured: config.issuer, endpointAuthorityMatchesIssuer: config.authority, endpointPathConfigured: config.pathPresent, distinctCredentialsPresent: config.credentials, generatedEnvironmentProvenance: config.provenance } }, { target: targetId, sourceRef: 'docker ps/inspect Gateway Exchange #3 environment' })], deadlineAt, signal);
    } catch (error) { return [auditRow('gateway:pf-exchange3', { status: 'blocked', reason: error.message }, { target: targetId, sourceRef: 'docker ps/inspect Gateway Exchange #3 environment' })]; }
  }
  async function auditTarget({ targetId, targetConfig = {}, deadlineAt, signal } = {}) {
    if (expired(deadlineAt, signal)) return [auditRow('target:' + targetId + ':deadline', { status: 'not-run', reason: 'deadline exceeded or aborted' }, { target: targetId })];
    const common = { deadlineAt, signal };
    const batches = await Promise.all([
      auditRepositoryContracts(common), auditPingOneConfiguration({ ...targetConfig.pingOne, ...common }),
      auditPingFederateConfiguration({ ...targetConfig.pingFederate, ...common }),
      auditRuntimeTarget({ ...targetConfig.runtime, ...common }),
      auditLocalDockerConfiguration({ targetId, targetKind: targetConfig.kind, hostedConfig: targetConfig.gateway, ...common }),
    ]);
    return afterRead(batches.flat().map((item) => ({ ...item, target: item.target || targetId })), deadlineAt, signal);
  }
  return { auditTarget, auditRepositoryContracts, auditPingOneConfiguration, auditPingFederateConfiguration, auditRuntimeTarget, auditLocalDockerConfiguration };
}
const defaults = createAuditService();
module.exports = { createAuditService, ...defaults, inspectEnv };
