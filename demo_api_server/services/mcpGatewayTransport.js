'use strict';

/**
 * mcpGatewayTransport.js — resolve demo/PingGateway vs AgentCore MCP transport.
 * Split from mcpGatewayClient so bedrock routing tests avoid axios/https deps.
 */

const { isBedrockGatewayEffective, assertBedrockPath } = require('./bedrockPathGate');
const bedrockGatewayClient = require('./bedrockGatewayClient');

// Lazy: the bedrock routing tests load this module without a configStore mock.
function privilegeFirstOn() {
  return require('./configStore').getEffective('ff_mcp_gateway_privilege_first') === 'true';
}

/**
 * @returns {{ kind: 'agentcore'|'demo'|'privilege', url: string }}
 */
function resolveMcpGatewayTransport() {
  if (isBedrockGatewayEffective()) {
    assertBedrockPath('gateway');
    return { kind: 'agentcore', url: bedrockGatewayClient.getAgentCoreGatewayUrl() };
  }
  const { getMcpGatewayHttpUrl } = require('./mcpGatewayClient');
  // 'privilege' is reported so the trace can name the gateway that answered
  // first; the URL still comes from the one chokepoint, which the flag has
  // already redirected (see getMcpGatewayHttpUrl).
  return { kind: privilegeFirstOn() ? 'privilege' : 'demo', url: getMcpGatewayHttpUrl() };
}

/**
 * Route MCP tools/call through the effective gateway (AgentCore or demo/PingGateway).
 */
async function callToolViaResolvedGateway(gatewayUrl, bearerToken, tool, params = {}, opts = {}) {
  if (isBedrockGatewayEffective()) {
    assertBedrockPath('gateway');
    return bedrockGatewayClient.callToolViaAgentCore(bearerToken, tool, params, opts);
  }
  const { callToolViaGateway } = require('./mcpGatewayClient');
  if (!privilegeFirstOn()) {
    return callToolViaGateway(gatewayUrl, bearerToken, tool, params, opts);
  }
  // Privilege-first: the PingOne Privilege AI Gateway owns the Authorization
  // header on its own backend hop — it stamps the Static Token configured on
  // the Agentic App. Sending the user's token there as well would be a foreign
  // app's token to Privilege and is rejected before routing, so the user
  // identity travels in X-Subject-Token instead. That header was measured
  // surviving the hop unmodified (privilege/CURRENT-CONFIGURATION.md,
  // "Backend hop", 2026-09-10); the Agent Gateway end of the bridge is Task 8.
  const extraHeaders = { ...(opts.extraHeaders || {}), 'X-Subject-Token': bearerToken };
  // Stamped at the START: the assembler orders hops by ts, so recording this on
  // completion would draw Privilege AFTER the gateway it sits in front of.
  const startedAt = new Date().toISOString();
  try {
    const result = await callToolViaGateway(gatewayUrl, '', tool, params, { ...opts, extraHeaders });
    recordPrivilegeHop({ startedAt, tool, status: 'ok', decision: { outcome: 'PERMIT' } });
    return result;
  } catch (err) {
    // Only a 403 is Privilege's own policy answer. Anything else is a transport
    // failure, and calling that a denial would put a decision on the reel that
    // nobody made.
    const status = err?.status ?? err?.statusCode ?? err?.response?.status;
    recordPrivilegeHop(status === 403
      ? { startedAt, tool, status: 'denied', decision: { outcome: 'DENY', reason: 'Denied by PingOne Privilege policy' } }
      : { startedAt, tool, status: 'error', error: String(err?.message || err).slice(0, 200) });
    throw err;
  }
}

/**
 * Record the Privilege leg on the transaction record. Deliberately narrow: the
 * BFF can honestly say the call was ROUTED through Privilege and what came
 * back, and nothing about Privilege's internal reasoning — it is a third-party
 * gateway that does not report hops to us.
 *
 * Fail-open by contract, like every other emitter: a dead ledger must never
 * take down a tool call.
 */
function recordPrivilegeHop({ startedAt, tool, status, decision, error }) {
  try {
    require('./transactionHop').emitHop({
      phase: 'privilege.authorize',
      op: tool,
      ts: startedAt,
      status,
      ...(decision ? { decision } : {}),
      ...(error ? { error } : {}),
    });
  } catch { /* never break the request path to record it */ }
}

module.exports = {
  resolveMcpGatewayTransport,
  callToolViaResolvedGateway,
};
