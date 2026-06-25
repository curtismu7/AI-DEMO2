'use strict';

// RFC 8693 §2.1: Two-Exchange Delegation Configuration Validation (Phase 56-04)

const configStore = require('./configStore');

/**
 * Collects ALL missing values before throwing so operators see every problem in one message.
 * @returns {{ valid: true, credentials: object, audiences: object }}
 * @throws {Error} code='TWO_EXCHANGE_CONFIG_INVALID', httpStatus=503, isConfigError=true, details.missing[]
 */
function validateTwoExchangeConfig() {
  const cs = configStore;
  const missing = [];

  const aiAgentClientId =
    cs.getEffective('pingone_ai_agent_client_id') ||
    process.env.PINGONE_AI_AGENT_CLIENT_ID;
  if (!aiAgentClientId) missing.push('PINGONE_AI_AGENT_CLIENT_ID');

  const aiAgentClientSecret =
    cs.getEffective('pingone_ai_agent_client_secret') ||
    process.env.PINGONE_AI_AGENT_CLIENT_SECRET;
  if (!aiAgentClientSecret) missing.push('PINGONE_AI_AGENT_CLIENT_SECRET');

  const mcpClientId =
    cs.getEffective('pingone_mcp_token_exchanger_client_id') ||
    process.env.PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID ||
    process.env.AGENT_OAUTH_CLIENT_ID;
  if (!mcpClientId) missing.push('AGENT_OAUTH_CLIENT_ID (or PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_ID)');

  const mcpClientSecret =
    cs.getEffective('pingone_mcp_token_exchanger_client_secret') ||
    process.env.PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_SECRET ||
    process.env.AGENT_OAUTH_CLIENT_SECRET;
  if (!mcpClientSecret) missing.push('AGENT_OAUTH_CLIENT_SECRET (or PINGONE_MCP_TOKEN_EXCHANGER_CLIENT_SECRET)');

  const agentGatewayAud =
    cs.getEffective('pingone_resource_agent_gateway_uri') ||
    process.env.PINGONE_RESOURCE_AGENT_GATEWAY_URI ||
    process.env.AGENT_GATEWAY_AUDIENCE;
  if (!agentGatewayAud) missing.push('PINGONE_RESOURCE_AGENT_GATEWAY_URI');

  const mcpGatewayAud =
    cs.getEffective('pingone_resource_mcp_gateway_uri') ||
    process.env.PINGONE_RESOURCE_MCP_GATEWAY_URI;
  if (!mcpGatewayAud) missing.push('PINGONE_RESOURCE_MCP_GATEWAY_URI');

  const intermediateAud =
    cs.getEffective('ai_agent_intermediate_audience') ||
    process.env.AI_AGENT_INTERMEDIATE_AUDIENCE;
  if (!intermediateAud) missing.push('AI_AGENT_INTERMEDIATE_AUDIENCE');

  const finalAud =
    cs.getEffective('pingone_resource_two_exchange_uri') ||
    process.env.PINGONE_RESOURCE_TWO_EXCHANGE_URI;
  if (!finalAud) missing.push('PINGONE_RESOURCE_TWO_EXCHANGE_URI');

  if (missing.length > 0) {
    const err = new Error(
      `Two-Exchange Delegation misconfigured. Missing: ${missing.join(', ')}.\n\n` +
      `Remediation Steps:\n` +
      `  1. Set missing environment variables in demo_api_server/.env\n` +
      `  2. Restart the BFF server\n` +
      `  3. Verify all PingOne resource server URIs are correct`
    );
    err.code = 'TWO_EXCHANGE_CONFIG_INVALID';
    err.httpStatus = 503;
    err.isConfigError = true;
    err.details = { missing };
    throw err;
  }

  if (intermediateAud && finalAud && intermediateAud === finalAud) {
    console.warn('[validateTwoExchangeConfig] intermediateAud === finalAud — both exchanges target the same audience');
  }

  return {
    valid: true,
    credentials: { aiAgentClientId, aiAgentClientSecret, mcpClientId, mcpClientSecret },
    audiences: { agentGatewayAud, intermediateAud, mcpGatewayAud, finalAud },
  };
}

module.exports = { validateTwoExchangeConfig };
