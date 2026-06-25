/**
 * Migration Layer and Backward Compatibility
 * Seamless transition from PATs to OAuth client credentials with staged deployment
 * 
 * Phase 57-04: Migration Layer and Backward Compatibility
 * Security-focused implementation with comprehensive compatibility support
 */

'use strict';

const crypto = require('crypto');
const { validateAccessToken } = require('./clientCredentialsTokenService');
const { writeExchangeEvent } = require('./exchangeAuditStore');

/**
 * Migration configuration
 */
const MIGRATION_CONFIG = {
  // Staged deployment phases
  phases: {
    'preparation': {
      description: 'Preparation phase - OAuth infrastructure ready',
      patSupport: 'full',
      oauthSupport: 'testing',
      warnings: false,
      deprecationDate: null
    },
    'transition': {
      description: 'Transition phase - Both methods supported with warnings',
      patSupport: 'full',
      oauthSupport: 'full',
      warnings: true,
      deprecationDate: null
    },
    'deprecation': {
      description: 'Deprecation phase - PATs deprecated with clear timeline',
      patSupport: 'deprecated',
      oauthSupport: 'full',
      warnings: true,
      deprecationDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) // 90 days from now
    },
    'sunset': {
      description: 'Sunset phase - PATs no longer supported',
      patSupport: 'disabled',
      oauthSupport: 'full',
      warnings: false,
      deprecationDate: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000) // 180 days from now
    }
  },
  currentPhase: 'transition', // Can be configured via environment variable
  environment: process.env.NODE_ENV || 'development'
};

/**
 * PAT storage and validation (existing system)
 */
const patStore = new Map();

/**
 * Migration statistics tracking
 */
const migrationStats = {
  total_requests: 0,
  pat_requests: 0,
  oauth_requests: 0,
  pat_migrations: 0,
  oauth_adoptions: 0,
  warnings_generated: 0,
  errors_prevented: 0,
  phase_transitions: 0
};

/**
 * Audit event logging for migration operations
 */
function logMigrationEvent(eventType, migrationData, details = {}) {
  const auditEvent = {
    type: 'migration-event',
    level: 'info',
    timestamp: new Date().toISOString(),
    eventType,
    ...migrationData,
    ...details,
    security: {
      sourceIP: details.sourceIP || 'unknown',
      userAgent: details.userAgent || 'unknown',
      requestId: details.requestId || crypto.randomUUID()
    }
  };

  writeExchangeEvent(auditEvent).catch(err => {
    console.error('[MigrationLayer] Failed to log migration event:', err.message);
  });
}

/**
 * Get current migration phase
 */
function getCurrentPhase() {
  const envPhase = process.env.MIGRATION_PHASE;
  if (envPhase && MIGRATION_CONFIG.phases[envPhase]) {
    return envPhase;
  }
  return MIGRATION_CONFIG.currentPhase;
}

/**
 * Detect authentication method from request
 */
function detectAuthMethod(req) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    return { method: 'none', valid: false, reason: 'No authorization header' };
  }

  // OAuth Bearer token
  if (authHeader.startsWith('Bearer ')) {
    return { method: 'oauth', valid: true, token: authHeader.slice(7) };
  }

  // PAT token
  if (authHeader.startsWith('PAT ')) {
    return { method: 'pat', valid: true, token: authHeader.slice(4) };
  }

  // Legacy API key (if supported)
  if (authHeader.startsWith('API-Key ')) {
    return { method: 'api_key', valid: true, token: authHeader.slice(8) };
  }

  // Basic auth (for OAuth client credentials)
  if (authHeader.startsWith('Basic ')) {
    return { method: 'basic', valid: true, token: authHeader.slice(6) };
  }

  return { method: 'unknown', valid: false, reason: 'Unsupported auth method' };
}

/**
 * Validate PAT token (existing system)
 */
function validatePATToken(token, metadata = {}) {
  // Mock PAT validation - in production, this would validate against existing PAT system
  const patRecord = patStore.get(token);
  
  if (!patRecord) {
    return { valid: false, error: 'Invalid PAT token' };
  }

  if (patRecord.expiresAt && Date.now() > patRecord.expiresAt) {
    return { valid: false, error: 'PAT token expired' };
  }

  if (patRecord.revoked) {
    return { valid: false, error: 'PAT token revoked' };
  }

  // Update usage tracking
  patRecord.lastUsed = Date.now();
  patRecord.usageCount = (patRecord.usageCount || 0) + 1;

  return {
    valid: true,
    pat: patRecord,
    scopes: patRecord.scopes || ['read', 'write'],
    clientId: patRecord.clientId || 'pat-user'
  };
}

