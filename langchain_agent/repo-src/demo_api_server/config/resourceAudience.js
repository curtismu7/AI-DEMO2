'use strict';
/**
 * Single source of truth for the BFF banking resource server's audience.
 *
 * This is the value authenticateToken enforces (middleware/auth.js BFF_RESOURCE_URI) and
 * the audience the user's login access token carries. It is DISTINCT from the MCP server's
 * audience (configStore `pingone_resource_mcp_server_uri`), which only the RFC 8693-exchanged
 * token carries — keeping them separate is the audience-restriction property the demo teaches.
 *
 * Resolution mirrors middleware/auth.js (env first, the actually-enforced value), with the
 * live configStore `enduser_audience` as a final fallback so an admin-set value is honored.
 */
const configStore = require('../services/configStore');

function getBffResourceAudience() {
  return process.env.PINGONE_RESOURCE_BFF_URI ||
    process.env.ENDUSER_AUDIENCE ||
    configStore.getEffective('enduser_audience') ||
    '';
}

module.exports = { getBffResourceAudience };
