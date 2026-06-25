// RFC 8707: Scope-Audience Mapping
// Audience values match docs/PINGONE_CONFIG.md Resource Servers.

const configStore = require('./configStore');

// Called at validation time (not module load) so runtime config changes are reflected.
function buildAllowedScopesByAudience() {
  const mapping = {};

  // enduser.ping.demo — Demo API resource; end-user access token audience
  const endUserAudience = configStore.getEffective('enduser_audience');
  if (endUserAudience) {
    mapping[endUserAudience] = ['read', 'write', 'admin', 'sensitive', 'ai:agent'];
  }

  // agentgateway.ping.demo — Demo Agent Gateway; RFC 8693 Exchange #1 actor token audience
  const agentGatewayUri = configStore.getEffective('pingone_resource_agent_gateway_uri');
  if (agentGatewayUri) {
    mapping[agentGatewayUri] = ['ai:agent', 'ai_agent'];
  }

  // mcpgateway.ping.demo — Demo MCP Gateway; canonical single subject+actor RFC 8693 exchange audience
  const mcpGatewayUri = configStore.getEffective('pingone_resource_mcp_gateway_uri');
  if (mcpGatewayUri) {
    mapping[mcpGatewayUri] = ['read', 'write', 'mcp:invoke', 'ai:agent'];
  }

  // mcpserver.ping.demo — Demo MCP Server; gateway re-exchanges to this audience downstream
  const mcpServerUri = configStore.getEffective('pingone_resource_mcp_server_uri');
  if (mcpServerUri) {
    mapping[mcpServerUri] = ['read', 'write', 'mcp:invoke'];
  }

  return mapping;
}

/**
 * Validate and narrow scopes for a target audience.
 *
 * @param {string|string[]} scopes  OAuth scopes (array or space-separated string)
 * @param {string}          audience  Target resource audience
 * @returns {{ valid: true, scopes: string[], narrowed: boolean }}
 * @throws {Error} SCOPE_ERROR when no scopes provided
 * @throws {Error} SCOPE_MISMATCH when none of the provided scopes are valid for the audience
 *
 * Note on unknown audience: when the audience is not in the configured mapping
 * (e.g. pre-bootstrap or a third-party resource), validation passes with all
 * original scopes and a warning is logged. This is intentional open-fail
 * behavior for audiences this service does not own.
 */
function validateScopeAudience(scopes, audience) {
  // WR-20: coerce a space-separated string to an array so callers don't need to split
  if (typeof scopes === 'string') {
    scopes = scopes.split(/\s+/).filter(Boolean);
  }
  if (!Array.isArray(scopes) || scopes.length === 0) {
    throw new Error(`SCOPE_ERROR: No scopes provided for audience ${audience}`);
  }

  const ALLOWED_SCOPES_BY_AUDIENCE = buildAllowedScopesByAudience();
  const allowedForAudience = ALLOWED_SCOPES_BY_AUDIENCE[audience];
  if (!allowedForAudience) {
    // WR-09: log a warning so operators notice unconfigured audiences rather
    // than silently bypassing RFC 8707 scope enforcement.
    console.warn(
      '[scope-validator] Unknown audience "%s" — not in configured mapping. ' +
      'Scopes not validated. Set the relevant PINGONE_RESOURCE_*_URI env var to enforce.',
      audience
    );
    return {
      valid: true,
      scopes,
      narrowed: false,
      note: `Unknown audience — scopes not validated: ${audience}`,
    };
  }

  const allowedSet = new Set(allowedForAudience);
  const validScopes = scopes.filter(s => allowedSet.has(s));

  if (validScopes.length === 0) {
    throw new Error(
      `SCOPE_MISMATCH: User scopes [${scopes.join(', ')}] ` +
      `do not match allowed scopes for ${audience} ` +
      `[${allowedForAudience.join(', ')}]`
    );
  }

  return { valid: true, scopes: validScopes, narrowed: validScopes.length < scopes.length };
}

module.exports = { buildAllowedScopesByAudience, validateScopeAudience };
