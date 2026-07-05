'use strict';

/**
 * mcpActorBridge.js
 *
 * Builds the trusted, server-to-server actor-delegation headers the MCP Gateway forwards
 * into the PingOne Authorize decision (ActClientId + MayActSub). PingOne cannot emit the
 * `act`/`may_act` claims on token-exchange-issued tokens (resource SpEL can't reference the
 * actor token — see docs/ACT_CLAIM_VERIFICATION.md), so the BFF bridges them on every
 * MCP call it makes to the gateway (HTTP `/mcp` and the WebSocket transport alike).
 *
 * The actor presented is always the user's delegate — the AI Agent — so the gateway/authz
 * decision always receives a consistent actor client id. (Historically an ENFORCE_MAY_ACT
 * kill-switch toggled the actor between the AI Agent and the token exchanger for a per-user
 * may_act enforcement path; that path is retired, so the toggle is gone and the AI Agent is
 * unconditionally the actor.) Trusted only because these headers are set BFF→gateway over
 * the internal network; external callers can't reach the endpoint (nor hold the MCP token).
 */

const configStore = require('./configStore');

/**
 * @returns {Record<string,string>} headers to merge onto the outbound MCP request
 *   (`X-Act-Client-Id` and `X-May-Act-Sub`, both the AI Agent), or {} when unconfigured.
 */
function buildActorBridgeHeaders() {
  // The AI Agent (the user's delegate) is the actor. Same resolution order provisioning
  // used, so the bridged value matches the exchanged token's audience.
  const aiAgentClientId =
    process.env.AGENT_MAY_ACT_SUB ||
    configStore.getEffective('agent_may_act_sub') ||
    configStore.getEffective('ai_agent_client_id') ||
    configStore.getEffective('pingone_ai_agent_client_id') ||
    process.env.PINGONE_AI_AGENT_CLIENT_ID ||
    '';

  const headers = {};
  if (aiAgentClientId) {
    headers['X-Act-Client-Id'] = aiAgentClientId;
    headers['X-May-Act-Sub'] = aiAgentClientId;
  }
  return headers;
}

module.exports = { buildActorBridgeHeaders };
