'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const DEFAULT_PF_PROFILES = require('../config/demoReadinessPingFederateProfiles.json');
const healthGate = require('../../scripts/check-demo-health-gate');
const mcpPreflight = require('../../scripts/check-mcp-preflight');

const PINGONE_FAMILIES = [
  'audience', 'scope', 'mirror', 'appGrant', 'requiredFlag', 'a2aCredential',
  'parSetting', 'groupMembership', 'registeredToolScope', 'authorizeEndpoint', 'policyReadback',
];
const PINGFEDERATE_FAMILIES = [
  'clientGrantProcessorAtm', 'specialistResourceUriIdJag', 'davinciClientAdapter', 'jwksAudience',
];

function statusFor(value) {
  if (value && typeof value === 'object' && value.status) return value.status;
  return value === true ? 'pass' : 'fail';
}

function check(id, value, { target, expected = 'configured', sourceRef, required = true } = {}) {
  const status = statusFor(value);
  return {
    id,
    target,
    status: ['pass', 'fail', 'blocked', 'not-run'].includes(status) ? status : 'fail',
    required,
    expected,
    observed: value && typeof value === 'object' && !Array.isArray(value) ? value.observed : Boolean(value),
    sourceRef,
    evidence: value && typeof value === 'object' && !Array.isArray(value) ? value.reason : undefined,
  };
}

function matchesExpected(actual, expected) {
  if (expected === 'undocumented' || expected === 'environment-configured') return false;
  if (Array.isArray(expected)) return Array.isArray(actual) && expected.every((value) => actual.includes(value));
  return actual === expected;
}

function defaultRepositoryContracts() {
  const root = path.resolve(__dirname, '..', '..');
  const topology = JSON.parse(fs.readFileSync(path.join(root, 'scope-topology.json'), 'utf8'));
  const auth = require('../config/auth-requirements.json');
  const gatewayTopology = JSON.parse(fs.readFileSync(path.join(root, 'ping-gateway', 'config', 'scope-topology.json'), 'utf8'));
  const { buildDemoReadinessCatalog, loadDemoReadinessSources } = require('./demoReadinessCatalog');
  const sources = loadDemoReadinessSources();
  const catalog = buildDemoReadinessCatalog();
  return {
    scopeTopology: Boolean(topology.resources && topology.scopes),
    verticalManifests: Object.keys(sources.verticalManifests).length > 0,
    routeAuth: Object.keys(auth).length > 0,
    prerequisiteParity: catalog.length === 46,
    registeredTools: Boolean(topology.tools && Object.keys(topology.tools).length),
    gatewayConfig: Boolean(gatewayTopology.resources && gatewayTopology.scopes),
    authorizeReferences: Boolean(sources.repairability?.driftClasses?.['authorize-endpoint-reference']),
  };
}

async function defaultRuntimeRead({ bffUrl, gatewayUrl, expectedRevision }) {
  if (!bffUrl) throw new Error('BFF URL is not configured for runtime readback');
  const health = await healthGate.fetchJson(`${bffUrl.replace(/\/$/, '')}/api/healthz`);
  const gateway = gatewayUrl ? await mcpPreflight.probe(gatewayUrl) : { status: 200 };
  const revision = health.body?.revision || health.body?.commit || health.body?.configFingerprint || null;
  return {
    health: health.status === 200 && (gateway.status === 200 || gateway.status === 401 || gateway.status === 403),
    revision,
    expectedRevision: expectedRevision || revision,
  };
}

