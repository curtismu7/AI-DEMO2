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
 * With ENFORCE_MAY_ACT on (the default), the actor presented IS the user's authorized
 * delegate (the AI Agent) so the gateway policy can require `act.sub === may_act.sub`.
 * Set enforce_may_act=false (kill-switch) to fall back to bridging the exchanger as the
 * actor and the legacy static-actor policy check. Trusted only because these headers are
 * set BFF→gateway over the internal network; external callers can't reach the endpoint
 * (nor hold the MCP token).
 */

const configStore = require('./configStore');

/**
 * @returns {Record<string,string>} headers to merge onto the outbound MCP request
 *   (`X-Act-Client-Id` and/or `X-May-Act-Sub`), or {} when nothing is configured.
 */
function buildActorBridgeHeaders() {
  // The actor the USER authorized (== the user-record may_act.sub). Same
  // resolution order provisioning used, so the bridged value matches the user token.
  const mayActSub =
    process.env.AGENT_MAY_ACT_SUB ||
    configStore.getEffective('agent_may_act_sub') ||
    configStore.getEffective('ai_agent_client_id') ||
    configStore.getEffective('pingone_ai_agent_client_id') ||
    process.env.PINGONE_AI_AGENT_CLIENT_ID ||
    '';
  const exchangerClientId =
    configStore.getEffective('pingone_mcp_token_exchanger_client_id') ||
    process.env.PINGONE_MCP_EXCHANGER_CLIENT_ID ||
    '';
  const enforceMayAct =
    String(configStore.getEffective('enforce_may_act') || process.env.ENFORCE_MAY_ACT || 'true').toLowerCase() !== 'false';

  // Enforcement on → actor is the delegate (AI Agent), matching may_act.sub.
  // Off → actor is the exchanger (legacy static-actor policy).
  const actClientId = (enforceMayAct && mayActSub) ? mayActSub : exchangerClientId;

  const headers = {};
  if (actClientId) headers['X-Act-Client-Id'] = actClientId;
  if (mayActSub) headers['X-May-Act-Sub'] = mayActSub;
  return headers;
}

module.exports = { buildActorBridgeHeaders };
