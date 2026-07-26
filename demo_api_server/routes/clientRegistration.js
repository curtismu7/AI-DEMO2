/**
 * routes/clientRegistration.js
 *
 * Two route groups:
 *
 *   POST /api/clients/register
 *     Admin-only. Accepts CIMD-style client metadata, calls PingOne Management API
 *     to create an OIDC application, persists metadata locally, and returns the
 *     client's credentials along with its Client ID Metadata Document URL.
 *
 *   GET  /.well-known/oauth-client/:clientId
 *     Public (no auth). Serves the Client ID Metadata Document for a registered
 *     client so that any OAuth AS that supports draft-ietf-oauth-client-id-metadata
 *     can fetch it using the client_id URL as the lookup key.
 */
const express = require('express');
const router  = express.Router();
const { requireAdmin, requireScopes } = require('../middleware/auth');
const pingOneClientService = require('../services/pingOneClientService');
const { PINGONE_OIDC_DEFAULT_SCOPES_SPACE } = require('../config/scopes');
const cimdLmdb = require('../services/lmdb/cimdStore.lmdb');
const { normalizeAxiosError } = require('../utils/normalizeAxiosError');

// ── CIMD document store ───────────────────────────────────────────────────────
// Key: PingOne application id (the opaque client_id from PingOne)
// Value: the CIMD document object
// In-memory Map backed by LMDB (cimdLmdb) so the public .well-known endpoint
// keeps serving registered clients after a restart.
const cimdStore = new Map();

/**
 * Repopulate the in-memory Map from LMDB. Call once at boot (server.js) before
 * the .well-known route serves. Safe when the store is empty (no-op).
 */
function hydrate() {
  try {
    for (const [appId, doc] of cimdLmdb.loadAll()) cimdStore.set(appId, doc);
  } catch (err) {
    console.error('[clientRegistration] CIMD hydrate from LMDB failed:', err.message);
  }
}

// ── POST /api/clients/register ────────────────────────────────────────────────
router.post('/register', requireAdmin, requireScopes(['admin']), async (req, res) => {
  try {
    const {
      client_name,
      client_description,
      application_type,
      grant_types,
      response_types,
      redirect_uris,
      post_logout_redirect_uris,
      token_endpoint_auth_method,
      scope,
      contacts,
      logo_uri,
      client_uri,
      policy_uri,
      tos_uri,
    } = req.body;

    // Basic input validation
    if (!client_name || typeof client_name !== 'string' || client_name.trim().length === 0) {
      return res.status(400).json({ error: 'client_name is required' });
    }
    if (client_name.trim().length > 150) {
      return res.status(400).json({ error: 'client_name must be 150 characters or fewer' });
    }

    // Validate redirect_uris are https (except localhost)
    if (Array.isArray(redirect_uris)) {
      for (const uri of redirect_uris) {
        try {
          const u = new URL(uri);
          if (u.protocol !== 'https:' && u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') {
            return res.status(400).json({ error: `redirect_uri must use HTTPS: ${uri}` });
          }
        } catch {
          return res.status(400).json({ error: `Invalid redirect_uri: ${uri}` });
        }
      }
    }

    const metadata = {
      client_name:                client_name.trim(),
      client_description:         client_description || '',
      application_type:           application_type || 'web',
      grant_types:                Array.isArray(grant_types) ? grant_types : ['authorization_code'],
      response_types:             Array.isArray(response_types) ? response_types : ['code'],
      redirect_uris:              Array.isArray(redirect_uris) ? redirect_uris : [],
      post_logout_redirect_uris:  Array.isArray(post_logout_redirect_uris) ? post_logout_redirect_uris : [],
      token_endpoint_auth_method: token_endpoint_auth_method || 'client_secret_basic',
      scope:                      typeof scope === 'string' ? scope : PINGONE_OIDC_DEFAULT_SCOPES_SPACE,
      contacts:                   Array.isArray(contacts) ? contacts : [],
      logo_uri:                   logo_uri || null,
      client_uri:                 client_uri || null,
      policy_uri:                 policy_uri || null,
      tos_uri:                    tos_uri || null,
    };

    const app = await pingOneClientService.createApplication(metadata);

    // Build the CIMD document (draft-ietf-oauth-client-id-metadata-document §4)
    const baseUrl = process.env.REACT_APP_CLIENT_URL || `https://${req.hostname}`;
    const cimdUrl = `${baseUrl}/.well-known/oauth-client/${app.id}`;

    const cimdDoc = {
      client_id:                  cimdUrl,     // CIMD: client_id IS the document URL
      client_name:                metadata.client_name,
      application_type:           metadata.application_type,
      grant_types:                metadata.grant_types,
      response_types:             metadata.response_types,
      redirect_uris:              metadata.redirect_uris,
      post_logout_redirect_uris:  metadata.post_logout_redirect_uris,
      token_endpoint_auth_method: metadata.token_endpoint_auth_method,
      scope:                      metadata.scope,
      contacts:                   metadata.contacts,
      ...(metadata.logo_uri   && { logo_uri:   metadata.logo_uri }),
      ...(metadata.client_uri && { client_uri: metadata.client_uri }),
      ...(metadata.policy_uri && { policy_uri: metadata.policy_uri }),
      ...(metadata.tos_uri    && { tos_uri:    metadata.tos_uri }),
      // Metadata about the PingOne application backing this registration
      _pingone: {
        environment_id: app.environment?.id,
        application_id: app.id,
      },
    };

    cimdStore.set(app.id, cimdDoc);
    cimdLmdb.put(app.id, cimdDoc);

    return res.status(201).json({
      // Credentials
      pingone_client_id:     app.id,
      client_secret:         app.clientSecret || null,
      // CIMD
      cimd_url:              cimdUrl,
      cimd_document:         cimdDoc,
      // PingOne detail
      pingone_application:   {
        id:   app.id,
        name: app.name,
        type: app.type,
      },
      registered_at: new Date().toISOString(),
    });
  } catch (err) {
    // Normalize so a transport failure (timeout / PingOne unreachable) doesn't
    // leak raw axios internals; an HTTP error keeps PingOne's structured body.
    const n = normalizeAxiosError(err, { label: 'PingOne app registration' });
    console.error('[clientRegistration] register error:', n.message);
    return res.status(n.httpStatus || 500).json({
      error: 'registration_failed',
      detail: n.upstreamBody || n.message,
    });
  }
});

// ── GET /api/clients ──────────────────────────────────────────────────────────
router.get('/', requireAdmin, requireScopes(['admin']), async (req, res) => {
  try {
    const apps = await pingOneClientService.listApplications();
    return res.json({ applications: apps });
  } catch (err) {
    const n = normalizeAxiosError(err, { label: 'PingOne app list' });
    console.error('[clientRegistration] list error:', n.message);
    return res.status(n.httpStatus || 500).json({ error: 'list_failed', detail: n.message });
  }
});

// ── GET /.well-known/oauth-client/:clientId  (public, no auth) ───────────────
// This handler is exported separately and mounted at the root level in server.js.
function wellKnownHandler(req, res) {
  const { clientId } = req.params;
  const doc = cimdStore.get(clientId);
  if (!doc) {
    return res.status(404).json({ error: 'client_not_found' });
  }
  res.setHeader('Content-Type', 'application/json');
  // The CIMD document should be publicly cacheable
  res.setHeader('Cache-Control', 'public, max-age=3600');
  return res.json(doc);
}

module.exports = { router, wellKnownHandler, hydrate };
