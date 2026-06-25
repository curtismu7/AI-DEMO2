'use strict';

/**
 * delegationAuditLogger.js
 * 
 * Middleware to extract and log delegation chains from JWT tokens.
 * Captures act and may_act claims for audit trail and compliance reporting.
 * 
 * Logs structured JSON events: { user, actor, action, resource, timestamp, correlationId }
 */

const { logger } = require('../utils/logger');

/**
 * Decode JWT without verification (for audit logging only)
 * Returns { header, claims } or null if malformed
 */
function decodeJwtClaims(token) {
  if (!token || typeof token !== 'string') return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return { header, claims };
  } catch {
    return null;
  }
}

/**
 * Extract delegation chain from token claims
 * Returns { user, actor, actorType, delegationChain }
 */
function extractDelegationChain(claims) {
  if (!claims) return null;

  const chain = {
    user: claims.sub || null,
    userEmail: claims.email || null,
    actor: null,
    actorType: null,
    // Why is actor what it is? Distinguishes "no delegation occurred" from
    // "delegation actor is established downstream (RFC 8693) and not visible at
    // this request layer". Set below.
    actorSource: claims.act ? 'act_claim' : 'session_token_no_act',
    delegationChain: [],
  };

  // Extract act claim (current actor)
  if (claims.act) {
    if (claims.act.client_id) {
      chain.actor = claims.act.client_id;
      chain.actorType = 'client';
      chain.delegationChain.push({
        type: 'act',
        clientId: claims.act.client_id,
        sub: claims.act.sub || null,
        iss: claims.act.iss || null,
      });
    } else if (claims.act.sub) {
      chain.actor = claims.act.sub;
      chain.actorType = 'user';
      chain.delegationChain.push({
        type: 'act',
        sub: claims.act.sub,
        iss: claims.act.iss || null,
      });
    }
  }

  // Extract may_act claim (prospective authorization)
  if (claims.may_act) {
    chain.delegationChain.push({
      type: 'may_act',
      clientId: claims.may_act.client_id || null,
      sub: claims.may_act.sub || null,
      iss: claims.may_act.iss || null,
    });
  }

  return chain;
}

/**
 * Build structured audit event
 */
function buildAuditEvent(req, delegationChain) {
  const event = {
    timestamp: new Date().toISOString(),
    correlationId: req.correlationId || req.requestId || null,
    eventType: 'delegation_action',
    method: req.method,
    path: req.path,
    resource: req.path,
    action: `${req.method} ${req.path}`,
    
    // User identity
    user: delegationChain?.user || null,
    userEmail: delegationChain?.userEmail || null,
    
    // Actor identity (who is acting on behalf of the user)
    actor: delegationChain?.actor || null,
    actorType: delegationChain?.actorType || null,
    // Why actor is what it is (honest about the request layer's limits):
    //  - 'act_claim'             actor came from a token act claim
    //  - 'session_token_no_act'  session user token structurally carries no act;
    //                            delegation actor is established downstream
    actorSource: delegationChain?.actorSource || 'unknown',

    // Which agent path initiated this (best-effort): 'heuristic',
    // 'reason_loop_3006', null when not an agent-driven call.
    agentPath: req.agentPath || req.headers['x-agent-path'] || null,

    // Full delegation chain
    delegationChain: delegationChain?.delegationChain || [],

    // Request metadata
    ip: req.ip || req.connection?.remoteAddress || null,
    userAgent: req.headers['user-agent'] || null,

    // Session metadata
    sessionId: req.sessionID || null,
  };

  // Explain a null actor only when it is null *because* the request-layer token
  // cannot carry act — not when delegation genuinely did not happen.
  if (event.actor === null && event.actorSource === 'session_token_no_act') {
    event._note =
      'actor null at request layer: session user token carries no act claim; ' +
      'delegation actor is established downstream in the RFC 8693 exchange ' +
      '(see token chain / agentMcpTokenService)';
  }

  return event;
}

/**
 * Delegation audit logging middleware
 * Extracts act/may_act claims from session tokens and logs delegation events
 */
function delegationAuditMiddleware(req, res, next) {
  // Only log for authenticated requests with tokens
  const accessToken = req.session?.oauthTokens?.accessToken;
  if (!accessToken || accessToken === '_cookie_session') {
    return next();
  }

  // Decode token and extract delegation chain
  const decoded = decodeJwtClaims(accessToken);
  const delegationChain = extractDelegationChain(decoded?.claims);

  // Attach delegation chain to request for downstream use
  req.delegationChain = delegationChain;

  // Pure-telemetry / event-sink endpoints: high-volume, not security-relevant.
  // Auditing these floods the log and buries real delegation signal. Checked
  // FIRST so /mcp/tool/events is excluded before the /mcp/tool include() below
  // could re-add it (real tool calls hit /api/mcp/tool, NOT .../events).
  const isTelemetryEndpoint =
    req.path.includes('/app-events') ||
    req.path.includes('/mcp/tool/events') ||
    req.path.includes('/token-chain') ||
    req.path === '/api/health' || req.path === '/health';

  // Log audit event for sensitive operations
  const isSensitiveOperation =
    !isTelemetryEndpoint && (
      req.method !== 'GET' || // All mutations
      req.path.includes('/accounts') || // Account access
      req.path.includes('/transactions') || // Transaction access
      req.path.includes('/transfer') || // Money movement
      req.path.includes('/mcp/tool') // MCP tool invocations
    );

  if (isSensitiveOperation && delegationChain) {
    const auditEvent = buildAuditEvent(req, delegationChain);
    
    // Log to audit stream (structured JSON)
    logger.audit('DELEGATION_ACTION', auditEvent);
    
    // Also log to console in development for visibility
    if (process.env.NODE_ENV !== 'production') {
      console.log('[AUDIT]', JSON.stringify(auditEvent, null, 2));
    }
  }

  next();
}

/**
 * Log delegation event explicitly (for use in route handlers)
 */
function logDelegationEvent(req, eventType, details = {}) {
  const delegationChain = req.delegationChain || extractDelegationChain(
    decodeJwtClaims(req.session?.oauthTokens?.accessToken)?.claims
  );

  const auditEvent = {
    ...buildAuditEvent(req, delegationChain),
    eventType,
    ...details,
  };

  logger.audit(eventType, auditEvent);

  if (process.env.NODE_ENV !== 'production') {
    console.log('[AUDIT]', JSON.stringify(auditEvent, null, 2));
  }
}

module.exports = {
  delegationAuditMiddleware,
  logDelegationEvent,
  extractDelegationChain,
  buildAuditEvent,
  decodeJwtClaims,
};
