/**
 * routes/protectedResourceMetadata.js
 *
 * Two route groups (shared buildMetadata helper):
 *
 *   GET /
 *     Used when mounted at /.well-known/oauth-protected-resource
 *     Public, no authentication required (RFC 9728 §3)
 *
 *   GET /metadata
 *     Same-origin proxy exposed at /api/rfc9728/metadata
 *     Allows the React UI to fetch the metadata without port-difference
 *     CORS issues in local development.
 *
 * RFC 9728 §3.2 response shape:
 *   resource                    REQUIRED
 *   authorization_servers       OPTIONAL (included when PINGONE_ENVIRONMENT_ID is set)
 *   bearer_methods_supported    OPTIONAL
 *   scopes_supported            RECOMMENDED
 *   resource_name               OPTIONAL
 *   resource_documentation      OPTIONAL
 */

const express = require('express');
const router  = express.Router();

/**
 * Build the RFC 9728 Protected Resource Metadata document.
 * @param {import('express').Request} req
 * @returns {object}
 */
function buildMetadata(req) {
  const host = req.get('host') || null;
  const baseUrl = process.env.PUBLIC_APP_URL ||
    (host ? `${req.protocol}://${host}` : 'https://demo-api-server:3001');

  const envId  = process.env.PINGONE_ENVIRONMENT_ID || '';
  const region = process.env.PINGONE_REGION || 'com';
  const asList = envId
    ? [`https://auth.pingone.${region}/${envId}/as`]
    : [];

  const doc = {
    resource: `${baseUrl}/api`,
    bearer_methods_supported: ['header'],
    scopes_supported: [
      'read',
      'write',
      'admin',
      'accounts:read',
      'transactions:read',
      'transactions:write',
      'mortgage:read',
    ],
    resource_name: 'Super Banking Banking API',
    resource_documentation: 'https://datatracker.ietf.org/doc/html/rfc9728',
  };

  if (asList.length > 0) {
    doc.authorization_servers = asList;
  }

  return doc;
}

// GET / — served at /.well-known/oauth-protected-resource
router.get('/', (req, res) => {
  res.json(buildMetadata(req));
});

// GET /metadata — served at /api/rfc9728/metadata
router.get('/metadata', (req, res) => {
  res.json(buildMetadata(req));
});

/**
 * GET /all — served at /api/rfc9728/all
 * Fetches RFC 9728 metadata from BFF (self) and all downstream MCP services.
 * Each entry includes a _status field: "ok" | "unreachable" | "error"
 */
router.get('/all', async (req, res) => {
  const TIMEOUT_MS = 3000;
  const services = [
    { key: 'mcp_olb',    url: `http://localhost:${process.env.MCP_SERVER_PORT   || 8080}/.well-known/oauth-protected-resource` },
    { key: 'mcp_gw',     url: `http://localhost:${process.env.MCP_GW_PORT       || 3005}/.well-known/oauth-protected-resource` },
    { key: 'mcp_invest', url: `http://localhost:${process.env.MCP_INVEST_PORT   || 8081}/.well-known/oauth-protected-resource` },
  ];

  async function fetchWithTimeout(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const r = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!r.ok) return { _status: 'error', _error: `HTTP ${r.status}` };
      const data = await r.json();
      return { ...data, _status: 'ok' };
    } catch (e) {
      clearTimeout(timer);
      return { _status: e.name === 'AbortError' ? 'unreachable' : 'unreachable', _error: e.message };
    }
  }

  const result = { bff: { ...buildMetadata(req), _status: 'ok' } };
  await Promise.all(
    services.map(async ({ key, url }) => {
      result[key] = await fetchWithTimeout(url);
    })
  );

  res.json(result);
});

module.exports = router;
