/**
 * Agent Gateway Client
 * Calls Agent Gateway to discover available tools
 * Per i4ai-ref-arch.mmd steps 5–10: Request tools/list with policy-gated filtering
 */

'use strict';

const axios = require('axios');
const configStore = require('./configStore');
const { decodeJwt } = require('../utils/tokenUtils');
const { buildTokenEvent } = require('./agentMcpTokenService');

/**
 * Default Agent Gateway URL (local testing)
 */
const DEFAULT_GATEWAY_URL = process.env.AGENT_GATEWAY_URL || 'http://localhost:8080';

/**
 * Get available tools from Agent Gateway
 * Per i4ai-ref-arch.mmd steps 5–10 (updated):
 *   1. Agent sends tools/list to Agent Gateway
 *   2. Agent Gateway calls Ping Authorize with agent CC token
 *   3. Ping Authorize calls MCP to get all available tools
 *   4. MCP returns tool catalog to Ping Authorize
 *   5. Ping Authorize introspects agent token with PingOne
 *   6. PingOne returns token claims (sub, aud, scope)
 *   7. Ping Authorize evaluates fine-grained policy and filters tools by agent's scopes
 *   8. Agent Gateway returns permitted tool list to Agent
 *
 * @param {object} req - Express request (for token events, logging)
 * @param {string} agentCCToken - Agent client credentials token from PingOne
 * @param {object} options - Override defaults
 *   - gatewayUrl: Agent Gateway URL (default: AGENT_GATEWAY_URL or localhost:8080)
 *   - timeout: Request timeout in ms (default: 10000)
 * @returns {Promise<{
 *   tools: Array<{name, description, inputSchema, requiresUserAuth?, requiredScopes?}>,
 *   tokenEvents: Array
 * }>}
 */
async function getAvailableTools(req, agentCCToken, options = {}) {
  const {
    gatewayUrl = configStore.getEffective('agent_gateway_url') || DEFAULT_GATEWAY_URL,
    timeout = 10000,
  } = options;

  if (!agentCCToken) {
    const err = new Error('Agent CC token required to fetch tools');
    err.code = 'missing_agent_token';
    err.httpStatus = 400;
    throw err;
  }

  const toolsListUrl = `${gatewayUrl}/tools/list`;
  const tokenEvents = [];

  try {
    // Call Agent Gateway with JSON-RPC (per i4ai diagram step 5)
    const rpcPayload = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    };

    const headers = {
      'Authorization': `Bearer ${agentCCToken}`,
      'Content-Type': 'application/json',
    };

    if (req?.recordTokenEvent) {
      req.recordTokenEvent('tools_list_request_started', {
        gatewayUrl,
        method: 'tools/list',
      });
    }

    const response = await axios.post(toolsListUrl, rpcPayload, {
      headers,
      timeout,
      validateStatus: () => true
    });

    // Handle JSON-RPC 2.0 response
    if (response.data.error) {
      const errorCode = response.data.error.code || 'tools_list_error';
      const errorMessage = response.data.error.message || 'Unknown error';
      const errorData = response.data.error.data || {};

      if (req?.recordTokenEvent) {
        req.recordTokenEvent('tools_list_failed', {
          error: errorCode,
          message: errorMessage,
          gatewayResponse: errorData.decision || errorData,
        });
      }

      // Check if error is authorization denial (403 from Ping Authorize)
      if (errorCode === 'insufficient_scope' || errorData.decision === 'DENY') {
        const err = new Error(
          `Agent not authorized to list tools: ${errorMessage}. User context required.`
        );
        err.code = 'insufficient_scope';
        err.httpStatus = 403;
        err.tokenEvents = tokenEvents;
        throw err;
      }

      tokenEvents.push(buildTokenEvent(
        'tools-list-failed',
        'MCP tools/list — Agent Gateway',
        'failed',
        null,
        `MCP tools/list failed: ${errorMessage}`,
        { rfc: 'MCP 2025-03-26 §Tools', errorCode, errorMessage },
      ));
      const err = new Error(`Tools list request failed: ${errorMessage}`);
      err.code = errorCode;
      err.httpStatus = 502;
      err.tokenEvents = tokenEvents;
      throw err;
    }

    // Extract tools from response
    const tools = response.data.result?.tools || [];

    // Log gateway response events
    if (req?.recordTokenEvent) {
      req.recordTokenEvent('tools_list_success', {
        toolCount: tools.length,
        toolNames: tools.map(t => t.name),
      });
    }
    tokenEvents.push(buildTokenEvent(
      'tools-list',
      'MCP tools/list — Agent Gateway',
      'success',
      null,
      `Agent Gateway returned ${tools.length} available tool(s) via MCP tools/list.`,
      { rfc: 'MCP 2025-03-26 §Tools', toolCount: tools.length, toolNames: tools.map(t => t.name) },
    ));

    // Parse token events from gateway response if present
    // (Gateway may include introspection and policy evaluation details)
    if (response.data.result?.tokenEvents) {
      tokenEvents.push(...response.data.result.tokenEvents);
    }

    // Normalize tool definitions for client consumption
    const normalizedTools = tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema || {},
      requiresUserAuth: tool.requiresUserAuth !== false, // Default true
      requiredScopes: tool.requiredScopes || ['read'],
      readOnly: tool.readOnly ?? true,
    }));

    return {
      tools: normalizedTools,
      tokenEvents,
    };
  } catch (error) {
    // Re-throw with token events attached
    if (error.code === 'insufficient_scope' || error.httpStatus) {
      error.tokenEvents = tokenEvents;
      throw error;
    }

    const statusCode = error.response?.status || 502;
    const message = error.response?.data?.error?.message || error.message;

    if (req?.recordTokenEvent) {
      req.recordTokenEvent('tools_list_error', {
        error: error.code || 'gateway_request_failed',
        message,
        gatewayUrl,
      });
    }
    tokenEvents.push(buildTokenEvent(
      'tools-list-failed',
      'MCP tools/list — Agent Gateway',
      'failed',
      null,
      `MCP tools/list transport error: ${message}`,
      { rfc: 'MCP 2025-03-26 §Tools', error: error.code || 'gateway_request_failed', gatewayUrl },
    ));

    const err = new Error(`Failed to get tools from Agent Gateway: ${message}`);
    err.code = 'tools_list_failed';
    err.httpStatus = statusCode;
    err.originalError = error.message;
    err.tokenEvents = tokenEvents;
    throw err;
  }
}

