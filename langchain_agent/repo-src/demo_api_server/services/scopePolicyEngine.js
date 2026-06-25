/**
 * Scope Policy Engine and Enforcement
 * Comprehensive scope validation and enforcement using existing MCP tool scopes
 * 
 * Phase 57-03: Scope Policy Engine and Enforcement
 * Security-focused implementation with granular access control
 */

'use strict';

const { MCP_TOOL_SCOPES } = require('./mcpWebSocketClient');
const scopeTopology = require('./scopeTopology');

// Policy-engine-local metadata that is NOT topology (operations a scope maps to,
// whether it needs user context). Keyed by canonical manifest scope name. The
// scope SET is single-sourced from the manifest; only these behavioral overlays
// live here. scopeTopology.regression.test.js asserts every key below exists in
// the manifest (no orphans).
const SCOPE_OPS_OVERLAY = {
  'read':                  { operations: ['GET /accounts/*', 'GET /transactions/*', 'GET /balances/*'], requires_user_context: true, category: 'banking' },
  'write':                 { operations: ['POST /transactions', 'POST /transfers'], requires_user_context: true, category: 'banking' },
  'transfer':              { operations: ['POST /transfers'], requires_user_context: true, category: 'banking' },
  'accounts:read':         { operations: ['GET /accounts/*', 'GET /balances/*'], requires_user_context: true, category: 'banking' },
  'transactions:read':     { operations: ['GET /transactions/*'], requires_user_context: true, category: 'banking' },
  'mortgage:read':         { operations: ['GET /mortgage'], requires_user_context: true, category: 'banking' },
  'ai:agent:read':         { operations: ['agent:invoke'], requires_user_context: true, category: 'banking' },
  'mcp:invoke':            { operations: ['mcp:tools/call'], requires_user_context: true, category: 'banking' },
  'ai_agent':              { operations: ['agent:identity'], requires_user_context: false, category: 'ai' },
};

const { writeExchangeEvent } = require('./exchangeAuditStore');

// Non-manifest scopes the policy engine governs that the topology SSOT does
// not model. As of the v2 SSOT refactor, admin:*/users: scopes ARE in the
// manifest (with category:'admin' + their risk levels), so they derive from
// it like everything else. Only transactions:write remains
// engine-local — no tool/app/resource references it, so it is intentionally
// absent from scope-topology.json.
const NON_MANIFEST_TAXONOMY = {
  'transactions:write': {
    description: 'Create and modify transactions',
    operations: ['POST /transactions/*'],
    risk_level: 'high',
    category: 'banking',
    requires_user_context: true,
  },
};

// Operations + user-context overlay for admin/users scopes. The manifest is
// authoritative for their identity/risk/category (v2); only the operation
// list + requires_user_context stay here (not modelled by the topology).
const ADMIN_OPS_OVERLAY = {
  'admin:read':   { operations: ['GET /admin/*', 'GET /users/*', 'GET /audit/*'], requires_user_context: false, category: 'admin' },
  'admin:write':  { operations: ['POST /admin/*', 'PUT /users/*', 'DELETE /users/*'], requires_user_context: false, category: 'admin' },
  'admin:delete': { operations: ['DELETE /users/*', 'DELETE /admin/*'], requires_user_context: false, category: 'admin' },
  'users:read':   { operations: ['GET /users/*'], requires_user_context: false, category: 'admin' },
  'users:manage': { operations: ['POST /users/*', 'PUT /users/*', 'DELETE /users/*'], requires_user_context: false, category: 'admin' },
};

/**
 * Scope taxonomy and risk levels
 * Using existing MCP tool scopes structure
 */
// SCOPE_TAXONOMY: banking-family scopes derive identity+risk from the manifest
// (single source of truth); ops from the overlay. Non-manifest admin/users
// scopes come from NON_MANIFEST_TAXONOMY. Manifest is authoritative for the
// scopes it owns; the local registry covers only what the SSOT excludes.
const SCOPE_TAXONOMY = {
  ...NON_MANIFEST_TAXONOMY,
  ...Object.keys(scopeTopology._manifest().scopes).reduce((acc, name) => {
    const meta = scopeTopology.scopeMeta(name);
    const overlay = SCOPE_OPS_OVERLAY[name] || ADMIN_OPS_OVERLAY[name] || { operations: [], requires_user_context: true };
    acc[name] = {
      description: meta.description,
      risk_level: meta.riskLevel,
      // Manifest is authoritative for category (v2 `category` field);
      // overlay is a fallback for any scope that predates the field.
      category: meta.category || overlay.category || 'banking',
      operations: overlay.operations,
      requires_user_context: overlay.requires_user_context,
    };
    return acc;
  }, {}),
};

