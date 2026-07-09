'use strict';

/**
 * mcpGatewayTransport.js — resolve demo/PingGateway vs AgentCore MCP transport.
 * Split from mcpGatewayClient so bedrock routing tests avoid axios/https deps.
 */

const { isBedrockGatewayEffective, assertBedrockPath } = require('./bedrockPathGate');
const bedrockGatewayClient = require('./bedrockGatewayClient');

/**
 * @returns {{ kind: 'agentcore'|'demo', url: string }}
 */
function resolveMcpGatewayTransport() {
  if (isBedrockGatewayEffective()) {
    assertBedrockPath('gateway');
    return { kind: 'agentcore', url: bedrockGatewayClient.getAgentCoreGatewayUrl() };
  }
  const { getMcpGatewayHttpUrl } = require('./mcpGatewayClient');
  return { kind: 'demo', url: getMcpGatewayHttpUrl() };
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
  return callToolViaGateway(gatewayUrl, bearerToken, tool, params, opts);
}

module.exports = {
  resolveMcpGatewayTransport,
  callToolViaResolvedGateway,
};
