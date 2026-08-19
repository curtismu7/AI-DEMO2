/**
 * adminAuditService.js
 *
 * Audit trail and logging for admin actions in Phase 44.
 * Provides comprehensive logging for admin token usage and administrative operations.
 */

const { writeExchangeEvent, readExchangeEvents } = require('./exchangeAuditStore');

/**
 * Admin action types for categorization
 */
const ADMIN_ACTION_TYPES = {
  TOKEN_EXCHANGE: 'admin_token_exchange',
  USER_MANAGEMENT: 'admin_user_management',
  SYSTEM_ADMIN: 'admin_system_admin',
  DATA_ACCESS: 'admin_data_access',
  SECURITY_ACTION: 'admin_security_action'
};

/**
 * Log admin token exchange events
 * @param {object} event - Admin token exchange event data
 * @param {object} req - Express request object
 */
function logAdminTokenExchange(event, req) {
  const auditEvent = {
    type: ADMIN_ACTION_TYPES.TOKEN_EXCHANGE,
    timestamp: new Date().toISOString(),
    adminSub: event.adminSub,
    adminClientId: event.adminClientId,
    tool: event.tool,
    action: event.action,
    result: event.result,
    details: event.details,
    requestId: req.id || 'unknown',
    userAgent: req.get('User-Agent'),
    ip: req.ip || req.connection.remoteAddress,
    sessionId: req.sessionID
  };

  // Write to exchange audit store
  writeExchangeEvent(auditEvent);

  // Additional admin-specific logging
  console.log('[ADMIN_AUDIT] Token Exchange:', {
    type: auditEvent.type,
    adminSub: auditEvent.adminSub,
    tool: auditEvent.tool,
    action: auditEvent.action,
    result: auditEvent.result,
    timestamp: auditEvent.timestamp
  });
}

/**
 * Log admin user management actions
 * @param {object} event - User management event data
 * @param {object} req - Express request object
 */
function logAdminUserManagement(event, req) {
  const auditEvent = {
    type: ADMIN_ACTION_TYPES.USER_MANAGEMENT,
    timestamp: new Date().toISOString(),
    adminSub: event.adminSub,
    targetUserSub: event.targetUserSub,
    action: event.action, // 'create', 'read', 'update', 'delete'
    resource: event.resource, // 'user', 'account', 'profile'
    result: event.result,
    details: event.details,
    requestId: req.id || 'unknown',
    userAgent: req.get('User-Agent'),
    ip: req.ip || req.connection.remoteAddress,
    sessionId: req.sessionID
  };

  writeExchangeEvent(auditEvent);

  console.log('[ADMIN_AUDIT] User Management:', {
    type: auditEvent.type,
    adminSub: auditEvent.adminSub,
    targetUserSub: auditEvent.targetUserSub,
    action: auditEvent.action,
    resource: auditEvent.resource,
    result: auditEvent.result,
    timestamp: auditEvent.timestamp
  });
}

/**
 * Log admin system administration actions
 * @param {object} event - System admin event data
 * @param {object} req - Express request object
 */
function logAdminSystemAdmin(event, req) {
  const auditEvent = {
    type: ADMIN_ACTION_TYPES.SYSTEM_ADMIN,
    timestamp: new Date().toISOString(),
    adminSub: event.adminSub,
    action: event.action, // 'system_status', 'config_change', 'maintenance'
    resource: event.resource,
    result: event.result,
    details: event.details,
    requestId: req.id || 'unknown',
    userAgent: req.get('User-Agent'),
    ip: req.ip || req.connection.remoteAddress,
    sessionId: req.sessionID
  };

  writeExchangeEvent(auditEvent);

  console.log('[ADMIN_AUDIT] System Admin:', {
    type: auditEvent.type,
    adminSub: auditEvent.adminSub,
    action: auditEvent.action,
    resource: auditEvent.resource,
    result: auditEvent.result,
    timestamp: auditEvent.timestamp
  });
}

/**
 * Log admin data access actions
 * @param {object} event - Data access event data
 * @param {object} req - Express request object
 */
function logAdminDataAccess(event, req) {
  const auditEvent = {
    type: ADMIN_ACTION_TYPES.DATA_ACCESS,
    timestamp: new Date().toISOString(),
    adminSub: event.adminSub,
    action: event.action, // 'view', 'export', 'search'
    resource: event.resource, // 'all_users', 'audit_logs', 'system_data'
    query: event.query, // Search or filter criteria
    result: event.result,
    details: event.details,
    requestId: req.id || 'unknown',
    userAgent: req.get('User-Agent'),
    ip: req.ip || req.connection.remoteAddress,
    sessionId: req.sessionID
  };

  writeExchangeEvent(auditEvent);

  console.log('[ADMIN_AUDIT] Data Access:', {
    type: auditEvent.type,
    adminSub: auditEvent.adminSub,
    action: auditEvent.action,
    resource: auditEvent.resource,
    result: auditEvent.result,
    timestamp: auditEvent.timestamp
  });
}

/**
 * Log admin security actions
 * @param {object} event - Security event data
 * @param {object} req - Express request object
 */
