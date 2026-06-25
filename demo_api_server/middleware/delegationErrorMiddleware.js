/**
 * delegationErrorMiddleware.js
 *
 * Express middleware that validates the presence of an 'act' claim
 * (RFC 8693 delegation) and returns educational errors if missing.
 *
 * Phase 156: Improve security error messages
 */

const { sendErrorResponse, ERROR_CODES } = require('../services/errorSchemaService');
const { buildDelegationClaimMissing } = require('../services/errorMessageBuilder');
const jwt = require('jsonwebtoken');
const { logger } = require('../utils/logger');

function collectActIds(actClaim, ids = []) {
  if (!actClaim) return ids;
  if (typeof actClaim === 'string') {
    ids.push(actClaim);
    return ids;
  }
  if (typeof actClaim !== 'object') {
    return ids;
  }

  const actorId = actClaim.client_id || actClaim.sub;
  if (actorId) {
    ids.push(String(actorId));
  }
  if (actClaim.act) {
    collectActIds(actClaim.act, ids);
  }
  return ids;
}

/**
 * Create middleware that requires a valid delegation claim ('act') on the token.
 *
 * @returns {Function} Express middleware
 */
function delegationErrorMiddleware(options = {}) {
  return (req, res, next) => {
    try {
      const authHeader = req.headers.authorization;
      const sessionToken = req.session?.oauthTokens?.accessToken;
      const rawToken = authHeader?.startsWith('Bearer ')
        ? authHeader.substring(7)
        : sessionToken;

      if (!rawToken) {
        // No token present — let downstream auth handle it (e.g. session-based routes)
        return next();
      }

      const decoded = jwt.decode(rawToken);
      if (!decoded) {
        // Malformed token that jwt.decode cannot parse — let downstream auth reject it
        return next();
      }

      const hasActClaim = decoded.act !== undefined && decoded.act !== null;

      if (!hasActClaim) {
        // 401 Unauthorized — missing act claim is an authentication failure (delegation not proven)
        const details = buildDelegationClaimMissing({
          endpoint: req.originalUrl || req.path,
          method: req.method,
        });
        return sendErrorResponse(res, ERROR_CODES.DELEGATION_CLAIM_MISSING, {
          ...details,
          tokens_involved: {
            ...details.tokens_involved,
            token_sub: decoded.sub,
            token_iss: decoded.iss,
            token_client_id: decoded.client_id,
          },
        });
      }

      // Validate act claim structure — must be an object with non-empty sub or client_id.
      // A present but malformed act claim cannot prove delegation (RFC 8693 §2.2).
      const actClaim = decoded.act;
      const actorId = typeof actClaim?.sub === 'string' ? actClaim.sub
        : typeof actClaim?.client_id === 'string' ? actClaim.client_id : '';
      if (typeof actClaim !== 'object' || !actorId) {
        return sendErrorResponse(res, ERROR_CODES.INSUFFICIENT_PERMISSIONS, {
          message: 'RFC 8693 act claim is present but structurally invalid.',
          what_failed: 'The act claim must be an object with a non-empty sub or client_id identifying the delegating actor.',
          why: 'RFC 8693 §2.2 requires the act claim to identify the actor. An empty or malformed act cannot prove the delegation chain.',
          teaching: 'Ensure the token exchange request includes a valid actor token so PingOne populates act.sub (or act.client_id) in the issued token.',
          fix: 'Re-issue the token via RFC 8693 Token Exchange with a properly configured actor client.',
          tokens_involved: {
            token_sub: decoded.sub,
            act_claim: actClaim,
          },
        });
      }

      if (options.allowedActors && Array.isArray(options.allowedActors)) {
        const actIds = collectActIds(decoded.act);
        if (!actIds.some((id) => options.allowedActors.includes(id))) {
          return sendErrorResponse(res, ERROR_CODES.INSUFFICIENT_PERMISSIONS, {
            message: `Delegation from unauthorized actor chain: ${actIds.join(' -> ') || '(none)'}`,
            what_failed: 'Delegation actor is not in the allowed actor list.',
            why: 'This endpoint allows delegated access only from specific actors in the RFC 8693 chain.',
            teaching: 'Authorization can inspect the full act chain, not only the top-level act.sub value. Nested act.act.sub may name the original AI agent in a multi-hop exchange.',
            fix: 'Issue a delegated token from an allowed actor or update the allowed actor policy to include the expected actor in the chain.',
            tokens_involved: {
              act_chain: actIds,
            },
          });
        }
      }

      next();
    } catch (err) {
      logger.error('delegationErrorMiddleware unexpected error', { error: err.message });
      next();
    }
  };
}

module.exports = delegationErrorMiddleware;
