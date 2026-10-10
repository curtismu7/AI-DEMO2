'use strict';

/**
 * mcpActorBridge.js
 *
 * Builds the trusted, server-to-server actor-delegation headers the MCP Gateway forwards
 * into the PingOne Authorize decision (ActClientId + MayActSub). PingOne emits a native
 * `act` claim only on hops where the actor token's client_id == the subject's may_act.sub
 * (the resource SpEL that mints it — see docs/ACT_CLAIM_VERIFICATION.md); on the
 * two-exchange final hop the actor is the MCP Exchanger (!= may_act.sub) so no native
 * `act` is emitted, and there is never a native equivalent of may_act. The BFF therefore
 * bridges both on every MCP call it makes to the gateway (HTTP `/mcp` and the WebSocket
 * transport alike).
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
 * @param {{ workloadActorClientId?: string|null, userMayActSub?: string|null }} [opts]
 *   workloadActorClientId — the customer-owned workload agent the BFF verified for
 *   this request, if any.
 *   userMayActSub — the signed-in user's OWN may_act.sub (their consent state, read
 *   from the session user token). When supplied it IS the consent signal: present →
 *   bridged so the PDP's per-user rule (Rule 2.6) can match it against the actor;
 *   empty/absent-as-'' → header OMITTED (bridging a static id here would fabricate
 *   consent). Absent-as-undefined keeps the legacy static resolution for callers
 *   not yet plumbed per-user.
 * @returns {Record<string,string>} headers to merge onto the outbound MCP request
 *   (`X-Act-Client-Id` and `X-May-Act-Sub`), or {} when unconfigured.
 */
function buildActorBridgeHeaders({ workloadActorClientId = null, userMayActSub } = {}) {
  // A workload run on the workload resource: the token's own `act` names the
  // customer's workload agent, so the delegate the gateway is told about must be
  // that same agent. The BFF only sets workloadActorClientId after verifying the
  // signed-in customer owns that agent (routes/agentInvokeRoute.js). On the shared
  // Agent Gateway resource `act` still names the built-in agent, so the bridge
  // must too — hence the audience check.
  if (workloadActorClientId && configStore.getEffective('workload_agent_gateway_audience')) {
    const headers = { 'X-Act-Client-Id': workloadActorClientId };
    if (userMayActSub !== undefined) {
      if (userMayActSub) headers['X-May-Act-Sub'] = userMayActSub;
    } else {
      headers['X-May-Act-Sub'] = workloadActorClientId;
    }
    return headers;
  }
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
    if (userMayActSub !== undefined) {
      // Per-user consent signal (may_act re-architecture, Task 2): '' = the user
      // has not granted (or has revoked) — omit rather than fabricate consent.
      if (userMayActSub) headers['X-May-Act-Sub'] = userMayActSub;
    } else {
      headers['X-May-Act-Sub'] = aiAgentClientId;
    }
  }
  return headers;
}

module.exports = { buildActorBridgeHeaders };
