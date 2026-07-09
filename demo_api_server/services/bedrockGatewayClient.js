'use strict';

/**
 * bedrockGatewayClient.js — MCP tool calls via Amazon Bedrock AgentCore Gateway.
 * P1 stub: validates AWS gate + config; P3 adds live AgentCore HTTP calls.
 */

const { assertBedrockPath, isBedrockGatewayEffective } = require('./bedrockPathGate');

/**
 * Resolve AgentCore Gateway MCP endpoint URL from env.
 * @returns {string}
 */
function getAgentCoreGatewayUrl() {
  const url = (process.env.AGENTCORE_GATEWAY_URL || '').trim().replace(/\/$/, '');
  if (!url) {
    const err = new Error(
      'AgentCore Gateway URL not configured. Set AGENTCORE_GATEWAY_URL in the EKS environment.',
    );
    err.code = 'bedrock_gateway_not_configured';
    err.httpStatus = 503;
    throw err;
  }
  return url;
}

/**
 * Call an MCP tool via AgentCore Gateway (stub until P3 auth bridge + HTTP client).
 * @returns {Promise<{ result: unknown, gwAuditTrail: null }>}
 */
async function callToolViaAgentCore(_bearerToken, _tool, _params = {}, _opts = {}) {
  assertBedrockPath('gateway');
  if (!isBedrockGatewayEffective()) {
    const err = new Error('Bedrock AgentCore Gateway flag is not enabled');
    err.code = 'bedrock_gateway_disabled';
    err.httpStatus = 503;
    throw err;
  }
  getAgentCoreGatewayUrl();
  const err = new Error('AgentCore Gateway MCP client not yet implemented (Phase P3)');
  err.code = 'bedrock_gateway_not_implemented';
  err.httpStatus = 503;
  throw err;
}

module.exports = {
  getAgentCoreGatewayUrl,
  callToolViaAgentCore,
};
