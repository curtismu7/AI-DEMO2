/**
 * Audit Logger - Structured audit logging with delegation chain tracking
 * Provides comprehensive audit trail for compliance and security analysis
 */

const { logger } = require('../utils/logger');

const { extractDelegationChain } = require('../middleware/actClaimValidator');
const jwt = require('jsonwebtoken');

/**
 * Audit event types
 */
const AuditEventType = {
  // Authentication events
  LOGIN: 'auth.login',
  LOGOUT: 'auth.logout',
  TOKEN_REFRESH: 'auth.token_refresh',
  TOKEN_REVOCATION: 'auth.token_revocation',
  
  // Authorization events
  ACCESS_GRANTED: 'authz.access_granted',
  ACCESS_DENIED: 'authz.access_denied',
  DELEGATION: 'authz.delegation',
  
  // Resource access events
  ACCOUNT_READ: 'resource.account.read',
  ACCOUNT_CREATE: 'resource.account.create',
  ACCOUNT_UPDATE: 'resource.account.update',
  ACCOUNT_DELETE: 'resource.account.delete',
  
  TRANSACTION_READ: 'resource.transaction.read',
  TRANSACTION_CREATE: 'resource.transaction.create',
  
  // MCP events
  MCP_TOOL_CALL: 'mcp.tool_call',
  MCP_TOKEN_EXCHANGE: 'mcp.token_exchange',
  
  // Security events
  INVALID_TOKEN: 'security.invalid_token',
  REVOKED_TOKEN: 'security.revoked_token',
  SUSPICIOUS_ACTIVITY: 'security.suspicious_activity'
};

/**
 * Create a structured audit event
 * @param {string} eventType - Type of audit event
 * @param {object} req - Express request object
 * @param {object} details - Event-specific details
 * @returns {object} Structured audit event
 */
function createAuditEvent(eventType, req, details = {}) {
  const event = {
    timestamp: new Date().toISOString(),
    eventType,
    correlationId: req.correlationId || null,
    
    // User/Subject information
    subject: null,
    actor: null,
    delegationChain: null,
    
    // Request information
    method: req.method,
    path: req.path,
    ip: req.ip || req.connection?.remoteAddress,
    userAgent: req.get('user-agent'),
    
    // Session information
    sessionId: req.sessionID || null,
    
    // Event details
    details,
    
    // Result
    success: details.success !== false,
    error: details.error || null
  };

  // Extract delegation chain if available
  if (req.delegationChain) {
    event.subject = req.delegationChain.subject;
    event.actor = req.delegationChain.actor;
    event.delegationChain = req.delegationChain;
  } else if (req.session?.user) {
    event.subject = req.session.user.id || req.session.user.username;
  }

  // Extract from token if not already set
  if (!event.subject && req.headers.authorization) {
    try {
      const token = req.headers.authorization.substring(7);
      const decoded = jwt.decode(token);
      if (decoded) {
        event.subject = decoded.sub;
        const chain = extractDelegationChain(decoded);
        if (chain.delegationPresent) {
          event.actor = chain.actor;
          event.delegationChain = chain;
        }
      }
    } catch (_e) {
      // Ignore decode errors
    }
  }

  return event;
}

/**
 * Log an audit event
 * @param {string} eventType - Type of audit event
 * @param {object} req - Express request object
 * @param {object} details - Event-specific details
 */
function logAuditEvent(eventType, req, details = {}) {
  const event = createAuditEvent(eventType, req, details);
  
  // Log to audit stream (separate from application logs)
  logger.info('AUDIT', event);
  
  // For critical events, also log at warn/error level
  if (eventType.startsWith('security.') || !event.success) {
    logger.warn('AUDIT_CRITICAL', event);
  }
}

/**
 * Log delegation chain access
 * @param {object} req - Express request object
 * @param {string} resource - Resource being accessed
 * @param {string} action - Action being performed
 */