/**
 * Generate migration warning for PAT usage
 */
function generatePATWarning(authMethod, patInfo, metadata = {}) {
  const phase = getCurrentPhase();
  const phaseConfig = MIGRATION_CONFIG.phases[phase];

  if (!phaseConfig.warnings) {
    return null;
  }

  const warning = {
    type: 'pat_deprecation_warning',
    message: 'Personal Access Token (PAT) usage detected',
    phase,
    recommendation: 'Migrate to OAuth client credentials for enhanced security',
    migration_guide: 'https://docs.example.com/migration-guide',
    deprecation_date: phaseConfig.deprecationDate,
    pat_info: {
      created_at: patInfo.pat?.createdAt,
      last_used: patInfo.pat?.lastUsed,
      usage_count: patInfo.pat?.usageCount
    }
  };

  // Add phase-specific details
  if (phase === 'deprecation') {
    warning.urgency = 'high';
    warning.action_required = true;
    warning.days_until_sunset = Math.ceil((phaseConfig.deprecationDate - Date.now()) / (24 * 60 * 60 * 1000));
  } else if (phase === 'transition') {
    warning.urgency = 'medium';
    warning.action_required = false;
  }

  migrationStats.warnings_generated++;

  logMigrationEvent('pat_warning_generated', {
    pat_id: patInfo.pat?.id,
    phase,
    urgency: warning.urgency
  }, metadata);

  return warning;
}

/**
 * Dual authentication middleware
 */
function authenticateRequest(req, res, next) {
  const metadata = {
    sourceIP: req.ip || req.connection.remoteAddress,
    userAgent: req.get('User-Agent'),
    requestId: req.id || crypto.randomUUID(),
    endpoint: req.path,
    method: req.method
  };

  migrationStats.total_requests++;

  const authMethod = detectAuthMethod(req);
  req.authMethod = authMethod.method;

  if (!authMethod.valid) {
    return res.status(401).json({
      error: 'invalid_authentication',
      error_description: authMethod.reason || 'Invalid authentication method'
    });
  }

  const phase = getCurrentPhase();
  const phaseConfig = MIGRATION_CONFIG.phases[phase];

  // Handle OAuth authentication
  if (authMethod.method === 'oauth') {
    try {
      const validation = validateAccessToken(authMethod.token, metadata);
      
      if (!validation.valid) {
        return res.status(401).json({
          error: 'invalid_token',
          error_description: 'Invalid OAuth token'
        });
      }

      req.oauthToken = validation.payload;
      req.oauthTokenScopes = validation.tokenScopes;
      req.authType = 'oauth';
      migrationStats.oauth_requests++;

      logMigrationEvent('oauth_auth_success', {
        client_id: validation.payload.client_id,
        scopes: validation.tokenScopes
      }, metadata);

      return next();
    } catch (error) {
      return res.status(401).json({
        error: 'invalid_token',
        error_description: error.message
      });
    }
  }

  // Handle PAT authentication (with migration support)
  if (authMethod.method === 'pat') {
    const patValidation = validatePATToken(authMethod.token, metadata);
    
    if (!patValidation.valid) {
      return res.status(401).json({
        error: 'invalid_pat',
        error_description: patValidation.error
      });
    }

    // Check if PATs are supported in current phase
    if (phaseConfig.patSupport === 'disabled') {
      return res.status(401).json({
        error: 'pat_not_supported',
        error_description: 'Personal Access Tokens are no longer supported. Please use OAuth client credentials.',
        migration_guide: 'https://docs.example.com/migration-guide'
      });
    }

    if (phaseConfig.patSupport === 'deprecated') {
      const warning = generatePATWarning(authMethod, patValidation, metadata);
      
      // Include warning in response headers
      res.set({
        'X-PAT-Deprecation-Warning': 'true',
        'X-Migration-Phase': phase,
        'X-Migration-Guide': 'https://docs.example.com/migration-guide'
      });
    }

    req.patToken = patValidation.pat;
    req.patScopes = patValidation.scopes;
    req.authType = 'pat';
    migrationStats.pat_requests++;

    logMigrationEvent('pat_auth_success', {
      pat_id: patValidation.pat?.id,
      scopes: patValidation.scopes,
      phase
    }, metadata);

    // Add warning to response if applicable
    if (phaseConfig.warnings) {
      res.locals.patWarning = generatePATWarning(authMethod, patValidation, metadata);
    }

    return next();
  }

  // Handle other authentication methods
  return res.status(401).json({
    error: 'unsupported_auth_method',
    error_description: 'Authentication method not supported'
  });
}

