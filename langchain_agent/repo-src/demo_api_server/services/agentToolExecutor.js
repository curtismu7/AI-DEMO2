/**
 * Agent Tool Executor
 * Wraps tool invocation with Phase 2-3 token exchange
 * Handles: CC token attempt → 403 DENY → subject token exchange → delegated call
 */

'use strict';

const agentToolCallService = require('./agentToolCallService');
const rfc8693TokenExchangeService = require('./rfc8693TokenExchangeService');
const agentCCTokenService = require('./agentCCTokenService');

/**
 * Execute a tool with optional token exchange
 *
 * Phase 2-3 flow:
 * 1. Get CC token
 * 2. Attempt tool call with CC token
 * 3. If 403 requiresUserContext, return error
 * 4. On retry with subjectToken, exchange tokens (RFC 8693)
 * 5. Retry tool call with delegated TX token
 *
 * @param {object} req - Express request (for token tracking)
 * @param {string} toolName - Tool to invoke
 * @param {object} params - Tool parameters
 * @param {object} agentContext - Agent context with tokens
 * @returns {Promise<object>} Tool result or error
 */
async function executeTool(req, toolName, params, agentContext = {}) {
  const { userId, accessToken, subjectToken } = agentContext;

  console.log(`[agentToolExecutor] Executing tool: ${toolName}`);

  // ── Phase 2: Attempt with CC token only ──────────────────────────────────
  let ccToken;
  try {
    ccToken = await agentCCTokenService.getAgentCCToken(req);
    console.log('[agentToolExecutor] CC token obtained for tool call');
  } catch (ccErr) {
    console.error('[agentToolExecutor] CC token failed (critical):', ccErr.message);
    throw new Error(`Agent token unavailable: ${ccErr.message}`, { cause: ccErr });
  }

  try {
    console.log(`[agentToolExecutor] Attempting Phase 2: tool call with CC token`);
    const phase2Result = await agentToolCallService.callToolWithAgentToken(
      req,
      toolName,
      params,
      ccToken.access_token
    );

    // Phase 2 succeeded (no auth required for this tool)
    if (phase2Result.success) {
      console.log(`[agentToolExecutor] Phase 2 succeeded, returning result`);
      return phase2Result;
    }

    // Phase 2 returned 403 requiresUserContext
    if (phase2Result.requiresUserContext) {
      console.log(`[agentToolExecutor] Phase 2 requires user context (403)`);

      // If subject token provided, try Phase 3
      if (subjectToken) {
        console.log(`[agentToolExecutor] Subject token available, attempting Phase 3`);
        return await executeWithDelegatedToken(req, toolName, params, ccToken.access_token, subjectToken);
      }

      // No subject token yet — return requiresUserContext error
      console.log(`[agentToolExecutor] No subject token provided, returning 403`);
      return {
        success: false,
        requiresUserContext: true,
        requiredScope: phase2Result.requiredScope,
        resource: phase2Result.resource,
        message: phase2Result.message,
        error: 'insufficient_scope',
      };
    }

    // Phase 2 failed with other error
    console.warn(`[agentToolExecutor] Phase 2 failed:`, phase2Result.error);
    throw new Error(`Tool call failed: ${phase2Result.error}`);
  } catch (phase2Err) {
    console.error(`[agentToolExecutor] Phase 2 error:`, phase2Err.message);
    throw phase2Err;
  }
}

/**
 * Execute tool with delegated token (Phase 3)
 * @private
 */
async function executeWithDelegatedToken(req, toolName, params, ccToken, subjectToken) {
  try {
    console.log(`[agentToolExecutor] Phase 3: Exchanging tokens for delegated call`);

    // Step 26–27: RFC 8693 token exchange (CC + subject → TX token)
    const exchangeResult = await rfc8693TokenExchangeService.exchangeForAgentGateway(
      req,
      subjectToken,
      ccToken,
      'read', // Default scope; could be parametrized
      toolName // Intent: the tool being called
    );

    console.log(`[agentToolExecutor] Token exchange successful, got TX token`);

    // Step 28–32: Call tool via gateway with delegated TX token
    const delegatedResult = await agentToolCallService.callToolWithDelegatedToken(
      req,
      toolName,
      params,
      exchangeResult.access_token
    );

    if (delegatedResult.success) {
      console.log(`[agentToolExecutor] Phase 3 delegated call succeeded`);
      return delegatedResult;
    }

    console.warn(`[agentToolExecutor] Phase 3 delegated call failed:`, delegatedResult.error);
    throw new Error(`Delegated tool call failed: ${delegatedResult.error}`);
  } catch (phase3Err) {
    console.error(`[agentToolExecutor] Phase 3 error:`, phase3Err.message);
    throw new Error(`Token exchange or delegated call failed: ${phase3Err.message}`, { cause: phase3Err });
  }
}

module.exports = {
  executeTool,
};
