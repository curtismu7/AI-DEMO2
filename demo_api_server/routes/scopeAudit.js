/**
 * routes/scopeAudit.js — PingOne resource & scope audit endpoints.
 *
 * GET  /api/admin/scope-audit/resources   — list resources/scopes/grants from PingOne
 * POST /api/admin/scope-audit/scopes      — create a missing scope on a resource
 */

'use strict';

const express = require('express');
const router = express.Router();
const { getManagementToken } = require('../services/pingOneClientService');
const configStore = require('../services/configStore');
const scopeTopology = require('../services/scopeTopology');
const axios = require('axios');
const { normalizeAxiosError } = require('../utils/normalizeAxiosError');

// ── Expected scopes derived from scope-topology.json (the SoT) ───────────────
// Required = native scopes PLUS scopes mirrored onto the resource as an
// RFC 8693 exchange-hop audience (ARCHITECTURE-TRUTHS T-10) — the full set
// bootstrap must provision. Built per request so a topology load failure
// surfaces as a 500 on this endpoint, not a crash at module load (WR-07).
function buildExpectedIndex() {
  return scopeTopology.allResources().map((name) => ({
    sotResource: name,
    names: [name.toLowerCase(), scopeTopology.provisionedResourceName(name).toLowerCase()],
    audience: (scopeTopology.resourceUri(name) || '').toLowerCase(),
    requiredScopes: scopeTopology.resourceScopes(name),
  }));
}

/** Match a PingOne resource to a topology resource by audience or display name */
function matchExpected(resource, expectedIndex) {
  const name = (resource.name || '').toLowerCase();
  const audience = (resource.audience || '').toLowerCase();
  return expectedIndex.find(
    (e) => (audience && e.audience === audience) || e.names.includes(name)
  ) || null;
}

// These are the resource relationships owned by the normal bootstrap and
// reconciliation flow. Keep this audit-only map explicit because the topology
// declares app scopes, while the PingOne grant target is determined by the
// provisioning flow (an app can hold grants on more than one resource).
function buildExpectedApplicationGrants() {
  const resourceScopes = (name) => scopeTopology.resourceScopes(name);
  return [
    {
      topologyApp: 'Super Banking User App',
      grants: [{ sotResource: 'Super Banking API', requiredScopes: scopeTopology.appGrantedScopes('Super Banking User App') }],
    },
    {
      topologyApp: 'Super Banking Admin App',
      grants: [
        { sotResource: 'Super Banking API', requiredScopes: scopeTopology.appGrantedScopes('Super Banking Admin App') },
        { sotResource: 'Super Banking MCP Server', requiredScopes: resourceScopes('Super Banking MCP Server') },
      ],
    },
    {
      topologyApp: 'Super Banking MCP Exchanger',
      grants: [
        { sotResource: 'Super Banking Agent Gateway', requiredScopes: ['agent:invoke'] },
        { sotResource: 'Super Banking MCP Gateway', requiredScopes: resourceScopes('Super Banking MCP Gateway') },
        { sotResource: 'Super Banking MCP Server', requiredScopes: resourceScopes('Super Banking MCP Server') },
      ],
    },
  ];
}

function provisionedAppName(topologyApp) {
  const appNames = scopeTopology._manifest().provisioning?.appNames || {};
  return appNames[topologyApp] || topologyApp;
}

function grantResourceId(grant) {
  return grant.resource?.id || grant.resourceId || (typeof grant.resource === 'string' ? grant.resource : null);
}

function grantScopeNames(grant, scopeNamesById) {
  return (grant.scopes || []).map((scope) => {
    if (typeof scope === 'string') return scopeNamesById[scope] || scope;
    return scope.name || scopeNamesById[scope.id] || scope.id;
  }).filter(Boolean);
}

