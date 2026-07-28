'use strict';
/**
 * Audience helpers for the BFF banking resource server surfaces.
 *
 * Login (OIDC) RS — authenticateToken enforces this for ordinary /api/* and the
 * /resource-server "Login RS" tab. Distinct from the MCP gateway audience so the
 * demo can teach audience restriction after RFC 8693 exchange.
 *
 * In-flow RS — gateway / Path B audience the exchanged TX token carries; the
 * dual_token disposition posts to /api/resource-server/identity with this aud.
 */
const configStore = require('../services/configStore');

/** First non-empty comma-separated segment (MCP_GW_RESOURCE_URI may list several). */
function firstAudience(value) {
  if (!value) return '';
  return String(value).split(',').map((s) => s.trim()).filter(Boolean)[0] || '';
}

/** Audience the user's login access token carries (enduser / BFF RS). */
function getBffResourceAudience() {
  return process.env.PINGONE_RESOURCE_BFF_URI ||
    process.env.ENDUSER_AUDIENCE ||
    configStore.getEffective('enduser_audience') ||
    '';
}

/** Audience for the in-flow (gateway TX) resource-server hop. */
function getInFlowResourceAudience() {
  return firstAudience(
    process.env.PINGONE_RESOURCE_MCP_GATEWAY_URI ||
    configStore.getEffective('pingone_resource_mcp_gateway_uri') ||
    configStore.getEffective('mcp_gw_resource_uri') ||
    '',
  );
}

module.exports = { getBffResourceAudience, getInFlowResourceAudience };
