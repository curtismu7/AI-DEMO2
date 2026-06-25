/**
 * Agent Tool Call Service
 * Handles tool invocation via Agent Gateway with agent CC token only
 * Per i4ai-ref-arch.mmd steps 14–18: Tool call → 403 Deny (no subject token)
 */

'use strict';

const axios = require('axios');
const configStore = require('./configStore');

/**
 * Default Agent Gateway URL (local testing)
 */
const DEFAULT_GATEWAY_URL = process.env.AGENT_GATEWAY_URL || 'http://localhost:8080';

/**
 * Call a tool via Agent Gateway using only agent CC token
 * This represents steps 14–18 in the i4ai diagram:
 *   - Agent sends tools/call with CC token only (no user subject token)
 *   - Agent Gateway calls Ping Authorize
 *   - Ping Authorize introspects token and checks scope
 *   - Returns 403 if user context (subject token) is required
 *
 * @param {object} req - Express request (for token events, logging)
 * @param {string} toolName - Name of the tool to call (e.g., 'check_balance')
 * @param {object} params - Tool parameters (e.g., { account_id: '...' })
 * @param {string} agentCCToken - Agent client credentials token from PingOne
 * @param {object} options - Override defaults
 *   - gatewayUrl: Agent Gateway URL
 *   - timeout: Request timeout in ms (default: 10000)
 * @returns {Promise<{
 *   success: boolean,
 *   result?: any,
 *   error?: string,
 *   requiresUserContext?: boolean,
 *   requiredScope?: string,
 *   resource?: string,
 *   tokenEvents?: Array
 * }>}
 * @throws {Error} On network errors, timeout, or fatal authorization failures
 */
async function callToolWithAgentToken(req, toolName, params, agentCCToken, options = {}) {
  const {
    gatewayUrl = configStore.getEffective('agent_gateway_url') || DEFAULT_GATEWAY_URL,
    timeout = 10000,
  } = options;

  if (!toolName) {
    const err = new Error('Tool name required');
    err.code = 'missing_tool_name';
    err.httpStatus = 400;
    throw err;
  }

  if (!agentCCToken) {
    const err = new Error('Agent CC token required to call tool');
    err.code = 'missing_agent_token';
    err.httpStatus = 400;
    throw err;
  }

  const toolCallUrl = `${gatewayUrl}/tools/call`;
  const tokenEvents = [];

  try {
    // Build tools/call JSON-RPC 2.0 request (step 14)
    const rpcPayload = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: params || {},
      },
    };

    const headers = {
      'Authorization': `Bearer ${agentCCToken}`,
      'Content-Type': 'application/json',
    };

    if (req?.recordTokenEvent) {
      req.recordTokenEvent('tool_call_request_started', {
        toolName,
        params: Object.keys(params || {}),
      });
    }

    console.log(`[agentToolCallService] Calling tool "${toolName}" via gateway with agent CC token`);

    // Send tools/call to Agent Gateway (step 14)
    const response = await axios.post(toolCallUrl, rpcPayload, {
      headers,
      timeout,
    });

    // Handle JSON-RPC 2.0 response
    if (response.data.error) {
      const errorCode = response.data.error.code || 'tool_call_error';
      const errorMessage = response.data.error.message || 'Unknown error';
      const errorData = response.data.error.data || {};

      console.log(`[agentToolCallService] Tool call returned error: ${errorCode} - ${errorMessage}`);

      // Check if error is authorization denial (403 from Ping Authorize) — step 17
      if (errorCode === 'insufficient_scope') {
        // Step 16–17: Ping Authorize denied because token lacks scope and subject
        const parseResult = parseAuthDenialError(errorCode, errorMessage, errorData);

        if (req?.recordTokenEvent) {
          req.recordTokenEvent('agent_authorization_check', {
            decision: 'DENY',
            reason: parseResult.reason,
            requiredScope: parseResult.requiredScope,
            resource: parseResult.resource,
          });
        }

        // Return structured response (step 18: Agent → Chatbot)
        return {
          success: false,
          requiresUserContext: true,
          requiredScope: parseResult.requiredScope,
          resource: parseResult.resource,
          error: 'insufficient_scope',
          message: parseResult.userMessage,
          tokenEvents: [...tokenEvents],
        };
      }

      // Other errors (invalid tool name, policy failure, etc.)
      if (req?.recordTokenEvent) {
        req.recordTokenEvent('tool_call_failed', {
          toolName,
          error: errorCode,
          message: errorMessage,
        });
      }

      const err = new Error(`Tool call failed: ${errorMessage}`);
      err.code = errorCode;
      err.httpStatus = 502;
      err.tokenEvents = tokenEvents;
      throw err;
    }

    // Success case: tool executed
    const toolResult = response.data.result;

    if (req?.recordTokenEvent) {
      req.recordTokenEvent('tool_call_success', {
        toolName,
        resultType: typeof toolResult,
      });
    }

    // Parse token events from gateway if present
    if (response.data.result?.tokenEvents) {
      tokenEvents.push(...response.data.result.tokenEvents);
    }

    return {
      success: true,
      result: toolResult,
      tokenEvents,
    };
  } catch (error) {
    // Re-throw with token events attached
    if (error.code && error.httpStatus) {
      error.tokenEvents = tokenEvents;
      throw error;
    }

    const statusCode = error.response?.status || 502;
    const message = error.response?.data?.error?.message || error.message;

    console.error(`[agentToolCallService] Error calling tool: ${message}`);

    if (req?.recordTokenEvent) {
      req.recordTokenEvent('tool_call_error', {
        toolName,
        error: error.code || 'gateway_error',
        message,
      });
    }

    const err = new Error(`Failed to call tool via Agent Gateway: ${message}`);
    err.code = 'tool_call_failed';
    err.httpStatus = statusCode;
    err.originalError = error.message;
    err.tokenEvents = tokenEvents;
    throw err;
  }
}