function createAuditService({ adapters = {}, pfProfiles = DEFAULT_PF_PROFILES } = {}) {
  const runExecFile = adapters.execFile || promisify(execFile);

  async function auditRepositoryContracts() {
    let values;
    try {
      values = adapters.repository?.readContracts ? await adapters.repository.readContracts() : defaultRepositoryContracts();
    } catch (error) {
      return [check('repository:contracts', { status: 'blocked', reason: error.message }, { sourceRef: 'checked-in sources' })];
    }
    return Object.entries(values).map(([family, value]) => check(`repository:${family}`, value, { sourceRef: 'checked-in sources' }));
  }

  async function auditPingOneConfiguration({ environmentId, credentials, deadlineAt } = {}) {
    if (!adapters.pingOne?.readConfiguration) {
      return PINGONE_FAMILIES.map((family) => check(`pingone:${family}`, { status: 'blocked', reason: 'PingOne Management API read adapter unavailable' }, { sourceRef: 'PingOne Management API' }));
    }
    let values;
    try {
      values = await adapters.pingOne.readConfiguration({ environmentId, credentials, deadlineAt });
    } catch (error) {
      return PINGONE_FAMILIES.map((family) => check(`pingone:${family}`, { status: 'blocked', reason: error.message }, { sourceRef: 'PingOne Management API' }));
    }
    return PINGONE_FAMILIES.map((family) => check(`pingone:${family}`, values[family] ?? false, { sourceRef: family === 'policyReadback' ? 'PingOne Authorize policy read API' : 'PingOne Management API' }));
  }

  async function auditPingFederateConfiguration({ baseUrl, credentials, deadlineAt } = {}) {
    const checks = [];
    if (!adapters.pingFederate?.readConfiguration) {
      checks.push(check('pingfederate:admin-api', { status: 'blocked', reason: 'PingFederate Admin API read adapter unavailable' }, { sourceRef: 'PingFederate Admin API' }));
    } else {
      try {
        const values = await adapters.pingFederate.readConfiguration({ baseUrl, credentials, deadlineAt, profiles: pfProfiles });
        for (const family of PINGFEDERATE_FAMILIES) checks.push(check(`pingfederate:${family}`, values[family] ?? false, { sourceRef: 'PingFederate Admin API' }));
        if (typeof adapters.pingFederate.readProfile === 'function') {
          for (const [role, profile] of Object.entries(pfProfiles.roles || {})) {
            const actual = await adapters.pingFederate.readProfile({ baseUrl, credentials, role, profile, deadlineAt });
            const valid = !profile.unresolved && Object.entries(profile.expected || {}).every(([key, expected]) => matchesExpected(actual?.[key], expected));
            const result = profile.unresolved
              ? { status: 'blocked', reason: 'committed role contract is unresolved' }
              : valid;
            checks.push(check(`pingfederate:profile:${role}`, result, { sourceRef: profile.sourceRef }));
          }
        }
      } catch (error) {
        checks.push(check('pingfederate:admin-api', { status: 'blocked', reason: error.message }, { sourceRef: 'PingFederate Admin API' }));
      }
    }
    for (const [role, profile] of Object.entries(pfProfiles.roles || {})) {
      if (profile.unresolved && !checks.some((item) => item.id === `pingfederate:profile:${role}`)) {
        checks.push(check(`pingfederate:profile:${role}`, { status: 'blocked', reason: 'committed role contract is unresolved' }, { sourceRef: profile.sourceRef }));
      }
    }
    return checks;
  }

  async function auditRuntimeTarget({ bffUrl, gatewayUrl, authorizeUrl, targetKind, deadlineAt, expectedRevision } = {}) {
    try {
      const values = adapters.runtime?.readTarget
        ? await adapters.runtime.readTarget({ bffUrl, gatewayUrl, authorizeUrl, targetKind, deadlineAt, expectedRevision })
        : await defaultRuntimeRead({ bffUrl, gatewayUrl, expectedRevision });
      return [
        check('runtime:health', values.health, { sourceRef: 'health/readiness probes' }),
        check('runtime:revision', values.revision === values.expectedRevision, { expected: values.expectedRevision, sourceRef: 'target revision/config fingerprint' }),
      ];
    } catch (error) {
      return [check('runtime:health', { status: 'blocked', reason: error.message }, { sourceRef: 'health/readiness probes' })];
    }
  }

  async function auditLocalDockerConfiguration({ targetId, targetKind } = {}) {
    if (targetKind !== 'local') return [];
    if (adapters.docker?.inspect) {
      const values = await adapters.docker.inspect({ targetId, targetKind });
      return Object.entries(values).map(([family, value]) => check(`gateway:${family}`, value, { target: targetId, sourceRef: 'docker inspect/read-only Gateway environment' }));
    }
    try {
      await runExecFile('docker', ['ps', '--format', '{{json .}}'], { encoding: 'utf8' });
      await runExecFile('docker', ['inspect', 'ai-demo-ping-gateway'], { encoding: 'utf8' });
      return [check('gateway:docker-inspection', true, { target: targetId, sourceRef: 'docker ps/inspect' })];
    } catch (error) {
      return [check('gateway:docker-inspection', { status: 'blocked', reason: error.message }, { target: targetId, sourceRef: 'docker ps/inspect' })];
    }
  }

  async function auditTarget({ targetId, targetConfig = {}, deadlineAt, signal } = {}) {
    if (signal?.aborted || (deadlineAt && Date.now() >= deadlineAt)) {
      return [check(`target:${targetId}:deadline`, { status: 'not-run', reason: 'deadline exceeded or aborted' }, { target: targetId })];
    }
    const [repository, pingOne, pingFederate, runtime, docker] = await Promise.all([
      auditRepositoryContracts(),
      auditPingOneConfiguration({ ...targetConfig.pingOne, deadlineAt }),
      auditPingFederateConfiguration({ ...targetConfig.pingFederate, deadlineAt }),
      auditRuntimeTarget({ ...targetConfig.runtime, targetKind: targetConfig.kind, deadlineAt }),
      auditLocalDockerConfiguration({ targetId, targetKind: targetConfig.kind }),
    ]);
    return [...repository, ...pingOne, ...pingFederate, ...runtime, ...docker].map((item) => ({ ...item, target: item.target || targetId }));
  }

  return { auditTarget, auditRepositoryContracts, auditPingOneConfiguration, auditPingFederateConfiguration, auditRuntimeTarget, auditLocalDockerConfiguration };
}

const defaults = createAuditService();
module.exports = { createAuditService, ...defaults };