/**
 * Migration utilities for existing PAT users
 */
const migrationUtilities = {
  /**
   * Generate OAuth client credentials for PAT user
   */
  generateOAuthClientForPATUser: (patUser, metadata = {}) => {
    const clientData = {
      client_name: `Migrated from PAT - ${patUser.name || 'Unknown'}`,
      client_type: 'confidential',
      grant_types: ['client_credentials'],
      scope: patUser.scopes || ['read', 'write'],
      token_endpoint_auth_method: 'client_secret_basic'
    };

    // This would call the OAuth client registration service
    const oauthClient = {
      client_id: `migrated-pat-${crypto.randomBytes(16).toString('hex')}`,
      client_secret: crypto.randomBytes(32).toString('hex'),
      registration_access_token: crypto.randomBytes(32).toString('hex'),
      migration_metadata: {
        pat_id: patUser.id,
        migrated_at: new Date().toISOString(),
        migrated_by: metadata.migratedBy || 'system',
        original_pat_scopes: patUser.scopes
      }
    };

    logMigrationEvent('pat_to_oauth_migration', {
      pat_id: patUser.id,
      oauth_client_id: oauthClient.client_id
    }, metadata);

    migrationStats.pat_migrations++;

    return oauthClient;
  },

  /**
   * Validate PAT migration eligibility
   */
  validateMigrationEligibility: (patUser) => {
    const issues = [];
    const recommendations = [];

    // Check if PAT has appropriate scopes
    if (!patUser.scopes || patUser.scopes.length === 0) {
      issues.push('PAT has no defined scopes');
      recommendations.push('Define appropriate scopes for OAuth client');
    }

    // Check PAT usage patterns
    if (patUser.usageCount > 10000) {
      issues.push('High usage PAT may need multiple OAuth clients');
      recommendations.push('Consider creating multiple OAuth clients for different use cases');
    }

    // Check PAT age
    const patAge = Date.now() - (patUser.createdAt || 0);
    if (patAge > 365 * 24 * 60 * 60 * 1000) { // 1 year
      issues.push('Old PAT may have accumulated permissions');
      recommendations.push('Review and minimize scopes for OAuth client');
    }

    return {
      eligible: issues.length === 0,
      issues,
      recommendations,
      migration_complexity: issues.length > 2 ? 'high' : issues.length > 0 ? 'medium' : 'low'
    };
  },

  /**
   * Create migration plan for PAT user
   */
  createMigrationPlan: (patUser, options = {}) => {
    const eligibility = migrationUtilities.validateMigrationEligibility(patUser);
    
    const plan = {
      pat_id: patUser.id,
      pat_name: patUser.name || 'Unknown',
      current_scopes: patUser.scopes || [],
      eligible: eligibility.eligible,
      issues: eligibility.issues,
      recommendations: eligibility.recommendations,
      migration_complexity: eligibility.migration_complexity,
      steps: []
    };

    // Add migration steps
    plan.steps.push({
      step: 1,
      action: 'Register OAuth client',
      description: 'Create OAuth client with appropriate scopes',
      estimated_time: '5 minutes',
      automated: options.automated || false
    });

    plan.steps.push({
      step: 2,
      action: 'Update integration code',
      description: 'Replace PAT authentication with OAuth client credentials',
      estimated_time: '30 minutes',
      automated: false
    });

    plan.steps.push({
      step: 3,
      action: 'Test OAuth integration',
      description: 'Verify OAuth client credentials work correctly',
      estimated_time: '10 minutes',
      automated: false
    });

    plan.steps.push({
      step: 4,
      action: 'Retire PAT',
      description: 'Revoke PAT token after successful OAuth migration',
      estimated_time: '2 minutes',
      automated: true
    });

    return plan;
  }
};

