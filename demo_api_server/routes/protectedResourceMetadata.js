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
const { buildExtensionBlock, isEnterpriseManagedFlagOn } = require('../services/enterpriseMcpMetadata');

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

  if (isEnterpriseManagedFlagOn()) {
    doc.extensions = buildExtensionBlock();
  }

  return doc;
}

// GET / — served at /.well-known/oauth-protected-resource
router.get('/', (req, res) => {
  res.json(buildMetadata(req));
});

/**
 * Client discovers this API's protected-resource metadata — which
 * authorization server issues its tokens and which scopes it accepts.
 *
 * @flow resource-metadata
 * @rfc https://datatracker.ietf.org/doc/html/rfc9728 RFC 9728
 * @why Protected Resource Metadata (RFC 9728) lets an API publish a .well-known document declaring which authorization server issues its tokens and which scopes it accepts. Clients discover how to authorize against a resource instead of being hand-configured for it.
 * @example This is how MCP authorization bootstraps: an MCP client hits a protected server, gets a 401 pointing at the resource metadata, reads which authorization server to use, and starts the right OAuth flow — zero out-of-band setup. Like a door that lists which badge office issues the badges it accepts.
 * @ai Agents connect to tool servers they have never seen before. Discovery metadata is what lets that happen safely at runtime instead of via config files written by a human in advance.
 * @actor client-app
 * @to resource-server
 * @step 1
 */
router.get('/metadata', (req, res) => {
  res.json(buildMetadata(req));
});

/**
 * Client extends discovery to every downstream MCP resource server so it can
 * see the full set of authorization servers and scopes across the chain
 * before attempting a token request.
 *
 * @flow resource-metadata
 * @actor client-app
 * @to resource-server
 * @step 2
 *
 * GET /all — served at /api/rfc9728/all. Fetches RFC 9728 metadata from BFF
 * (self) and all downstream MCP services. Each entry includes a _status
 * field: "ok" | "unreachable" | "error"
 */
router.get('/all', async (req, res) => {
  const TIMEOUT_MS = 3000;
  const services = [
    { key: 'mcp_olb',    url: `http://localhost:${process.env.MCP_SERVER_PORT   || 8080}/.well-known/oauth-protected-resource` },
    { key: 'mcp_gw',     url: `http://localhost:${process.env.MCP_GW_PORT       || 3005}/.well-known/oauth-protected-resource` },
    { key: 'mcp_resource_server', url: `http://localhost:${process.env.MCP_RESOURCE_SERVER_PORT   || 8081}/.well-known/oauth-protected-resource` },
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
module.exports.buildMetadata = buildMetadata;
