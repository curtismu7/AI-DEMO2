/**
 * Migration API Routes
 * Provides endpoints for migration management and monitoring
 * 
 * Phase 57-04: Migration Layer and Backward Compatibility
 * RESTful API for migration dashboard and utilities
 */

'use strict';

const express = require('express');
const router = express.Router();

const {
  migrationUtilities,
  getMigrationDashboard,
  updateMigrationPhase,
  getCurrentPhase,
  MIGRATION_CONFIG,
  migrationStats
} = require('../services/migrationLayer');

const { writeExchangeEvent } = require('../services/exchangeAuditStore');

/**
 * Middleware for admin-only endpoints
 */
function requireAdminAccess(req, res, next) {
  // Check if user has admin privileges
  // This would integrate with existing auth system
  const isAdmin = req.auth?.scopes?.includes('admin:read');
  
  if (!isAdmin) {
    return res.status(403).json({
      error: 'admin_required',
      message: 'Admin access required for this operation'
    });
  }
  
  next();
}

/**
 * GET /api/migration/status
 * Get current migration status and configuration
 */
router.get('/status', async (req, res) => {
  try {
    const currentPhase = getCurrentPhase();
    const phaseConfig = MIGRATION_CONFIG.phases[currentPhase];
    
    const status = {
      current_phase: currentPhase,
      phase_description: phaseConfig.description,
      pat_support: phaseConfig.patSupport,
      oauth_support: phaseConfig.oauth_support,
      warnings_enabled: phaseConfig.warnings,
      deprecation_date: phaseConfig.deprecationDate ? phaseConfig.deprecationDate.toISOString() : null,
      statistics: {
        total_requests: migrationStats.total_requests,
        pat_requests: migrationStats.pat_requests,
        oauth_requests: migrationStats.oauth_requests,
        pat_warnings: migrationStats.pat_warnings,
        pat_rejections: migrationStats.pat_rejections,
        migration_progress: migrationStats.migration_progress
      },
      last_updated: migrationStats.last_updated
    };

    await writeExchangeEvent({
      timestamp: new Date().toISOString(),
      eventType: 'migration_status_viewed',
      phase: currentPhase,
      statistics: status.statistics,
      sourceIP: req.ip
    });

    res.json(status);

  } catch (error) {
    console.error('Error getting migration status:', error);
    
    await writeExchangeEvent({
      timestamp: new Date().toISOString(),
      eventType: 'migration_status_error',
      error: error.message,
      sourceIP: req.ip
    });

    res.status(500).json({
      error: 'status_error',
      message: 'Failed to retrieve migration status'
    });
  }
});

/**
 * GET /api/migration/dashboard
 * Get comprehensive migration dashboard data
 */
router.get('/dashboard', requireAdminAccess, async (req, res) => {
  try {
    const dashboard = getMigrationDashboard();
    
    await writeExchangeEvent({
      timestamp: new Date().toISOString(),
      eventType: 'migration_dashboard_viewed',
      dashboard_summary: {
        total_integrations: dashboard.summary.total_integrations,
        migration_progress: dashboard.summary.migration_progress_percentage,
        health_status: dashboard.health.status
      },
      sourceIP: req.ip,
      user: req.auth.user
    });

    res.json(dashboard);

  } catch (error) {
    console.error('Error getting migration dashboard:', error);
    
    await writeExchangeEvent({
      timestamp: new Date().toISOString(),
      eventType: 'migration_dashboard_error',
      error: error.message,
      sourceIP: req.ip,
      user: req.auth.user
    });

    res.status(500).json({
      error: 'dashboard_error',
      message: 'Failed to retrieve migration dashboard'
    });
  }
});

/**
 * POST /api/migration/phase
 * Update migration phase (admin only)
 */