function logDelegatedAccess(req, resource, action) {
  if (!req.delegationChain?.delegationPresent) {
    return; // No delegation, skip
  }

  logAuditEvent(AuditEventType.DELEGATION, req, {
    resource,
    action,
    subject: req.delegationChain.subject,
    actor: req.delegationChain.actor,
    actorType: req.delegationChain.actor?.client_id ? 'client' : 'user',
    message: `${req.delegationChain.actor?.client_id || 'unknown'} acting on behalf of ${req.delegationChain.subject}`
  });
}

/**
 * Log MCP tool call with delegation info
 * @param {object} req - Express request object
 * @param {string} toolName - MCP tool name
 * @param {object} parameters - Tool parameters
 * @param {object} result - Tool result
 */
function logMCPToolCall(req, toolName, parameters, result) {
  logAuditEvent(AuditEventType.MCP_TOOL_CALL, req, {
    toolName,
    parameters: sanitizeParameters(parameters),
    success: !result.error,
    error: result.error,
    delegated: !!req.delegationChain?.delegationPresent
  });
}

/**
 * Log token exchange with delegation details
 * @param {object} req - Express request object
 * @param {string} audience - Target audience
 * @param {string} scope - Requested scope
 * @param {boolean} hasActClaim - Whether exchanged token has act claim
 */
function logTokenExchange(req, audience, scope, hasActClaim) {
  logAuditEvent(AuditEventType.MCP_TOKEN_EXCHANGE, req, {
    audience,
    scope,
    hasActClaim,
    exchangeType: hasActClaim ? 'delegated' : 'subject-only',
    message: hasActClaim 
      ? 'Token exchange with delegation (act claim present)'
      : 'Token exchange without delegation (act claim missing)'
  });
}

/**
 * Sanitize parameters to remove sensitive data
 * @param {object} params - Parameters to sanitize
 * @returns {object} Sanitized parameters
 */
function sanitizeParameters(params) {
  if (!params || typeof params !== 'object') {
    return params;
  }

  const sanitized = { ...params };
  const sensitiveKeys = ['password', 'secret', 'token', 'key', 'pin', 'ssn'];
  
  for (const key of Object.keys(sanitized)) {
    const lowerKey = key.toLowerCase();
    if (sensitiveKeys.some(sk => lowerKey.includes(sk))) {
      sanitized[key] = '[REDACTED]';
    }
  }
  
  return sanitized;
}

/**
 * Middleware to log all requests with delegation info
 */
function auditLoggingMiddleware(req, res, next) {
  // Capture response details
  const originalSend = res.send;
  res.send = (data) => {
    res.send = originalSend;
    
    // Log the request
    logAuditEvent(AuditEventType.ACCESS_GRANTED, req, {
      statusCode: res.statusCode,
      success: res.statusCode < 400,
      responseSize: data ? data.length : 0
    });
    
    return res.send(data);
  };

  next();
}

/**
 * Query audit logs (placeholder - would integrate with log aggregation system)
 * @param {object} filters - Query filters
 * @returns {Promise<Array>} Audit events
 */
async function queryAuditLogs(filters = {}) {
  // This would integrate with your log aggregation system (e.g., Elasticsearch, Splunk)
  // For now, return empty array
  logger.info('Audit log query', filters);
  return [];
}

/**
 * Generate delegation chain report
 * @param {string} subject - User subject
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 * @returns {Promise<object>} Delegation chain report
 */
async function generateDelegationReport(subject, startDate, endDate) {
  // This would query your audit log storage
  logger.info('Generating delegation report', { subject, startDate, endDate });
  
  return {
    subject,
    period: { start: startDate, end: endDate },
    delegatedActions: [],
    actors: [],
    summary: {
      totalDelegatedActions: 0,
      uniqueActors: 0
    }
  };
}

module.exports = {
  AuditEventType,
  createAuditEvent,
  logAuditEvent,
  logDelegatedAccess,
  logMCPToolCall,
  logTokenExchange,
  auditLoggingMiddleware,
  queryAuditLogs,
  generateDelegationReport
};
