/**
 * Middleware to validate and extract act/may_act claims from tokens
 * for delegation chain verification and audit logging.
 * 
 * RFC 8693 §4.1: act claim structure validation
 */

const jwt = require('jsonwebtoken');
const { logger } = require('../utils/logger');


/**
 * Validate act claim structure per RFC 8693
 * @param {object} actClaim - The act claim from the token
 * @returns {object} { valid: boolean, reason: string, actor: object|null }
 */
function validateActClaim(actClaim) {
  if (!actClaim) {
    return { valid: false, reason: 'act claim not present', actor: null };
  }

  if (typeof actClaim !== 'object' || Array.isArray(actClaim)) {
    return { valid: false, reason: 'act claim must be a JSON object', actor: null };
  }

  // RFC 8693 §4.1: act claim should contain at least one identifier
  const hasIdentifier = actClaim.client_id || actClaim.sub || actClaim.iss;
  
  if (!hasIdentifier) {
    return { 
      valid: false, 
      reason: 'act claim missing required identifiers (client_id, sub, or iss)', 
      actor: null 
    };
  }

  return {
    valid: true,
    reason: 'act claim valid',
    actor: {
      client_id: actClaim.client_id || null,
      sub: actClaim.sub || null,
      iss: actClaim.iss || null
    }
  };
}

/**
 * Validate may_act claim structure
 * @param {object} mayActClaim - The may_act claim from the token
 * @param {string} expectedClientId - Expected client_id that may act
 * @returns {object} { valid: boolean, reason: string }
 */
function validateMayActClaim(mayActClaim, expectedClientId) {
  if (!mayActClaim) {
    return { valid: false, reason: 'may_act claim not present' };
  }

  if (typeof mayActClaim !== 'object' || Array.isArray(mayActClaim)) {
    return { valid: false, reason: 'may_act claim must be a JSON object' };
  }

  // Check if the expected client is authorized
  if (expectedClientId && mayActClaim.client_id) {
    if (mayActClaim.client_id !== expectedClientId) {
      return {
        valid: false,
        reason: `may_act.client_id mismatch: expected ${expectedClientId}, got ${mayActClaim.client_id}`
      };
    }
  }

  return { valid: true, reason: 'may_act claim valid' };
}

/**
 * Extract delegation chain from token
 * @param {object} decodedToken - Decoded JWT payload
 * @returns {object} Delegation chain information
 */
function extractDelegationChain(decodedToken) {
  const chain = {
    subject: decodedToken.sub || null,
    actor: null,
    mayAct: null,
    delegationPresent: false
  };

  // Extract act claim (current actor)
  if (decodedToken.act) {
    const actValidation = validateActClaim(decodedToken.act);
    chain.actor = actValidation.actor;
    chain.delegationPresent = actValidation.valid;
  }

  // Extract may_act claim (prospective delegation)
  if (decodedToken.may_act) {
    chain.mayAct = {
      client_id: decodedToken.may_act.client_id || null,
      sub: decodedToken.may_act.sub || null,
      iss: decodedToken.may_act.iss || null
    };
  }

  return chain;
}

/**
 * Middleware to validate and attach delegation chain to request
 * Extracts act/may_act claims and makes them available for audit logging
 */
function actClaimValidationMiddleware(req, _res, next) {
  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      // No token, skip validation (auth middleware will handle)
      return next();
    }

    const token = authHeader.substring(7);
    
    // Decode without verification (signature already verified by auth middleware)
    const decoded = jwt.decode(token);
    
    if (!decoded) {
      return next();
    }

    // Extract delegation chain
    const delegationChain = extractDelegationChain(decoded);
    
    // Attach to request for use in audit logging
    req.delegationChain = delegationChain;
    
    // Validate act claim if present
    if (decoded.act) {
      const actValidation = validateActClaim(decoded.act);
      req.actClaimValid = actValidation.valid;
      req.actClaimReason = actValidation.reason;
      
      if (!actValidation.valid) {
        logger.warn('Invalid act claim in token', {
          reason: actValidation.reason,
          sub: decoded.sub,
          path: req.path
        });
      }
    }

    // Log delegation chain for audit
    if (delegationChain.delegationPresent) {
      logger.info('Delegation chain detected', {
        subject: delegationChain.subject,
        actor: delegationChain.actor,
        path: req.path,
        method: req.method
      });
    }

    next();
  } catch (error) {
    logger.error('Error in act claim validation middleware', { error: error.message });
    // Don't block request on validation error
    next();
  }
}

module.exports = {
  actClaimValidationMiddleware,
  validateActClaim,
  validateMayActClaim,
  extractDelegationChain
};