function logAdminSecurityAction(event, req) {
  const auditEvent = {
    type: ADMIN_ACTION_TYPES.SECURITY_ACTION,
    timestamp: new Date().toISOString(),
    adminSub: event.adminSub,
    action: event.action, // 'lock_account', 'reset_password', 'enable_mfa'
    targetUserSub: event.targetUserSub,
    securityContext: event.securityContext,
    result: event.result,
    details: event.details,
    requestId: req.id || 'unknown',
    userAgent: req.get('User-Agent'),
    ip: req.ip || req.connection.remoteAddress,
    sessionId: req.sessionID
  };

  writeExchangeEvent(auditEvent);

  console.log('[ADMIN_AUDIT] Security Action:', {
    type: auditEvent.type,
    adminSub: auditEvent.adminSub,
    action: auditEvent.action,
    targetUserSub: auditEvent.targetUserSub,
    result: auditEvent.result,
    timestamp: auditEvent.timestamp
  });
}

/**
 * Get admin audit trail for a specific admin
 * @param {string} adminSub - Admin subject identifier
 * @param {object} options - Query options (limit, date range, action types)
 * @returns {Promise<Array>} - Array of audit events
 */
async function getAdminAuditTrail(adminSub, options = {}) {
  const {
    limit = 200,
    startDate,
    endDate,
    actionTypes
  } = options;
  const start = startDate ? new Date(startDate).getTime() : -Infinity;
  const end = endDate ? new Date(endDate).getTime() : Infinity;
  const allowedTypes = actionTypes
    ? new Set(Array.isArray(actionTypes) ? actionTypes : [actionTypes])
    : null;

  const events = await readExchangeEvents();
  return events
    .filter(event => {
      const timestamp = new Date(event.timestamp).getTime();
      return (
        event.adminSub === adminSub &&
        timestamp >= start &&
        timestamp <= end &&
        (!allowedTypes || allowedTypes.has(event.type))
      );
    })
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, Math.max(0, Number(limit) || 0));
}

/**
 * Generate admin activity report
 * @param {object} options - Report options (date range, admin filters)
 * @returns {Promise<object>} - Activity report data
 */
async function generateAdminActivityReport(options = {}) {
  const {
    startDate = new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
    endDate = new Date(),
    adminSubs = []
  } = options;

  console.log('[ADMIN_AUDIT] Generate activity report:', {
    startDate,
    endDate,
    adminSubs
  });

  const events = (await readExchangeEvents()).filter(event => {
    const timestamp = new Date(event.timestamp).getTime();
    return (
      timestamp >= new Date(startDate).getTime() &&
      timestamp <= new Date(endDate).getTime() &&
      (adminSubs.length === 0 || adminSubs.includes(event.adminSub))
    );
  });
  const actionsByType = {};
  const actionsByAdmin = {};
  const actionCounts = {};

  for (const event of events) {
    actionsByType[event.type] = (actionsByType[event.type] || 0) + 1;
    actionsByAdmin[event.adminSub] = (actionsByAdmin[event.adminSub] || 0) + 1;
    if (event.action) actionCounts[event.action] = (actionCounts[event.action] || 0) + 1;
  }

  const topActions = Object.entries(actionCounts)
    .sort(([, a], [, b]) => b - a)
    .map(([action, count]) => ({ action, count }));
  const securityEvents = events.filter(event =>
    event.type === ADMIN_ACTION_TYPES.SECURITY_ACTION ||
    event.type === 'security-monitoring-event' ||
    event.type.startsWith('security')
  );

  return {
    period: { startDate, endDate },
    totalActions: events.length,
    actionsByType,
    actionsByAdmin,
    topActions,
    securityEvents
  };
}

/**
 * Validate admin action permissions
 * @param {string} adminSub - Admin subject identifier
 * @param {string} action - Action to perform
 * @param {string} resource - Resource being accessed
 * @param {string[]} scopes - Optional scopes to evaluate against the policy
 * @returns {object} - Permission validation result
 */
function validateAdminActionPermissions(adminSub, action, resource, scopes = []) {
  const normalizedScopes = new Set(Array.isArray(scopes) ? scopes : [scopes]);
  const normalizedAction = String(action || '').toLowerCase();
  const requiredScopes = normalizedAction === 'delete'
    ? ['admin:delete', 'users:manage']
    : ['read', 'view', 'lookup', 'search', 'export'].includes(normalizedAction)
      ? ['admin:read']
      : ['admin:write'];
  const hasScopes = requiredScopes.every(scope => normalizedScopes.has(scope));

  return {
    allowed: Boolean(adminSub) && hasScopes,
    adminSub: adminSub || null,
    action: normalizedAction,
    resource: resource || null,
    requiredScopes,
    missingScopes: requiredScopes.filter(scope => !normalizedScopes.has(scope))
  };
}

module.exports = {
  // Constants
  ADMIN_ACTION_TYPES,
  
  // Logging functions
  logAdminTokenExchange,
  logAdminUserManagement,
  logAdminSystemAdmin,
  logAdminDataAccess,
  logAdminSecurityAction,
  
  // Query and reporting
  getAdminAuditTrail,
  generateAdminActivityReport,
  
  // Security
  validateAdminActionPermissions
};
