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
  isAgentMediatedTool,
  gatewayAudience,
  allowedScopes,
  gatewayToolNames,
};
