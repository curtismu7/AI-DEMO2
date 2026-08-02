'use strict';

/**
 * Reads the repo-root scope-topology.json — the single source of truth for
 * which scopes each tool requires and whether it is a write tool.
 */

const path = require('path');
const manifest = require(path.join(__dirname, '..', 'scope-topology.json'));

const tools = manifest.tools || {};

/**
 * Returns the required scopes for a tool, or null if the tool is unknown
 * (unknown tools are allowed — they may be non-gateway tools).
 */
function requiredScopesForTool(toolName) {
  if (!toolName) return null;
  const entry = tools[toolName];
  if (!entry) return null;
  return entry.requiredScopes || [];
}

/**
 * Returns true if the tool requires the 'write' scope (mutating operation).
 */
function isWriteTool(toolName) {
  if (!toolName) return false;
  const entry = tools[toolName];
  if (!entry) return false;
  return (entry.requiredScopes || []).includes('write');
}

/**
 * Returns true when the tool requires step-up auth (financial/high-risk operations
 * where an unknown transaction amount should trigger HITL). Returns false for
 * consent-only write tools (book_appointment, checkout, etc.) that have no amount.
 */
function isStepUpTool(toolName) {
  if (!toolName) return false;
  const entry = tools[toolName];
  if (!entry) return false;
  return entry.challengeType === 'step_up';
}

/**
 * Returns true when the tool declares ANY HITL challenge in the SoT (consent or
 * step_up). Used by the no-amount HITL gate so that consent-only write tools
 * (request_time_off, book_appointment, extend_rental) that carry no transaction
 * amount still require human approval — enforcing the SoT's `challengeType`
 * instead of only step-up tools.
 */
function hasChallengeType(toolName) {
  if (!toolName) return false;
  const entry = tools[toolName];
  if (!entry) return false;
  return entry.challengeType === 'consent' || entry.challengeType === 'step_up';
}

/**
 * Returns true when the tool is A2A-delegated — reachable ONLY via specialist
 * delegation. PingOne Authorize (and this mock) DENY it unless the token's act
 * chain shows a specialist delegated by the generalist (depth >= 2).
 */
function isA2aDelegatedTool(toolName) {
  if (!toolName) return false;
  const entry = tools[toolName];
  if (!entry) return false;
  return entry.a2aDelegated === true;
}

/**
 * The tool's A2A least-privilege scope, when scope-topology.json declares one.
 *
 * A2A specialists deliberately present a NARROWER scope than the tool's generic
 * requiredScopes — `records:read` instead of `read` — so the Exchange #2 token
 * carries least privilege (see deriveSpecialistScopes in a2aDelegationService,
 * whose tests encode "least privilege instead of the generic read"). Rule 3
 * only knew requiredScopes, so it denied every A2A call with
 * "insufficient_scope: missing read" AFTER both exchanges had succeeded — the
 * delegation chain worked and the policy rejected it on a scope NAME.
 *
 * @param {string} toolName
 * @returns {string|null}
 */
function a2aDelegatedScope(toolName) {
  if (!toolName) return null;
  const entry = tools[toolName];
  const scope = entry && entry.a2aDelegatedScope;
  return typeof scope === 'string' && scope ? scope : null;
}

/**
 * Returns true when the tool requires agent mediation (an `act` claim).
 * Used by the UC16 impersonation-block rule: tools with this flag DENY
 * when no `act` is present and ff_require_act_for_agent_tools is ON.
 * Returns false for unknown tools (fail-open: don't block non-flagged tools).
 */
function isAgentMediatedTool(toolName) {
  if (!toolName) return false;
  const entry = tools[toolName];
  if (!entry) return false;
  return entry.requiresAgentMediation === true;
}

/**
 * The MCP Gateway resource audience (e.g. "mcpgateway.ping.demo") from the SoT.
 * The authz decision requires the inbound token's aud to include this. Returning
 * it from the manifest keeps the authz server in lock-step with the gateway's
 * validatesAudience instead of a duplicated literal. Returns '' if unset.
 */
function gatewayAudience() {
  return manifest.resources?.['Super Banking MCP Gateway']?.uri || '';
}

/**
 * Backend/upstream audiences the gateway may exchange toward — the anti-bypass
 * (D-05) blacklist. A valid INBOUND token never carries any of these; a client
 * must obtain a gateway-targeted token and let the gateway exchange it for the
 * next hop. Mirrors demo_mcp_gateway GatewayTokenPolicy's upstreamAuds
 * (mcpOlbResourceUri, mcpResourceServerResourceUri, bankingResourceServerResourceUri),
 * sourced from the SoT manifest + env, with the gateway's own URI excluded.
 */
function upstreamAudiences() {
  const r = manifest.resources || {};
  const gw = gatewayAudience();
  return [
    r['Super Banking MCP Server']?.uri,
    r['Super Banking MCP Invest']?.uri,
    process.env.BANKING_RESOURCE_SERVER_RESOURCE_URI || 'https://banking-resource-server.ping.demo',
  ].filter((u) => u && u !== gw);
}

/** The full set of valid scope names declared in the SoT scopes map. */
function allowedScopes() {
  return Object.keys(manifest.scopes || {});
}

/** Names of tools whose surface is the gateway (the editable/enforced set). */
function gatewayToolNames() {
  return Object.keys(tools).filter((name) => tools[name].surface === 'gateway');
}

module.exports = {
  requiredScopesForTool,
  isWriteTool,
  isStepUpTool,
  hasChallengeType,
  isA2aDelegatedTool,
  a2aDelegatedScope,
  isAgentMediatedTool,
  gatewayAudience,
  upstreamAudiences,
  allowedScopes,
  gatewayToolNames,
};