/**
 * Risk level weights for scoring
 */
const RISK_WEIGHTS = {
  'low': 1,
  'medium': 3,
  'high': 5,
  'critical': 10
};

/**
 * Scope policy rules
 */
const SCOPE_POLICIES = {
  // Banking policies
  'read': {
    max_requests_per_hour: 1000,
    allowed_ip_ranges: ['*'], // Any IP for read operations
    requires_user_session: true,
    data_retention_days: 30
  },
  'write': {
    max_requests_per_hour: 100,
    allowed_ip_ranges: ['*'],
    requires_user_session: true,
    requires_mfa: true,
    data_retention_days: 365
  },
  'transactions:write': {
    max_requests_per_hour: 50,
    allowed_ip_ranges: ['*'],
    requires_user_session: true,
    requires_mfa: true,
    amount_limit: 10000, // Daily transaction limit
    data_retention_days: 365
  },

  // AI agent policies
  'ai_agent': {
    max_requests_per_hour: 200,
    allowed_ip_ranges: ['*'],
    requires_user_session: true,
    tool_access_restrictions: ['get_sensitive_account_details'],
    data_retention_days: 90
  },

  // Admin policies
  'admin:read': {
    max_requests_per_hour: 500,
    allowed_ip_ranges: ['*'],
    requires_admin_session: true,
    data_retention_days: 90
  },
  'admin:write': {
    max_requests_per_hour: 100,
    allowed_ip_ranges: ['*'],
    requires_admin_session: true,
    data_retention_days: 365
  },
  'users:manage': {
    max_requests_per_hour: 50,
    allowed_ip_ranges: ['*'],
    requires_admin_session: true,
    data_retention_days: 365
  }
};

/**
 * Scope usage tracking
 */
const scopeUsage = new Map();

/**
 * Audit event logging for scope operations
 */
function logScopeEvent(eventType, scopeData, details = {}) {
  const auditEvent = {
    type: 'scope-policy-event',
    level: 'info',
    timestamp: new Date().toISOString(),
    eventType,
    ...scopeData,
    ...details,
    security: {
      sourceIP: details.sourceIP || 'unknown',
      userAgent: details.userAgent || 'unknown',
      requestId: details.requestId || require('crypto').randomUUID()
    }
  };

  writeExchangeEvent(auditEvent).catch(err => {
    console.error('[ScopePolicy] Failed to log scope event:', err.message);
  });
}

/**
 * Validate scope format and existence
 */
function validateScopeFormat(scopes) {
  if (!Array.isArray(scopes)) {
    return { valid: false, errors: ['Scopes must be an array'] };
  }

  const errors = [];
  const validScopes = new Set();
  const allValidScopes = new Set(Object.keys(SCOPE_TAXONOMY));

  scopes.forEach(scope => {
    if (typeof scope !== 'string') {
      errors.push(`Invalid scope type: ${typeof scope}`);
      return;
    }

    if (!allValidScopes.has(scope)) {
      errors.push(`Unknown scope: ${scope}`);
    } else {
      validScopes.add(scope);
    }
  });

  return {
    valid: errors.length === 0,
    errors,
    validScopes: Array.from(validScopes)
  };
}

/**
 * Calculate risk score for a set of scopes
 */
function calculateRiskScore(scopes) {
  let totalScore = 0;
  const riskBreakdown = {};

  scopes.forEach(scope => {
    const taxonomy = SCOPE_TAXONOMY[scope];
    if (taxonomy) {
      const weight = RISK_WEIGHTS[taxonomy.risk_level] || 1;
      totalScore += weight;
      riskBreakdown[scope] = {
        risk_level: taxonomy.risk_level,
        weight,
        category: taxonomy.category
      };
    }
  });

  return {
    total_score: totalScore,
    risk_level: totalScore >= 10 ? 'critical' : totalScore >= 5 ? 'high' : totalScore >= 3 ? 'medium' : 'low',
    breakdown: riskBreakdown
  };
}