/**
 * Migration dashboard data
 */
function getMigrationDashboard() {
  const phase = getCurrentPhase();
  const phaseConfig = MIGRATION_CONFIG.phases[phase];

  return {
    current_phase: phase,
    phase_description: phaseConfig.description,
    pat_support: phaseConfig.patSupport,
    oauth_support: phaseConfig.oauthSupport,
    warnings_enabled: phaseConfig.warnings,
    deprecation_date: phaseConfig.deprecationDate,
    statistics: {
      ...migrationStats,
      pat_adoption_rate: migrationStats.total_requests > 0 
        ? (migrationStats.pat_requests / migrationStats.total_requests * 100).toFixed(2) + '%'
        : '0%',
      oauth_adoption_rate: migrationStats.total_requests > 0
        ? (migrationStats.oauth_requests / migrationStats.total_requests * 100).toFixed(2) + '%'
        : '0%',
      migration_success_rate: migrationStats.pat_requests > 0
        ? (migrationStats.pat_migrations / migrationStats.pat_requests * 100).toFixed(2) + '%'
        : '0%'
    },
    timeline: {
      days_until_deprecation: phaseConfig.deprecationDate 
        ? Math.ceil((phaseConfig.deprecationDate - Date.now()) / (24 * 60 * 60 * 1000))
        : null,
      recommended_actions: getRecommendedActions(phase)
    }
  };
}

/**
 * Get recommended actions for current phase
 */
function getRecommendedActions(phase) {
  const actions = [];

  switch (phase) {
    case 'preparation':
      actions.push({
        priority: 'high',
        action: 'Prepare OAuth infrastructure',
        description: 'Set up OAuth client registration and token services'
      });
      break;

    case 'transition':
      actions.push({
        priority: 'medium',
        action: 'Begin PAT migration',
        description: 'Start migrating high-usage PATs to OAuth clients'
      });
      actions.push({
        priority: 'low',
        action: 'Monitor adoption',
        description: 'Track OAuth vs PAT usage patterns'
      });
      break;

    case 'deprecation':
      actions.push({
        priority: 'high',
        action: 'Complete PAT migration',
        description: 'Migrate all remaining PATs before sunset'
      });
      actions.push({
        priority: 'medium',
        action: 'Communicate timeline',
        description: 'Notify users about upcoming PAT sunset'
      });
      break;

    case 'sunset':
      actions.push({
        priority: 'low',
        action: 'Maintain OAuth system',
        description: 'Continue monitoring OAuth usage and performance'
      });
      break;
  }

  return actions;
}

/**
 * Update migration phase
 */
function updateMigrationPhase(newPhase, metadata = {}) {
  if (!MIGRATION_CONFIG.phases[newPhase]) {
    throw new Error(`Invalid migration phase: ${newPhase}`);
  }

  const oldPhase = MIGRATION_CONFIG.currentPhase;
  MIGRATION_CONFIG.currentPhase = newPhase;

  migrationStats.phase_transitions++;

  logMigrationEvent('phase_transition', {
    old_phase: oldPhase,
    new_phase: newPhase,
    phase_description: MIGRATION_CONFIG.phases[newPhase].description
  }, metadata);

  return {
    old_phase: oldPhase,
    new_phase: newPhase,
    timestamp: new Date().toISOString()
  };
}

/**
 * Initialize migration layer
 */
function initializeMigrationLayer() {
  const phase = getCurrentPhase();
  
  console.log(`[MigrationLayer] Initialized in phase: ${phase}`);
  console.log(`[MigrationLayer] PAT support: ${MIGRATION_CONFIG.phases[phase].patSupport}`);
  console.log(`[MigrationLayer] OAuth support: ${MIGRATION_CONFIG.phases[phase].oauth_support}`);
  
  logMigrationEvent('migration_layer_initialized', {
    phase,
    pat_support: MIGRATION_CONFIG.phases[phase].patSupport,
    oauth_support: MIGRATION_CONFIG.phases[phase].oauth_support
  });
}

module.exports = {
  authenticateRequest,
  migrationUtilities,
  getMigrationDashboard,
  updateMigrationPhase,
  getCurrentPhase,
  initializeMigrationLayer,
  MIGRATION_CONFIG,
  migrationStats
};