/**
 * Parse authorization denial error from Ping Authorize
 * Extracts required scope, resource/audience, and user-friendly message
 *
 * @param {string} errorCode - Error code from gateway (e.g., 'insufficient_scope')
 * @param {string} errorMessage - Error message from gateway
 * @param {object} errorData - Detailed error data from gateway
 * @returns {{ requiredScope, resource, reason, userMessage }}
 */
function parseAuthDenialError(errorCode, errorMessage, errorData = {}) {
  // Default values
  let requiredScope = 'read';
  let resource = 'agent1';
  let reason = 'insufficient_scope: no subject token';
  let userMessage = 'User context required to access this information.';

  // Extract from error message
  if (errorMessage.includes('balance')) {
    requiredScope = 'read';
    userMessage = 'User context required to access account balance information.';
  }
  if (errorMessage.includes('transfer') || errorMessage.includes('write')) {
    requiredScope = 'write';
    userMessage = 'User context required to perform this transaction.';
  }

  // Extract from error data (Ping Authorize response)
  if (errorData.required_scope) {
    requiredScope = errorData.required_scope;
  }
  if (errorData.required_scopes && Array.isArray(errorData.required_scopes)) {
    requiredScope = errorData.required_scopes[0] || requiredScope;
  }
  if (errorData.aud) {
    resource = errorData.aud;
  }
  if (errorData.resource) {
    resource = errorData.resource;
  }
  if (errorData.reason) {
    reason = errorData.reason;
  }

  return {
    requiredScope,
    resource,
    reason,
    userMessage,
  };
}

/**
 * Call a tool via Agent Gateway using delegated token (with user context)
 * This represents steps 28–34 in the i4ai diagram (Phase 3):
 *   - Agent sends tools/call with TX token (has sub=user, act=agent1)
 *   - Agent Gateway calls Ping Authorize
 *   - Ping Authorize validates token and scope
 *   - Returns PERMIT (not 403) because token has subject + actor + scope
 *   - Gateway exchanges TX → MCP token
 *
 * @param {object} req - Express request (for token events, logging)
 * @param {string} toolName - Name of the tool to call (e.g., 'check_balance')
 * @param {object} params - Tool parameters (e.g., { account_id: '...' })
 * @param {string} txToken - Delegated transaction token from RFC 8693 exchange
 * @param {object} options - Override defaults
 *   - gatewayUrl: Agent Gateway URL
 *   - timeout: Request timeout in ms (default: 10000)
 * @returns {Promise<{
 *   success: boolean,
 *   result?: any,
 *   error?: string,
 *   tokenEvents?: Array
 * }>}
 * @throws {Error} On network errors, timeout, or authorization failures
 */