router.post('/phase', requireAdminAccess, async (req, res) => {
  try {
    const { newPhase, metadata } = req.body;

    if (!newPhase || !MIGRATION_CONFIG.phases[newPhase]) {
      return res.status(400).json({
        error: 'invalid_phase',
        message: 'Invalid or missing migration phase',
        valid_phases: Object.keys(MIGRATION_CONFIG.phases)
      });
    }

    const transition = updateMigrationPhase(newPhase, metadata);
    
    await writeExchangeEvent({
      timestamp: new Date().toISOString(),
      eventType: 'migration_phase_updated',
      transition,
      metadata,
      sourceIP: req.ip,
      user: req.auth.user
    });

    res.json({
      message: 'Migration phase updated successfully',
      transition,
      current_phase: getCurrentPhase()
    });

  } catch (error) {
    console.error('Error updating migration phase:', error);
    
    await writeExchangeEvent({
      timestamp: new Date().toISOString(),
      eventType: 'migration_phase_update_error',
      error: error.message,
      requested_phase: req.body.newPhase,
      sourceIP: req.ip,
      user: req.auth.user
    });

    res.status(500).json({
      error: 'phase_update_error',
      message: 'Failed to update migration phase'
    });
  }
});

/**
 * GET /api/migration/guide
 * Get migration guide for PAT users
 */
router.get('/guide', async (req, res) => {
  try {
    const currentPhase = getCurrentPhase();
    
    const guide = {
      title: 'Migration Guide: Personal Access Tokens to OAuth Client Credentials',
      current_phase: currentPhase,
      urgency: getMigrationUrgency(currentPhase),
      steps: [
        {
          step: 1,
          title: 'Register OAuth Client',
          description: 'Register your integration as an OAuth client using the client registration API',
          endpoint: '/api/oauth/clients',
          method: 'POST',
          example: {
            name: 'My Banking Integration',
            description: 'Integration for account management',
            scopes: ['read', 'write']
          }
        },
        {
          step: 2,
          title: 'Update Authentication Code',
          description: 'Replace PAT authentication with OAuth client credentials',
          code_example: {
            old: 'Authorization: PAT <personal-access-token>',
            new: 'Authorization: Basic <base64(client_id:client_secret)>',
            token_endpoint: '/api/oauth/token'
          }
        },
        {
          step: 3,
          title: 'Test Integration',
          description: 'Test your integration with OAuth tokens before disabling PATs',
          test_steps: [
            'Request OAuth access token',
            'Make API calls with Bearer token',
            'Verify all functionality works',
            'Monitor token usage and expiry'
          ]
        },
        {
          step: 4,
          title: 'Deprecate PAT',
          description: 'Once OAuth is working, remove PAT usage from your code',
          cleanup_steps: [
            'Remove PAT from code and configuration',
            'Revoke PAT if no longer needed',
            'Update documentation',
            'Monitor for any remaining PAT usage'
          ]
        }
      ],
      timeline: getMigrationTimeline(currentPhase),
      support: {
        documentation: '/docs/oauth-integration',
        api_reference: '/docs/api/oauth',
        support_contact: 'support@banking-api.com'
      }
    };

    await writeExchangeEvent({
      timestamp: new Date().toISOString(),
      eventType: 'migration_guide_viewed',
      phase: currentPhase,
      urgency: guide.urgency.level,
      sourceIP: req.ip
    });

    res.json(guide);

  } catch (error) {
    console.error('Error getting migration guide:', error);
    
    res.status(500).json({
      error: 'guide_error',
      message: 'Failed to retrieve migration guide'
    });
  }
});

/**
 * POST /api/migration/validate
 * Validate OAuth token setup for migration
 */
router.post('/validate', async (req, res) => {
  try {
    const { clientId, clientSecret, scopes } = req.body;

    if (!clientId || !clientSecret) {
      return res.status(400).json({
        error: 'invalid_credentials',
        message: 'Client ID and secret are required'
      });
    }

    // Simulate OAuth token validation
    // In production, this would use the actual token service
    const validationResult = await migrationUtilities.validateOAuthSetup({
      clientId,
      clientSecret,
      scopes: scopes || ['read']
    });

    await writeExchangeEvent({
      timestamp: new Date().toISOString(),
      eventType: 'migration_validation_attempt',
      client_id: clientId,
      scopes,
      validation_result: validationResult.valid,
      sourceIP: req.ip
    });

    res.json(validationResult);

  } catch (error) {
    console.error('Error validating OAuth setup:', error);
    
    await writeExchangeEvent({
      timestamp: new Date().toISOString(),
      eventType: 'migration_validation_error',
      error: error.message,
      sourceIP: req.ip
    });

    res.status(500).json({
      error: 'validation_error',
      message: 'Failed to validate OAuth setup'
    });
  }
});

