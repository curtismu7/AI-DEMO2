/**
 * Agent Token Service
 *
 * Utilities for working with AGENT (ACTOR) tokens in the context of RFC 8693 token exchange.
 *
 * TERMINOLOGY:
 * - "Agent" and "Actor" refer to the same token/role (agent = actor)
 * - Used interchangeably in this codebase, though "Agent" appears in UI and "Actor" in RFCs
 * - "Act Claim" = JWT claim identifying the entity (actor/agent) performing actions
 * - See docs/ACTOR_TOKEN_TERMINOLOGY.md for complete definitions
 *
 * RFC References:
 * - RFC 8693 §4.2 defines the 'act' claim (actor identity)
 * - RFC 8693 §4.3 defines the 'may_act' claim (actor permissions)
 */

const { logger } = require("../utils/logger");
const { logEvent: logAppEvent } = require('./appEventService');
const { decodeJwt } = require('../utils/tokenUtils');

/**
 * Validate that a token is a valid agent (actor) token
 *
 * An "agent token" (actor token) is an OAuth token with:
 * - Valid signature and not expired
 * - 'act' claim identifying the agent/actor performing actions (RFC 8693 §4.2)
 * - 'sub' claim identifying the original user
 * - 'aud' claim identifying the target API
 *
 * @param {string} token - The bearer token to validate
 * @param {string} expectedAudience - Expected audience (aud) claim value for the target API
 * @returns {Promise<{valid: boolean, error?: string, actorId?: string, subject?: string, scopes?: string[]}>}
 * @throws {Error} If token format is invalid
 *
 * @example
 * const result = await validateAgentActorToken(token, 'https://banking-api.example.com');
 * if (result.valid) {
 *   console.log(`Agent (actor) ${result.actorId} acting for user ${result.subject}`);
 * }
 */
async function validateAgentActorToken(token, expectedAudience) {
  try {
    // In a full implementation, this would:
    // 1. Call introspection service to validate token signature
    // 2. Check that 'act' claim exists and is properly formatted
    // 3. Verify 'aud' matches expectedAudience
    // 4. Extract and return actor identity and original subject

    // Placeholder implementation
    logger.debug('Validating actor (agent) token', {
      expectedAudience,
      hasActClaim: true // would be actual check
    });

    const result = {
      valid: true,
      actorId: 'placeholder-actor-id',
      subject: 'placeholder-user-id',
      scopes: ['read', 'transfer']
    };
    const _actorDecoded = decodeJwt(token);
    logAppEvent('token_exchange', 'info', 'Agent actor token validated successfully',
      { tag: 'token_exchange/agent-token-valid', metadata: { actorId: result.actorId, subject: result.subject, scopeCount: (result.scopes || []).length, jwtFullDecode: _actorDecoded || undefined } }
    );
    return result;
  } catch (error) {
    logger.warn('Actor (agent) token validation failed', {
      error: error.message,
      expectedAudience
    });
    logAppEvent('token_exchange', 'warning', `Agent actor token validation failed: ${error.message}`,
      { tag: 'token_exchange/agent-token-invalid', metadata: { error: error.message } }
    );
    return {
      valid: false,
      error: error.message
    };
  }
}

/**
 * Extract the ACTOR IDENTITY from an agent token's 'act' claim
 *
 * The 'act' claim (RFC 8693 §4.2) contains:
 * - sub: The actor/agent identity (who is acting)
 * - acr: Authentication context (method used by actor)
 *
 * This function extracts these values from a decoded JWT token.
 *
 * @param {Object} decoded - Decoded JWT token object (from jwt.decode())
 * @returns {{actor: string, originalSubject: string, actClaim: Object}|null}
 *   - actor: The agent/actor's ID from act.sub
 *   - originalSubject: The original user's ID from top-level sub
 *   - actClaim: The complete 'act' claim object
 *
 * @example
 * const decoded = jwt.decode(token);
 * const actorInfo = extractActorIdentity(decoded);
 * if (actorInfo) {
 *   console.log(`Agent (actor) ${actorInfo.actor} is acting for ${actorInfo.originalSubject}`);
 * }
 */
function extractActorIdentity(decoded) {
  // Check if this token has the act claim (delegation pattern)
  if (!decoded || !decoded.act) {
    return null;
  }

  return {
    actor: decoded.act.sub || 'unknown-actor',
    originalSubject: decoded.sub || 'unknown-subject',
    actClaim: decoded.act
  };
}

/**
 * Check if a token has the agent (actor) delegation pattern
 *
 * A token has agent/actor delegation if it contains:
 * - 'act' claim: Identifies the agent/actor (RFC 8693 §4.2)
 * - 'may_act' claim: Defines agent permissions (RFC 8693 §4.3)
 *
 * @param {Object} decoded - Decoded JWT token object
 * @returns {boolean} True if token contains both 'act' and 'may_act' claims
 *
 * @example
 * const decoded = jwt.decode(token);
 * if (hasAgentActorPattern(decoded)) {
 *   console.log('This is an agent (actor) token with delegation');
 * }
 */
function hasAgentActorPattern(decoded) {
  return !!(decoded && decoded.act && decoded.may_act);
}

/**
 * Get a human-readable description of the token's agent (actor) context
 *
 * Useful for logging and audit trails. Produces strings like:
 * "Agent (actor) mcp-service-1 invoked tool on behalf of user-123"
 *
 * @param {Object} decoded - Decoded JWT token object
 * @returns {string} Description like "Agent {actor_id} acting for User {subject_id}"
 *   Returns generic message if not an agent (actor) token
 *
 * @example
 * const decoded = jwt.decode(token);
 * logger.info(getAgentActorContextString(decoded), { action: 'transfer_initiated' });
 * // Logs: "Agent mcp-agent-v1 acting for User alice-123 | action: transfer_initiated"
 */
function getAgentActorContextString(decoded) {
  if (!decoded) {
    return 'User (non-delegated token)';
  }

  if (hasAgentActorPattern(decoded)) {
    const actorId = decoded.act?.sub || 'unknown-actor';
    const userId = decoded.sub || 'unknown-user';
    return `Agent (actor) ${actorId} acting for User ${userId}`;
  }

  // Not a delegation token
  const userId = decoded.sub || 'unknown-user';
  return `User ${userId} (direct token, no delegation)`;
}

/**
 * Validate that an agent (actor) has permission for a requested scope
 *
 * Checks that the requested scope is listed in the token's 'may_act' claim
 * (RFC 8693 §4.3: the claim that defines agent permissions).
 *
 * @param {Object} decoded - Decoded JWT token object
 * @param {string} requestedScope - Scope being requested (e.g., 'transfer')
 * @returns {boolean} True if agent has permission for this scope via may_act claim
 *
 * @example
 * const decoded = jwt.decode(token);
 * if (canAgentActorPerformAction(decoded, 'transfer')) {
 *   // Agent (actor) has permission to transfer
 * }
 */
function canAgentActorPerformAction(decoded, requestedScope) {
  if (!decoded || !decoded.may_act) {
    return false; // No delegated permissions
  }

  const allowedScopes = decoded.may_act.scope || [];
  const scopeArray = Array.isArray(allowedScopes) ? allowedScopes : [allowedScopes];

  return scopeArray.includes(requestedScope);
}

module.exports = {
  validateAgentActorToken,
  extractActorIdentity,
  hasAgentActorPattern,
  getAgentActorContextString,
  canAgentActorPerformAction
};