async function auditApplicationGrants(baseUrl, token, resources, scopesByResourceId, expectedIndex) {
  const applicationsRes = await axios.get(`${baseUrl}/applications`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const applications = applicationsRes.data?._embedded?.applications || [];
  const expectedApplications = buildExpectedApplicationGrants();
  const results = [];

  for (const expectedApp of expectedApplications) {
    const provisionedName = provisionedAppName(expectedApp.topologyApp);
    const application = applications.find(
      (candidate) => (candidate.name || '').toLowerCase() === provisionedName.toLowerCase()
    );
    const grants = [];
    let liveGrants = [];
    if (application) {
      const grantsRes = await axios.get(`${baseUrl}/applications/${application.id}/grants`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      liveGrants = grantsRes.data?._embedded?.grants || [];
    }

    for (const expectedGrant of expectedApp.grants) {
      const resource = resources.find((candidate) => {
        const match = matchExpected(candidate, expectedIndex);
        return match?.sotResource === expectedGrant.sotResource;
      });
      const expectedScopes = expectedGrant.requiredScopes;
      const scopeNamesById = Object.fromEntries(
        (scopesByResourceId[resource?.id] || []).map((scope) => [scope.id, scope.name])
      );
      const matchingLiveGrants = resource
        ? liveGrants.filter((grant) => grantResourceId(grant) === resource.id)
        : [];
      const actualScopes = [...new Set(matchingLiveGrants.flatMap((grant) => grantScopeNames(grant, scopeNamesById)))];
      const missingRequired = expectedScopes.filter((scope) => !actualScopes.includes(scope));
      grants.push({
        sotResource: expectedGrant.sotResource,
        resourceId: resource?.id || null,
        requiredScopes: expectedScopes,
        actualScopes,
        missingRequired,
        allRequiredPresent: Boolean(application && resource && missingRequired.length === 0),
      });
    }

    const allRequiredPresent = grants.every((grant) => grant.allRequiredPresent);
    results.push({
      topologyApp: expectedApp.topologyApp,
      name: application?.name || provisionedName,
      id: application?.id || null,
      status: !application ? 'MISSING' : allRequiredPresent ? 'OK' : 'MISMATCH',
      grants,
      allRequiredPresent,
    });
  }

  return results;
}

// ── GET /resources — list PingOne resources with scopes + expected comparison ─
router.get('/resources', async (_req, res) => {
  try {
    const envId = configStore.getEffective('pingone_environment_id');
    const region = configStore.getEffective('pingone_region') || 'com';
    if (!envId) {
      return res.status(400).json({ error: 'PINGONE_ENVIRONMENT_ID not configured' });
    }

    const token = await getManagementToken();
    const baseUrl = `https://api.pingone.${region}/v1/environments/${envId}`;

    // Fetch all resources
    const resourcesRes = await axios.get(`${baseUrl}/resources`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const resources = resourcesRes.data?._embedded?.resources || [];
    const expectedIndex = buildExpectedIndex();

    // For each resource, fetch its scopes
    const results = [];
    const scopesByResourceId = {};
    for (const r of resources) {
      let scopes = [];
      try {
        const scopesRes = await axios.get(`${baseUrl}/resources/${r.id}/scopes`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        scopes = (scopesRes.data?._embedded?.scopes || []).map(s => ({
          id: s.id,
          name: s.name,
          description: s.description || '',
          resource: r.name,
        }));
      } catch (e) {
        // Some built-in resources don't support scope listing
      }
      scopesByResourceId[r.id] = scopes;

      const expected = matchExpected(r, expectedIndex);
      const scopeNames = scopes.map(s => s.name);
      const missingRequired = expected
        ? expected.requiredScopes.filter(s => !scopeNames.includes(s))
        : [];

      results.push({
        id: r.id,
        name: r.name,
        audience: r.audience || null,
        type: r.type || 'CUSTOM',
        scopes,
        expected: expected
          ? {
              sotResource: expected.sotResource,
              requiredScopes: expected.requiredScopes,
              optionalScopes: [],
              missingRequired,
              missingOptional: [],
              allRequiredPresent: missingRequired.length === 0,
            }
          : null,
      });
    }

    const applications = await auditApplicationGrants(baseUrl, token, resources, scopesByResourceId, expectedIndex);
    const applicationSummary = {
      total: applications.length,
      aligned: applications.filter((application) => application.status === 'OK').length,
      missing: applications.filter((application) => application.status === 'MISSING').length,
      mismatched: applications.filter((application) => application.status === 'MISMATCH').length,
      allRequiredPresent: applications.every((application) => application.allRequiredPresent),
    };

    res.json({ resources: results, applications, applicationSummary, environment: envId, region });
  } catch (err) {
    console.error('[scope-audit] Error fetching resources:', err.message);
    const n = normalizeAxiosError(err, { label: 'PingOne scope audit' });
    const status = n.httpStatus || 500;
    res.status(status).json({
      error: n.message,
      hint: status === 401
        ? 'Management worker credentials may be invalid. Check PINGONE_MGMT_CLIENT_ID/SECRET.'
        : undefined,
    });
  }
});

// ── POST /scopes — create a scope on a resource ─────────────────────────────
router.post('/scopes', async (req, res) => {
  try {
    const { resourceId, scopeName, description } = req.body;
    if (!resourceId || !scopeName) {
      return res.status(400).json({ error: 'resourceId and scopeName are required' });
    }

    const envId = configStore.getEffective('pingone_environment_id');
    const region = configStore.getEffective('pingone_region') || 'com';
    const token = await getManagementToken();
    const url = `https://api.pingone.${region}/v1/environments/${envId}/resources/${resourceId}/scopes`;

    const result = await axios.post(url, {
      name: scopeName,
      description: description || `${scopeName} scope`,
    }, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    res.json({ created: true, scope: result.data });
  } catch (err) {
    console.error('[scope-audit] Error creating scope:', err.response?.data || err.message);
    const n = normalizeAxiosError(err, { label: 'PingOne scope audit' });
    const status = n.httpStatus || 500;
    const detail = n.message;
    res.status(status).json({ error: detail });
  }
});

module.exports = router;