async function callToolWithDelegatedToken(req, toolName, params, txToken, options = {}) {
  const {
    gatewayUrl = require('./configStore').getEffective('agent_gateway_url') || DEFAULT_GATEWAY_URL,
    timeout = 10000,
  } = options;

  if (!toolName) {
    const err = new Error('Tool name required');
    err.code = 'missing_tool_name';
    err.httpStatus = 400;
    throw err;
  }

  if (!txToken) {
    const err = new Error('Delegated token (TX token) required to call tool');
    err.code = 'missing_tx_token';
    err.httpStatus = 400;
    throw err;
  }

  const toolCallUrl = `${gatewayUrl}/tools/call`;
  const tokenEvents = [];

  try {
    // Build tools/call JSON-RPC 2.0 request (step 28)
    const rpcPayload = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: params || {},
      },
    };

    const headers = {
      'Authorization': `Bearer ${txToken}`,
      'Content-Type': 'application/json',
    };

    if (req?.recordTokenEvent) {
      req.recordTokenEvent('tool_call_with_delegated_token_started', {
        toolName,
        params: Object.keys(params || {}),
        tokenType: 'TX (delegated)',
      });
    }

    console.log(`[agentToolCallService] Calling tool "${toolName}" via gateway with delegated TX token`);

    // Send tools/call to Agent Gateway (step 28)
    const response = await axios.post(toolCallUrl, rpcPayload, {
      headers,
      timeout,
    });

    // Handle JSON-RPC 2.0 response
    if (response.data.error) {
      const errorCode = response.data.error.code || 'tool_call_error';
      const errorMessage = response.data.error.message || 'Unknown error';
      const errorData = response.data.error.data || {};

      console.log(`[agentToolCallService] Tool call returned error: ${errorCode} - ${errorMessage}`);

      // Check for authorization errors with delegated token
      if (errorCode === 'insufficient_scope' || errorCode === 'invalid_grant') {
        if (req?.recordTokenEvent) {
          req.recordTokenEvent('delegated_tool_call_denied', {
            toolName,
            error: errorCode,
            message: errorMessage,
            reason: 'token_validation_failed',
          });
        }

        const err = new Error(`Tool call denied: ${errorMessage}`);
        err.code = errorCode;
        err.httpStatus = 403;
        err.tokenEvents = tokenEvents;
        throw err;
      }

      // Other errors
      if (req?.recordTokenEvent) {
        req.recordTokenEvent('delegated_tool_call_failed', {
          toolName,
          error: errorCode,
          message: errorMessage,
        });
      }

      const err = new Error(`Tool call failed: ${errorMessage}`);
      err.code = errorCode;
      err.httpStatus = 502;
      err.tokenEvents = tokenEvents;
      throw err;
    }

    // Success case: tool executed with delegated token (Phase 3)
    const toolResult = response.data.result;

    if (req?.recordTokenEvent) {
      req.recordTokenEvent('delegated_tool_call_success', {
        toolName,
        resultType: typeof toolResult,
      });
    }

    // Parse token events from gateway if present
    if (response.data.result?.tokenEvents) {
      tokenEvents.push(...response.data.result.tokenEvents);
    }

    console.log(`[agentToolCallService] Tool "${toolName}" executed successfully with delegated token`);

    return {
      success: true,
      result: toolResult,
      tokenEvents,
    };
  } catch (error) {
    // Re-throw with token events attached
    if (error.code && error.httpStatus) {
      error.tokenEvents = tokenEvents;
      throw error;
    }

    const statusCode = error.response?.status || 502;
    const message = error.response?.data?.error?.message || error.message;

    console.error(`[agentToolCallService] Error calling tool with delegated token: ${message}`);

    if (req?.recordTokenEvent) {
      req.recordTokenEvent('delegated_tool_call_error', {
        toolName,
        error: error.code || 'gateway_error',
        message,
      });
    }

    const err = new Error(`Failed to call tool with delegated token: ${message}`);
    err.code = 'delegated_tool_call_failed';
    err.httpStatus = statusCode;
    err.originalError = error.message;
    err.tokenEvents = tokenEvents;
    throw err;
  }
}

module.exports = {
  callToolWithAgentToken,
  callToolWithDelegatedToken,
  parseAuthDenialError,
};