/**
 * Check if scopes are compatible with each other
 */
function validateScopeCompatibility(scopes) {
  const errors = [];
  const categories = {};

  // Group scopes by category
  scopes.forEach(scope => {
    const taxonomy = SCOPE_TAXONOMY[scope];
    if (taxonomy) {
      if (!categories[taxonomy.category]) {
        categories[taxonomy.category] = [];
      }
      categories[taxonomy.category].push(scope);
    }
  });

  // Check for conflicting scopes
  Object.entries(categories).forEach(([category, categoryScopes]) => {
    if (category === 'banking') {
      // Banking scopes are generally compatible
    } else if (category === 'admin') {
      // Admin scopes require special validation
      const hasCriticalScope = categoryScopes.some(scope => 
        SCOPE_TAXONOMY[scope].risk_level === 'critical'
      );
      if (hasCriticalScope && categoryScopes.length > 1) {
        errors.push(`Critical admin scope ${categoryScopes.join(', ')} requires isolation`);
      }
    }
  });

  return {
    valid: errors.length === 0,
    errors,
    categories
  };
}

/**
 * Validate scopes against tool requirements
 */
function validateScopesForTool(toolName, requestedScopes) {
  const requiredScopes = MCP_TOOL_SCOPES[toolName];
  
  if (!requiredScopes) {
    return {
      valid: false,
      errors: [`Unknown tool: ${toolName}`],
      requiredScopes: []
    };
  }

  // Check if requested scopes include at least one required scope
  const hasRequiredScope = requiredScopes.some(scope => requestedScopes.includes(scope));
  
  if (!hasRequiredScope) {
    return {
      valid: false,
      errors: [`Tool ${toolName} requires one of: ${requiredScopes.join(', ')}`],
      requiredScopes
    };
  }

  return {
    valid: true,
    errors: [],
    requiredScopes,
    matchedScopes: requestedScopes.filter(scope => requiredScopes.includes(scope))
  };
}

/**
 * Enforce scope policies for a request
 */
function enforceScopePolicies(scopes, requestContext) {
  const violations = [];
  const enforcedPolicies = [];

  scopes.forEach(scope => {
    const policy = SCOPE_POLICIES[scope];
    if (!policy) return;

    // Check rate limiting
    const usageKey = `${scope}:${requestContext.clientId || 'anonymous'}`;
    const currentUsage = scopeUsage.get(usageKey) || { count: 0, resetTime: Date.now() + 3600000 };
    
    if (currentUsage.count >= policy.max_requests_per_hour) {
      violations.push({
        scope,
        type: 'rate_limit_exceeded',
        limit: policy.max_requests_per_hour,
        current: currentUsage.count
      });
    }

    // Check IP restrictions
    if (policy.allowed_ip_ranges && policy.allowed_ip_ranges[0] !== '*') {
      const clientIP = requestContext.sourceIP;
      if (!policy.allowed_ip_ranges.includes(clientIP)) {
        violations.push({
          scope,
          type: 'ip_restricted',
          allowed_ranges: policy.allowed_ip_ranges,
          client_ip: clientIP
        });
      }
    }

    // Check session requirements
    if (policy.requires_user_session && !requestContext.userSession) {
      violations.push({
        scope,
        type: 'session_required',
        requirement: 'User session required'
      });
    }

    if (policy.requires_admin_session && !requestContext.adminSession) {
      violations.push({
        scope,
        type: 'admin_session_required',
        requirement: 'Admin session required'
      });
    }

    // Check MFA requirements
    if (policy.requires_mfa && !requestContext.mfaVerified) {
      violations.push({
        scope,
        type: 'mfa_required',
        requirement: 'Multi-factor authentication required'
      });
    }

    enforcedPolicies.push({
      scope,
      policy: {
        max_requests_per_hour: policy.max_requests_per_hour,
        requires_user_session: policy.requires_user_session,
        requires_admin_session: policy.requires_admin_session,
        requires_mfa: policy.requires_mfa
      }
    });
  });

  return {
    allowed: violations.length === 0,
    violations,
    enforcedPolicies
  };
}

/**
 * Update scope usage statistics
 */
