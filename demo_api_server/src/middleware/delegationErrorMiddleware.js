/**
 * Delegation Error Middleware
 * 
 * Validates that token contains RFC 8693 delegation claim ('act') 
 * and rejects with educational error if missing.
 * Used on agent-delegated endpoints that require proof of delegation.
 * 
 * Usage:
 *   router.post('/mcp/tool/execute', 
 *     delegationErrorMiddleware(), 
 *     (req, res) => { ... })
 */

import ErrorSchemaService, { ERROR_CODES } from '../services/errorSchemaService.js';
import ErrorMessageBuilder from '../services/errorMessageBuilder.js';

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
 * Create middleware that validates RFC 8693 delegation claim
 * 
 * @param {object} options - Additional options (e.g., allowedActors)
 * @returns {function} Express middleware
 */
export default function delegationErrorMiddleware(options = {}) {
  return (req, res, next) => {
    // Extract token from request
    const token = req.user?.token;

    // If no token at all, let other middleware handle it
    if (!token) {
      return next();
    }

    // Check for 'act' claim (RFC 8693 delegation proof)
    // act can be a string (actor id) or object { client_id: "...", sub: "..." }
    const hasActClaim = token.act !== undefined && token.act !== null;

    if (!hasActClaim) {
      const messageDetails = ErrorMessageBuilder.buildDelegationClaimMissing({
        endpoint: req.path,
        method: req.method,
      });

      const errorResponse = ErrorSchemaService.buildErrorResponse(
        ERROR_CODES.DELEGATION_CLAIM_MISSING,
        {
          message: messageDetails.what_failed,
          ...messageDetails,
        }
      );

      const statusCode = ErrorSchemaService.getStatusCode(ERROR_CODES.DELEGATION_CLAIM_MISSING);
      return res.status(statusCode).json(errorResponse);
    }

    // Validate act claim structure — must be an object with non-empty sub or client_id.
    // A present but malformed act claim cannot prove delegation (RFC 8693 §2.2).
    const actClaim = token.act;
    const actorId = typeof actClaim?.sub === 'string' ? actClaim.sub
      : typeof actClaim?.client_id === 'string' ? actClaim.client_id : '';
    if (typeof actClaim !== 'object' || !actorId) {
      return res.status(403).json(
        ErrorSchemaService.buildErrorResponse(
          ERROR_CODES.INSUFFICIENT_PERMISSIONS,
          {
            message: 'RFC 8693 act claim is present but structurally invalid.',
            what_failed: 'The act claim must be an object with a non-empty sub or client_id identifying the delegating actor.',
            why: 'RFC 8693 §2.2 requires the act claim to identify the actor. An empty or malformed act cannot prove the delegation chain.',
            teaching: 'Ensure the token exchange request includes a valid actor token so PingOne populates act.sub (or act.client_id) in the issued token.',
            fix: 'Re-issue the token via RFC 8693 Token Exchange with a properly configured actor client.',
            tokens_involved: {
              token_sub: token.sub,
              act_claim: actClaim,
            },
          }
        )
      );
    }

    // Optionally validate that act claim is from an allowed actor
    if (options.allowedActors && Array.isArray(options.allowedActors)) {
      const actIds = collectActIds(token.act);
      const actorId = actIds[0] || '';
      
      if (!actIds.some((id) => options.allowedActors.includes(id))) {
        // Still valid delegation, just not from allowed actor
        return res.status(403).json(
          ErrorSchemaService.buildErrorResponse(
            ERROR_CODES.INSUFFICIENT_PERMISSIONS,
            {
              message: `Delegation from unauthorized actor chain: ${actIds.join(' -> ') || actorId}`,
              required_role: 'allowed-actor',
              actual_role: actIds.join(' -> ') || actorId,
            }
          )
        );
      }
    }

    // Token has valid delegation claim, proceed
    next();
  };
}
