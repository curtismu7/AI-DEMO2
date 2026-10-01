'use strict';

// Live PingOne readback for the readiness audit. Read-only: one
// client-credentials token request, then GETs. Expectations come from
// scope-topology.json, matched by provisioned display name — the same mapping
// scripts/verify-scope-configuration.js --manifest-diff uses. A required
// audience, scope or grant that is absent fails; objects the topology does not
// model are ignored, because a shared environment legitimately holds others.

const scopeTopology = require('./scopeTopology');
const { AUTHORIZE_POLICY_TREE_WAIVER_ID } = require('./demoReadinessAuditService');

const READ_SCOPE = 'p1:read:resource p1:read:resource_scope';
const DECISION_ENDPOINT_KEYS = ['PINGONE_AUTHORIZE_DECISION_ENDPOINT_ID', 'PINGONE_AUTHORIZE_MCP_DECISION_ENDPOINT_ID'];

async function managementToken({ fetchImpl, environmentId, region, clientId, clientSecret, signal }) {
  // The worker app's token-endpoint auth method is per-app configuration and
  // nothing records which; try Basic, then Post on an auth-method rejection.
  for (const method of ['basic', 'post']) {
    const form = new URLSearchParams({ grant_type: 'client_credentials', scope: READ_SCOPE });
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    if (method === 'basic') headers.Authorization = 'Basic ' + Buffer.from(clientId + ':' + clientSecret).toString('base64');
    else { form.set('client_id', clientId); form.set('client_secret', clientSecret); }
    const response = await fetchImpl('https://auth.pingone.' + region + '/' + environmentId + '/as/token',
      { method: 'POST', headers, body: form.toString(), signal });
    const body = await response.json().catch(() => ({}));
    if (body.access_token) return body.access_token;
    if (body.error !== 'invalid_client') break;
  }
  throw new Error('PingOne Management API token request was rejected');
}

/** This environment's Management API base URL, or null when no environment is configured. */
function managementApiBase(env = process.env) {
  return env.PINGONE_ENVIRONMENT_ID
    ? 'https://api.pingone.' + (env.PINGONE_REGION || 'com') + '/v1/environments/' + encodeURIComponent(env.PINGONE_ENVIRONMENT_ID)
    : null;
}

// The base URL and a read token for it.
async function pingOneManagementAccess({ env = process.env, fetchImpl = globalThis.fetch, signal } = {}) {
  const environmentId = env.PINGONE_ENVIRONMENT_ID;
  const clientId = env.PINGONE_WORKER_CLIENT_ID;
  const clientSecret = env.PINGONE_WORKER_CLIENT_SECRET;
  if (!environmentId || !clientId || !clientSecret) throw new Error('PingOne Management API credentials are unavailable');
  const token = await managementToken({ fetchImpl, environmentId, region: env.PINGONE_REGION || 'com', clientId, clientSecret, signal });
  return { token, base: managementApiBase(env) };
}