function updateScopeUsage(scopes, clientId) {
  const now = Date.now();
  
  scopes.forEach(scope => {
    const usageKey = `${scope}:${clientId}`;
    let usage = scopeUsage.get(usageKey);
    
    if (!usage || now > usage.resetTime) {
      // Reset or create new usage record
      usage = {
        count: 1,
        resetTime: now + 3600000, // 1 hour from now
        lastUsed: now
      };
    } else {
      usage.count++;
      usage.lastUsed = now;
    }
    
    scopeUsage.set(usageKey, usage);
  });
}

/**
 * Get scope usage statistics
 */
function getScopeUsageStatistics() {
  const stats = {
    total_scopes: Object.keys(SCOPE_TAXONOMY).length,
    active_scopes: 0,
    usage_by_scope: {},
    usage_by_client: {},
    high_risk_usage: 0,
    policy_violations: 0
  };

  const now = Date.now();
  const oneHourAgo = now - 3600000;

  scopeUsage.forEach((usage, key) => {
    const [scope, clientId] = key.split(':');
    
    // Count active scopes (used in last hour)
    if (usage.lastUsed > oneHourAgo) {
      stats.active_scopes++;
    }

    // Usage by scope
    if (!stats.usage_by_scope[scope]) {
      stats.usage_by_scope[scope] = 0;
    }
    stats.usage_by_scope[scope] += usage.count;

    // Usage by client
    if (!stats.usage_by_client[clientId]) {
      stats.usage_by_client[clientId] = 0;
    }
    stats.usage_by_client[clientId] += usage.count;

    // High risk usage
    const taxonomy = SCOPE_TAXONOMY[scope];
    if (taxonomy && ['high', 'critical'].includes(taxonomy.risk_level)) {
      stats.high_risk_usage += usage.count;
    }
  });

  return stats;
}

/**
 * Comprehensive scope validation
 */
function validateScopes(scopes, context = {}) {
  const results = {
    format: validateScopeFormat(scopes),
    compatibility: validateScopeCompatibility(scopes),
    risk: calculateRiskScore(scopes),
    policies: enforceScopePolicies(scopes, context)
  };

  // Overall validation result
  const allValid = results.format.valid && 
                   results.compatibility.valid && 
                   results.policies.allowed;

  return {
    valid: allValid,
    errors: [
      ...results.format.errors,
      ...results.compatibility.errors,
      ...results.policies.violations.map(v => v.type + ': ' + v.scope)
    ],
    results,
    risk_assessment: results.risk,
    policy_enforcement: results.policies
  };
}

/**
 * Get scope information and policies
 */
function getScopeInformation(scope) {
  const taxonomy = SCOPE_TAXONOMY[scope];
  const policy = SCOPE_POLICIES[scope];

  if (!taxonomy) {
    throw new Error(`Unknown scope: ${scope}`);
  }

  return {
    scope,
    taxonomy,
    policy: policy || {},
    risk_level: taxonomy.risk_level,
    category: taxonomy.category,
    description: taxonomy.description,
    operations: taxonomy.operations
  };
}

/**
 * Get all available scopes with metadata
 */
function getAllScopes() {
  return Object.entries(SCOPE_TAXONOMY).map(([scope, taxonomy]) => ({
    scope,
    description: taxonomy.description,
    risk_level: taxonomy.risk_level,
    category: taxonomy.category,
    operations: taxonomy.operations,
    requires_user_context: taxonomy.requires_user_context,
    policy: SCOPE_POLICIES[scope] || null
  }));
}

/**
 * Clean up expired scope usage records
 */
function cleanupScopeUsage() {
  const now = Date.now();
  let cleanedCount = 0;

  for (const [key, usage] of scopeUsage.entries()) {
    if (now > usage.resetTime) {
      scopeUsage.delete(key);
      cleanedCount++;
    }
  }

  if (cleanedCount > 0) {
    console.log(`[ScopePolicy] Cleaned up ${cleanedCount} expired scope usage records`);
  }

  return cleanedCount;
}

module.exports = {
  validateScopes,
  validateScopesForTool,
  enforceScopePolicies,
  updateScopeUsage,
  getScopeUsageStatistics,
  getScopeInformation,
  getAllScopes,
  calculateRiskScore,
  cleanupScopeUsage,
  SCOPE_TAXONOMY,
  SCOPE_POLICIES
};