/**
 * Get available tools from local catalog (fallback when gateway is unavailable)
 * Used for development, testing, or degraded-mode operation
 */
function getLocalToolsCatalog() {
  // Import BankingToolRegistry from MCP server
  // For now, return minimal catalog
  return [
    {
      name: 'get_my_accounts',
      description: 'Retrieve user bank accounts',
      inputSchema: { type: 'object', properties: {}, required: [] },
      requiresUserAuth: true,
      requiredScopes: ['read'],
      readOnly: true,
    },
    {
      name: 'get_account_balance',
      description: 'Get balance for a specific account',
      inputSchema: {
        type: 'object',
        properties: { account_id: { type: 'string' } },
        required: ['account_id'],
      },
      requiresUserAuth: true,
      requiredScopes: ['read'],
      readOnly: true,
    },
    {
      name: 'get_my_transactions',
      description: 'Retrieve recent transactions',
      inputSchema: { type: 'object', properties: {}, required: [] },
      requiresUserAuth: true,
      requiredScopes: ['read'],
      readOnly: true,
    },
    {
      name: 'transfer_funds',
      description: 'Transfer funds between accounts',
      inputSchema: {
        type: 'object',
        properties: {
          from_account_id: { type: 'string' },
          to_account_id: { type: 'string' },
          amount: { type: 'number' },
        },
        required: ['from_account_id', 'to_account_id', 'amount'],
      },
      requiresUserAuth: true,
      requiredScopes: ['write'],
      readOnly: false,
    },
  ];
}

/**
 * Normalize one tool definition from the gateway's tools/list response.
 * `permitted` marks whether the agent may call it now; `deniedReason` explains
 * a scope denial (undefined when permitted). The UI greys denied chips.
 */
function normalizeTool(tool, permitted) {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema || {},
    requiresUserAuth: tool.requiresUserAuth !== false,
    requiredScopes: tool.requiredScopes || ['read'],
    readOnly: tool.readOnly ?? true,
    vertical: tool.vertical,
    permitted,
    deniedReason: permitted ? undefined : (tool.deniedReason || 'insufficient_scope'),
  };
}

/**
 * Flatten a gateway tools/list result into one list: permitted tools (result.tools)
 * + scope-denied tools (result._meta.deniedTools), each tagged with `permitted`.
 * Vertical-foreign tools were already dropped by the gateway, so they never appear.
 * Pure function — exported for unit testing.
 */
function normalizeGatewayTools(result) {
  const permitted = (result?.tools || []).map((t) => normalizeTool(t, true));
  const denied = (result?._meta?.deniedTools || []).map((t) => normalizeTool(t, false));
  return [...permitted, ...denied];
}

/**
 * Discover the agent's available tools THROUGH THE GATEWAY (WS path), so the
 * gateway's PingOne Authorize per-tool decision (scope + vertical) is applied.
 * Returns the merged permitted + scope-denied list. The per-call `vertical` sets
 * X-Active-Vertical so a vertical switch changes the list.
 *
 * NOTE: this supersedes the legacy HTTP getAvailableTools() (which posted to
 * <url>/tools/list and bypassed the gateway's Authorize filtering).
 *
 * @param {object} req
 * @param {string} agentToken - agent CC/exchanged token (carries the resolved scopes)
 * @param {{ vertical?: string, userSub?: string, correlationId?: string }} [opts]
 * @returns {Promise<{ tools: object[] }>}
 */
async function listAvailableTools(req, agentToken, opts = {}) {
  const { vertical, userSub = null, correlationId } = opts;
  const { mcpListTools, getMcpGatewayWsUrl } = require('./mcpWebSocketClient');
  // Discovery MUST go through the gateway WS so PingOne Authorize filters tools/list
  // by vertical + scope. The plain MCP server (MCP_SERVER_URL) returns ALL tools
  // unfiltered (it delegates filtering to the gateway). Fall back to the default
  // server URL only when no gateway is configured (dev/offline).
  const serverUrl = getMcpGatewayWsUrl() || undefined;
  const result = await mcpListTools(agentToken, userSub, correlationId, { vertical, serverUrl });
  if (req?.recordTokenEvent) {
    const tools = result?.tools || [];
    const denied = result?._meta?.deniedTools || [];
    req.recordTokenEvent('tools_list_success', {
      vertical: vertical || '(global)',
      permittedCount: tools.length,
      deniedCount: denied.length,
      toolNames: tools.map((t) => t.name),
    });
  }
  return { tools: normalizeGatewayTools(result), authzEngine: result?._meta?.authzEngine || null };
}

module.exports = {
  getAvailableTools,
  getLocalToolsCatalog,
  normalizeGatewayTools,
  listAvailableTools,
};
