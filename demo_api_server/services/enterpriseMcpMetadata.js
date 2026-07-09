'use strict';

/**
 * enterpriseMcpMetadata.js
 * Shared constants and RFC 9728 extension block for Enterprise-Managed MCP Authorization.
 */

const EXT_ID = 'io.modelcontextprotocol/enterprise-managed-authorization';

/** RFC 9728 extensions block when enterprise-managed auth is advertised. */
function buildExtensionBlock() {
  return { [EXT_ID]: {} };
}

/** True when FF_ENTERPRISE_MANAGED_MCP_AUTH / ff_enterprise_managed_mcp_auth is on. */
function isEnterpriseManagedFlagOn(configStore) {
  const cs = configStore || require('./configStore');
  const v = cs.getEffective('ff_enterprise_managed_mcp_auth');
  return v === true || v === 'true';
}

module.exports = {
  EXT_ID,
  buildExtensionBlock,
  isEnterpriseManagedFlagOn,
};