/**
 * GET /api/migration/statistics
 * Get detailed migration statistics
 */
router.get('/statistics', requireAdminAccess, async (req, res) => {
  try {
    const { period = '30d' } = req.query;
    
    const statistics = await migrationUtilities.getDetailedStatistics(period);
    
    await writeExchangeEvent({
      timestamp: new Date().toISOString(),
      eventType: 'migration_statistics_viewed',
      period,
      sourceIP: req.ip,
      user: req.auth.user
    });

    res.json(statistics);

  } catch (error) {
    console.error('Error getting migration statistics:', error);
    
    res.status(500).json({
      error: 'statistics_error',
      message: 'Failed to retrieve migration statistics'
    });
  }
});

/**
 * POST /api/migration/export
 * Export migration data for analysis
 */
router.post('/export', requireAdminAccess, async (req, res) => {
  try {
    const { format = 'json', include_details = false } = req.body;
    
    const exportData = await migrationUtilities.exportMigrationData({
      format,
      include_details,
      requested_by: req.auth.user
    });
    
    await writeExchangeEvent({
      timestamp: new Date().toISOString(),
      eventType: 'migration_data_exported',
      format,
      include_details,
      export_size: exportData.data.length,
      sourceIP: req.ip,
      user: req.auth.user
    });

    // Set appropriate content type based on format
    const contentType = format === 'csv' ? 'text/csv' : 'application/json';
    const filename = `migration_export_${new Date().toISOString().split('T')[0]}.${format}`;
    
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(exportData.data);

  } catch (error) {
    console.error('Error exporting migration data:', error);
    
    await writeExchangeEvent({
      timestamp: new Date().toISOString(),
      eventType: 'migration_export_error',
      error: error.message,
      format: req.body.format,
      sourceIP: req.ip,
      user: req.auth.user
    });

    res.status(500).json({
      error: 'export_error',
      message: 'Failed to export migration data'
    });
  }
});

/**
 * Helper functions
 */

function getMigrationUrgency(phase) {
  const urgencyMap = {
    'preparation': { level: 'low', message: 'Prepare for upcoming migration' },
    'transition': { level: 'medium', message: 'Begin migrating to OAuth client credentials' },
    'deprecation': { level: 'high', message: 'PATs deprecated - migrate immediately' },
    'sunset': { level: 'critical', message: 'PATs no longer supported' }
  };
  
  return urgencyMap[phase] || { level: 'unknown', message: 'Unknown migration phase' };
}

function getMigrationTimeline(phase) {
  const phaseConfig = MIGRATION_CONFIG.phases[phase];
  
  return {
    current_phase: {
      name: phase,
      description: phaseConfig.description,
      start_date: '2024-01-01T00:00:00.000Z', // Would be tracked in real implementation
      deprecation_date: phaseConfig.deprecationDate ? phaseConfig.deprecationDate.toISOString() : null
    },
    upcoming_phases: getUpcomingPhases(phase),
    recommendations: getPhaseRecommendations(phase)
  };
}

function getUpcomingPhases(currentPhase) {
  const phases = Object.keys(MIGRATION_CONFIG.phases);
  const currentIndex = phases.indexOf(currentPhase);
  
  return phases.slice(currentIndex + 1).map(phase => ({
    name: phase,
    description: MIGRATION_CONFIG.phases[phase].description,
    estimated_start: 'TBD' // Would be calculated based on configuration
  }));
}

function getPhaseRecommendations(phase) {
  const recommendations = {
    'preparation': [
      'Review OAuth client credentials documentation',
      'Identify integrations using PATs',
      'Plan migration timeline for your team'
    ],
    'transition': [
      'Register OAuth clients for your integrations',
      'Update authentication code to use OAuth',
      'Test OAuth functionality thoroughly'
    ],
    'deprecation': [
      'Complete migration to OAuth immediately',
      'Remove all PAT usage from production code',
      'Revoke unused PATs'
    ],
    'sunset': [
      'Ensure all integrations use OAuth',
      'Monitor OAuth token usage and performance',
      'Maintain OAuth client credentials security'
    ]
  };
  
  return recommendations[phase] || [];
}

module.exports = router;
