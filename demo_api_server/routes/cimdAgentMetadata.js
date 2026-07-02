/**
 * routes/cimdAgentMetadata.js — CIMD Client ID Metadata Document publisher.
 *
 *   GET /api/cimd/agents
 *     Lists the topology agents and where each one's metadata document lives.
 *
 *   GET /api/cimd/agents/:slug/client-metadata.json
 *     Public (no auth — an AS must be able to fetch it). Serves the agent's
 *     Client ID Metadata Document (draft-ietf-oauth-client-id-metadata-document),
 *     DERIVED from repo-root scope-topology.json at request time via
 *     services/scopeTopology so it can never drift from the SSOT.
 *
 * PingOne does not support CIMD; these documents are consumed by the demo's
 * mocked AS path (oauthClientRegistry.registerClientByUrl), badged engine:'mock'.
 */
'use strict';

const express = require('express');
const router = express.Router();
const scopeTopology = require('../services/scopeTopology');

/** 'Super Banking AI Agent' -> 'super-banking-ai-agent' */
function slugify(appName) {
  return appName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Topology apps that are agents (the CIMD demo registers agent clients). */
function agentApps() {
  return scopeTopology.allApps().filter((name) => name.includes('Agent'));
}

function findAppBySlug(slug) {
  return agentApps().find((name) => slugify(name) === slug) || null;
}

/** The URL this request arrived on — CIMD §4: doc.client_id IS the doc URL. */
function requestUrl(req) {
  const proto = req.get('x-forwarded-proto') || req.protocol;
  return `${proto}://${req.get('host')}${req.originalUrl}`;
}

/**
 * Base URL under which the BFF can fetch its OWN metadata documents when the
 * inspector triggers a registration. Loopback is deterministic regardless of
 * which proxy/host the browser used; the mock-AS fetcher accepts the demo's
 * self-signed TLS on loopback.
 */
function selfBaseUrl() {
  const scheme = process.env.BFF_LOOPBACK_SCHEME || 'http';
  const port = process.env.PORT || 3001;
  return `${scheme}://127.0.0.1:${port}`;
}

// GET /api/cimd/agents — agent list for the inspector UI.
router.get('/agents', (req, res) => {
  const manifest = scopeTopology._manifest();
  const appNames = (manifest.provisioning && manifest.provisioning.appNames) || {};
  const agents = agentApps().map((app) => {
    const slug = slugify(app);
    const metadataPath = `/api/cimd/agents/${slug}/client-metadata.json`;
    return {
      app,
      slug,
      client_name: appNames[app] || app,
      granted_scopes: scopeTopology.appGrantedScopes(app),
      metadata_path: metadataPath,
      // URL-shaped client_id: the identifier a CIMD registration presents.
      client_id: `${selfBaseUrl()}${metadataPath}`
    };
  });
  res.json({
    mocked: true,
    notice: 'Mocked — PingOne does not yet support CIMD (draft-ietf-oauth-client-id-metadata-document)',
    agents
  });
});

// GET /api/cimd/agents/:slug/client-metadata.json — the metadata document.
router.get('/agents/:slug/client-metadata.json', (req, res) => {
  const app = findAppBySlug(req.params.slug);
  if (!app) {
    return res.status(404).json({ error: 'agent_not_found', slug: req.params.slug });
  }
  const manifest = scopeTopology._manifest();
  const appNames = (manifest.provisioning && manifest.provisioning.appNames) || {};
  const entry = scopeTopology.appEntry(app);

  const doc = {
    // CIMD: the client_id IS this document's URL.
    client_id: requestUrl(req),
    client_name: appNames[app] || app,
    // Only the grants the mock AS can actually issue (client_credentials);
    // topology grantTypes may also list token_exchange, which the real AS
    // (PingOne) handles outside this mocked registration.
    grant_types: (entry.grantTypes || []).filter((g) => g === 'client_credentials'),
    scope: scopeTopology.appGrantedScopes(app).join(' '),
    token_endpoint_auth_method: 'client_secret_basic'
  };

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, max-age=300');
  return res.json(doc);
});

module.exports = router;
