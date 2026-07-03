/**
 * routes/scopeAudit.js — PingOne resource & scope audit endpoints.
 *
 * GET  /api/admin/scope-audit/resources   — list resources + scopes from PingOne
 * POST /api/admin/scope-audit/scopes      — create a missing scope on a resource
 */

'use strict';

const express = require('express');
const router = express.Router();
const { getManagementToken } = require('../services/pingOneClientService');
const configStore = require('../services/configStore');
const scopeTopology = require('../services/scopeTopology');
const axios = require('axios');

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

    res.json({ resources: results, environment: envId, region });
  } catch (err) {
    console.error('[scope-audit] Error fetching resources:', err.message);
    const status = err.response?.status || 500;
    res.status(status).json({
      error: err.message,
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
    const status = err.response?.status || 500;
    const detail = err.response?.data?.message || err.message;
    res.status(status).json({ error: detail });
  }
});

module.exports = router;
