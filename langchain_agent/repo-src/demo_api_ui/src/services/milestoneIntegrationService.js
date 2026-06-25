/**
 * Milestone Integration Service
 * Wires token exchange and agent flow events into the milestonesStore timeline.
 *
 * Usage in bankingAgentService.js (non-React context):
 *   import { trackOidcLogin, trackExchangeStart, trackExchangeComplete, trackToolCall } from './milestoneIntegrationService';
 *
 *   const oidcId = trackOidcLogin();
 *   const exchangeId = trackExchangeStart('1-exchange');
 *   // ... exchange happens ...
 *   trackExchangeComplete(exchangeId, '1-exchange');
 *   const toolId = trackToolCall('BankingApiBalance');
 *   trackBackendOperation('Get Balance', '/api/banking/balance', 'success', 145);
 *   trackFlowComplete();
 */

import {
  addMilestone,
  updateMilestoneStatus,
} from './milestonesStore';

/**
 * Track OIDC login milestone.
 * Call when user is authenticated and about to start agent interaction.
 * @returns {string} milestoneId for future updates
 */
export function trackOidcLogin() {
  return addMilestone('OIDC Authentication', 'oidc_login', {
    description: 'User authenticated via OIDC',
  });
}

/**
 * Track token exchange initiation.
 * Call when /api/exchange-token is about to be invoked.
 * @param {string} exchangePath - '1-exchange' or '2-exchange'
 * @returns {string} milestoneId
 */
export function trackExchangeStart(exchangePath = '1-exchange') {
  return addMilestone('Token Exchange', 'exchange_start', {
    exchangePath,
    description: `Starting ${exchangePath} token exchange`,
  });
}

/**
 * Track token exchange completion.
 * Call after /api/exchange-token succeeds.
 * @param {string} exchangeStartId - milestone ID from trackExchangeStart
 * @param {string} exchangePath - '1-exchange' or '2-exchange'
 * @returns {string} new milestoneId for the completion event
 */
export function trackExchangeComplete(exchangeStartId, exchangePath = '1-exchange') {
  // Mark the start milestone as done
  updateMilestoneStatus(exchangeStartId, 'done', { exchangePath });
  // Add a new completion milestone
  return addMilestone('Exchange Complete', 'exchange_complete', {
    exchangePath,
    description: `Completed ${exchangePath} token exchange`,
  });
}

/**
 * Track MCP tool call.
 * Call when MCP tool is about to be invoked.
 * @param {string} toolName - e.g. 'BankingApiBalance'
 * @returns {string} milestoneId
 */
export function trackToolCall(toolName) {
  return addMilestone(`MCP: ${toolName}`, 'mcp_tool_call', {
    toolName,
    description: `Invoking MCP tool: ${toolName}`,
  });
}

/**
 * Track backend banking API operation.
 * Call when a banking API endpoint completes.
 * @param {string} operationName - e.g. 'Get Account Balance'
 * @param {string} endpoint - e.g. '/api/banking/balance'
 * @param {'success'|'error'} status
 * @param {number} durationMs
 * @returns {string} milestoneId
 */
export function trackBackendOperation(operationName, endpoint, status, durationMs) {
  const id = addMilestone(`API: ${operationName}`, 'backend_operation', {
    operationName,
    endpoint,
    durationMs,
    description: `${status === 'success' ? '✓' : '✕'} ${operationName} (${durationMs}ms)`,
  });
  // Immediately mark as done/error based on status
  updateMilestoneStatus(id, status === 'success' ? 'done' : 'error');
  return id;
}

/**
 * Track flow completion.
 * Call when entire agent flow finishes.
 * @returns {string} milestoneId
 */
export function trackFlowComplete() {
  return addMilestone('Flow Complete', 'flow_complete', {
    description: 'Agent flow complete',
  });
}

const milestoneIntegrationService = {
  trackOidcLogin,
  trackExchangeStart,
  trackExchangeComplete,
  trackToolCall,
  trackBackendOperation,
  trackFlowComplete,
};
export default milestoneIntegrationService;