function createPingOneReader({ env = process.env, fetchImpl = globalThis.fetch, manifest = scopeTopology._manifest() } = {}) {
  return async function readConfiguration({ signal, targetId } = {}) {
    const { token, base } = await pingOneManagementAccess({ env, fetchImpl, signal });
    const headers = { Authorization: 'Bearer ' + token };
    async function list(path, key) {
      const items = [];
      for (let url = base + path + '?limit=100'; url;) {
        // Only ever follow a next link that stays on this environment's API.
        if (!url.startsWith(base + '/')) throw new Error('PingOne Management API returned an unexpected next link');
        const response = await fetchImpl(url, { method: 'GET', headers, signal });
        if (!response.ok) throw new Error('PingOne Management API read returned HTTP ' + response.status);
        const body = await response.json();
        items.push(...(body._embedded?.[key] || []));
        url = body._links?.next?.href || null;
      }
      return items;
    }
    const scopeCache = new Map();
    const scopesOf = (resourceId) => {
      if (!scopeCache.has(resourceId)) scopeCache.set(resourceId, list('/resources/' + encodeURIComponent(resourceId) + '/scopes', 'scopes'));
      return scopeCache.get(resourceId);
    };

    const [resources, applications, decisionEndpoints] = await Promise.all([
      list('/resources', 'resources'), list('/applications', 'applications'), list('/decisionEndpoints', 'decisionEndpoints'),
    ]);
    const resourceNames = manifest.provisioning?.resourceNames || {};
    const appNames = manifest.provisioning?.appNames || {};
    const liveResource = (name) => resources.find((item) => item.name === (resourceNames[name] || name));

    const missingResources = []; const mismatchedAudiences = [];
    const scopeGaps = []; const mirrorGaps = []; const scopeCandidates = [];
    for (const [name, resource] of Object.entries(manifest.resources || {})) {
      const found = liveResource(name);
      if (!found) { missingResources.push(name); continue; }
      if (found.audience !== resource.uri) mismatchedAudiences.push(name);
      const actual = (await scopesOf(found.id)).map((scope) => scope.name);
      const missing = (resource.scopes || []).filter((scope) => !actual.includes(scope));
      const missingMirrored = (resource.mirroredScopes || []).filter((scope) => !actual.includes(scope));
      if (missingMirrored.length) mirrorGaps.push({ resource: name, missingScopes: missingMirrored });
      if (missing.length) {
        scopeGaps.push({ resource: name, missingScopes: missing });
        scopeCandidates.push({
          repairClass: 'pingone-scope-addition', target: targetId,
          object: { id: found.id, kind: 'pingone-resource-scopes', missingScopes: missing },
          current: actual, expected: resource.scopes,
          sourceRef: 'scope-topology.json#resources/' + name + '/scopes',
          operation: 'Create only the uniquely mapped missing PingOne resource scopes: ' + missing.join(', '),
        });
      }
    }

    const missingApps = []; const grantGaps = []; const grantCandidates = [];
    for (const [name, app] of Object.entries(manifest.apps || {})) {
      const expected = app.grantedScopes || [];
      const found = applications.find((item) => item.name === (appNames[name] || name));
      if (!found) { missingApps.push(name); continue; }
      if (!expected.length) continue;
      // Grants carry resource.id + scopes[].id, never names; resolve through
      // the owning resource's scope list.
      const granted = new Set();
      for (const grant of await list('/applications/' + encodeURIComponent(found.id) + '/grants', 'grants')) {
        if (!grant.resource?.id) continue;
        const names = new Map((await scopesOf(grant.resource.id)).map((scope) => [scope.id, scope.name]));
        for (const scope of grant.scopes || []) if (names.has(scope.id)) granted.add(names.get(scope.id));
      }
      const missing = expected.filter((scope) => !granted.has(scope));
      if (missing.length) {
        grantGaps.push({ application: name, missingScopes: missing });
        grantCandidates.push({
          repairClass: 'pingone-app-scope-grant', target: targetId,
          object: { id: found.id, kind: 'pingone-application-grants', missingScopes: missing },
          current: [...granted], expected,
          sourceRef: 'scope-topology.json#apps/' + name + '/grantedScopes',
          operation: 'Add only the uniquely mapped required PingOne application grants: ' + missing.join(', '),
        });
      }
    }

    const configuredEndpoints = DECISION_ENDPOINT_KEYS.filter((key) => env[key]);
    const liveEndpointIds = decisionEndpoints.map((item) => item.id);
    const absentEndpoints = configuredEndpoints.filter((key) => !liveEndpointIds.includes(env[key]));
    const result = (ok, observed, extra = {}) => ({ status: ok ? 'pass' : 'fail', observed, ...extra });

    return {
      audience: result(!missingResources.length && !mismatchedAudiences.length, { missing: missingResources, mismatched: mismatchedAudiences }),
      scope: result(!missingResources.length && !scopeGaps.length, { missingResources, gaps: scopeGaps }, { repairCandidates: scopeCandidates }),
      mirror: result(!missingResources.length && !mirrorGaps.length, { missingResources, gaps: mirrorGaps }),
      appGrant: result(!missingApps.length && !grantGaps.length, { missingApplications: missingApps, gaps: grantGaps }, { repairCandidates: grantCandidates }),
      authorizeEndpoint: configuredEndpoints.length
        ? result(!absentEndpoints.length, { configured: configuredEndpoints, notLive: absentEndpoints })
        : { status: 'blocked', reason: 'no decision endpoint ID is configured (' + DECISION_ENDPOINT_KEYS.join(', ') + ')' },
      // Not readable from the Management API; each needs its own source.
      requiredFlag: { status: 'blocked', reason: 'effective flag readback requires authenticated BFF configuration access' },
      a2aCredential: { status: 'blocked', reason: 'credential presence is not returned by PingOne Management API' },
      parSetting: { status: 'blocked', reason: 'PAR setting readback requires declared application configuration' },
      groupMembership: { status: 'blocked', reason: 'group membership readback requires declared subject/group contracts' },
      registeredToolScope: { status: 'blocked', reason: 'registered Agent Gateway tool scope API is unavailable' },
      policyReadback: {
        status: 'blocked',
        reason: 'complete PingOne Authorize policy-tree read is unavailable with current worker credentials',
        waiver: AUTHORIZE_POLICY_TREE_WAIVER_ID,
      },
    };
  };
}

module.exports = { createPingOneReader, pingOneManagementAccess, managementApiBase };
