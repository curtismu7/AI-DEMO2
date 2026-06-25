/**
 * Admin Management API Routes
 * 
 * Provides administrative endpoints for PingOne Management API operations
 * including resource server setup, scope management, and configuration automation.
 */

'use strict';

const express = require('express');
const router = express.Router();
const { managementService } = require('../services/pingoneManagementService');
const { requireAdmin } = require('../middleware/auth');

/**
 * GET /api/admin/management/status
 * Check Management API connection status and get available configurations
 */
router.get('/status', requireAdmin, async (req, res) => {
  try {
    // Check if Management API is configured
    if (!process.env.PINGONE_MANAGEMENT_API_TOKEN) {
      return res.json({
        configured: false,
        error: 'Management API token not configured',
        message: 'Set PINGONE_MANAGEMENT_API_TOKEN to enable Management API features'
      });
    }

    // Initialize service and validate connection
    managementService.initialize();
    const connectionResult = await managementService.validateConnection();
    
    // Get predefined configurations
    const configurations = managementService.getPredefinedConfigurations();

    res.json({
      configured: true,
      connection: connectionResult,
      configurations: Object.keys(configurations),
      configDetails: configurations,
      environment: {
        environmentId: process.env.PINGONE_ENVIRONMENT_ID,
        region: process.env.PINGONE_REGION || 'com'
      }
    });
    
  } catch (error) {
    console.error('[adminManagement] GET /status error:', error.message);
    res.status(500).json({
      error: 'management_status_error',
      message: error.message
    });
  }
});

/**
 * GET /api/admin/management/resource-servers
 * List all resource servers in the environment
 */
router.get('/resource-servers', requireAdmin, async (req, res) => {
  try {
    if (!process.env.PINGONE_MANAGEMENT_API_TOKEN) {
      return res.status(403).json({
        error: 'management_api_not_configured',
        message: 'Management API token not configured'
      });
    }

    managementService.initialize();
    const result = await managementService.getResourceServers();
    
    if (result.success) {
      res.json({
        success: true,
        resourceServers: result.resourceServers,
        count: result.resourceServers.length
      });
    } else {
      res.status(500).json({
        error: 'resource_servers_list_error',
        message: result.error,
        details: result.details
      });
    }
    
  } catch (error) {
    console.error('[adminManagement] GET /resource-servers error:', error.message);
    res.status(500).json({
      error: 'resource_servers_error',
      message: error.message
    });
  }
});

/**
 * GET /api/admin/management/applications
 * List all applications in the environment
 */
router.get('/applications', requireAdmin, async (req, res) => {
  try {
    if (!process.env.PINGONE_MANAGEMENT_API_TOKEN) {
      return res.status(403).json({
        error: 'management_api_not_configured',
        message: 'Management API token not configured'
      });
    }

    managementService.initialize();
    const result = await managementService.getApplications();
    
    if (result.success) {
      res.json({
        success: true,
        applications: result.applications,
        count: result.applications.length
      });
    } else {
      res.status(500).json({
        error: 'applications_list_error',
        message: result.error,
        details: result.details
      });
    }
    
  } catch (error) {
    console.error('[adminManagement] GET /applications error:', error.message);
    res.status(500).json({
      error: 'applications_error',
      message: error.message
    });
  }
});

/**
 * POST /api/admin/management/setup-resource-server
 * Setup a resource server with predefined configuration
 */
router.post('/setup-resource-server', requireAdmin, async (req, res) => {
  try {
    const { configType, customConfig } = req.body;
    
    if (!process.env.PINGONE_MANAGEMENT_API_TOKEN) {
      return res.status(403).json({
        error: 'management_api_not_configured',
        message: 'Management API token not configured'
      });
    }

    managementService.initialize();
    
    let config;
    if (configType) {
      // Use predefined configuration
      const configurations = managementService.getPredefinedConfigurations();
      config = configurations[configType];
      
      if (!config) {
        return res.status(400).json({
          error: 'invalid_config_type',
          message: `Unknown configuration type: ${configType}`,
          availableTypes: Object.keys(configurations)
        });
      }
    } else if (customConfig) {
      // Use custom configuration
      config = customConfig;
    } else {
      return res.status(400).json({
        error: 'missing_config',
        message: 'Either configType or customConfig is required'
      });
    }

    console.log(`[adminManagement] Setting up resource server: ${config.name}`);
    const result = await managementService.setupCompleteResourceServer(config);
    
    if (result.success) {
      res.json({
        success: true,
        message: 'Resource server setup completed successfully',
        resourceServer: result.resourceServer,
        scopes: result.scopes,
        applications: result.applications,
        summary: {
          scopesCreated: result.scopes.filter(s => s.success).length,
          scopesFailed: result.scopes.filter(s => !s.success).length,
          applicationsCreated: result.applications.filter(a => a.success).length,
          applicationsFailed: result.applications.filter(a => !a.success).length
        }
      });
    } else {
      res.status(500).json({
        error: 'resource_server_setup_error',
        message: 'Resource server setup failed',
        errors: result.errors,
        partialResults: {
          resourceServer: result.resourceServer,
          scopes: result.scopes,
          applications: result.applications
        }
      });
    }
    
  } catch (error) {
    console.error('[adminManagement] POST /setup-resource-server error:', error.message);
    res.status(500).json({
      error: 'setup_resource_server_error',
      message: error.message
    });
  }
});

/**
 * POST /api/admin/management/create-resource-server
 * Create a single resource server
 */
router.post('/create-resource-server', requireAdmin, async (req, res) => {
  try {
    const { name, description, audienceUri } = req.body;
    
    if (!process.env.PINGONE_MANAGEMENT_API_TOKEN) {
      return res.status(403).json({
        error: 'management_api_not_configured',
        message: 'Management API token not configured'
      });
    }

    if (!name || !audienceUri) {
      return res.status(400).json({
        error: 'missing_required_fields',
        message: 'name and audienceUri are required'
      });
    }

    managementService.initialize();
    const result = await managementService.createResourceServer(name, description, audienceUri);
    
    if (result.success) {
      res.json({
        success: true,
        resourceServer: result.resourceServer,
        message: 'Resource server created successfully'
      });
    } else {
      res.status(500).json({
        error: 'create_resource_server_error',
        message: result.error,
        details: result.details
      });
    }
    
  } catch (error) {
    console.error('[adminManagement] POST /create-resource-server error:', error.message);
    res.status(500).json({
      error: 'create_resource_server_error',
      message: error.message
    });
  }
});

/**
 * POST /api/admin/management/create-scopes
 * Create scopes for a resource server
 */
router.post('/create-scopes', requireAdmin, async (req, res) => {
  try {
    const { resourceServerId, scopes } = req.body;
    
    if (!process.env.PINGONE_MANAGEMENT_API_TOKEN) {
      return res.status(403).json({
        error: 'management_api_not_configured',
        message: 'Management API token not configured'
      });
    }

    if (!resourceServerId || !scopes || !Array.isArray(scopes)) {
      return res.status(400).json({
        error: 'missing_required_fields',
        message: 'resourceServerId and scopes array are required'
      });
    }

    managementService.initialize();
    const result = await managementService.createScopes(resourceServerId, scopes);
    
    res.json({
      success: result.success,
      results: result.results,
      created: result.created,
      failed: result.failed,
      message: result.success ? 
        `Successfully created ${result.created} scopes` : 
        `Created ${result.created} scopes, ${result.failed} failed`
    });
    
  } catch (error) {
    console.error('[adminManagement] POST /create-scopes error:', error.message);
    res.status(500).json({
      error: 'create_scopes_error',
      message: error.message
    });
  }
});

/**
 * GET /api/admin/management/resource-server/:id/scopes
 * Get scopes for a specific resource server
 */
router.get('/resource-server/:id/scopes', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!process.env.PINGONE_MANAGEMENT_API_TOKEN) {
      return res.status(403).json({
        error: 'management_api_not_configured',
        message: 'Management API token not configured'
      });
    }

    managementService.initialize();
    const result = await managementService.getScopes(id);
    
    if (result.success) {
      res.json({
        success: true,
        scopes: result.scopes,
        count: result.scopes.length
      });
    } else {
      res.status(500).json({
        error: 'get_scopes_error',
        message: result.error,
        details: result.details
      });
    }
    
  } catch (error) {
    console.error('[adminManagement] GET /resource-server/:id/scopes error:', error.message);
    res.status(500).json({
      error: 'get_scopes_error',
      message: error.message
    });
  }
});

/**
 * POST /api/admin/management/create-application
 * Create an application
 */
router.post('/create-application', requireAdmin, async (req, res) => {
  try {
    const { name, description, type, grantTypes, redirectUris } = req.body;
    
    if (!process.env.PINGONE_MANAGEMENT_API_TOKEN) {
      return res.status(403).json({
        error: 'management_api_not_configured',
        message: 'Management API token not configured'
      });
    }

    if (!name || !type || !grantTypes) {
      return res.status(400).json({
        error: 'missing_required_fields',
        message: 'name, type, and grantTypes are required'
      });
    }

    managementService.initialize();
    const result = await managementService.createApplication(name, description, type, grantTypes, redirectUris);
    
    if (result.success) {
      res.json({
        success: true,
        application: result.application,
        message: 'Application created successfully'
      });
    } else {
      res.status(500).json({
        error: 'create_application_error',
        message: result.error,
        details: result.details
      });
    }
    
  } catch (error) {
    console.error('[adminManagement] POST /create-application error:', error.message);
    res.status(500).json({
      error: 'create_application_error',
      message: error.message
    });
  }
});

/**
 * POST /api/admin/management/validate-connection
 * Validate Management API connection
 */
router.post('/validate-connection', requireAdmin, async (req, res) => {
  try {
    if (!process.env.PINGONE_MANAGEMENT_API_TOKEN) {
      return res.json({
        valid: false,
        error: 'Management API token not configured',
        message: 'Set PINGONE_MANAGEMENT_API_TOKEN to enable Management API features'
      });
    }

    managementService.initialize();
    const result = await managementService.validateConnection();
    
    res.json({
      valid: result.success,
      connection: result,
      environment: {
        environmentId: process.env.PINGONE_ENVIRONMENT_ID,
        region: process.env.PINGONE_REGION || 'com'
      }
    });
    
  } catch (error) {
    console.error('[adminManagement] POST /validate-connection error:', error.message);
    res.status(500).json({
      valid: false,
      error: 'connection_validation_error',
      message: error.message
    });
  }
});

const { cache: attrCache } = require('../middleware/agentRestrictionsCache');

const VALID_AGENT_RESTRICTIONS = new Set(['write', 'read', 'none']);

/**
 * PATCH /api/admin/management/users/:userId/agent-restrictions
 * Update a user's agentRestrictions attribute in PingOne.
 * Also invalidates the local BFF attribute cache so the change takes effect within 5s.
 */
router.patch('/users/:userId/agent-restrictions', requireAdmin, async (req, res) => {
  const { agentRestrictions } = req.body;
  const { userId } = req.params;

  if (!VALID_AGENT_RESTRICTIONS.has(agentRestrictions)) {
    return res.status(400).json({
      error: 'invalid_value',
      message: `agentRestrictions must be one of: ${[...VALID_AGENT_RESTRICTIONS].join(', ')}`,
    });
  }

  try {
    managementService.initialize();
    const axios = require('axios');
    await axios.patch(
      `${managementService.baseURL}/users/${userId}`,
      { agentRestrictions },
      { headers: managementService.getHeaders() }
    );
    attrCache.invalidate(userId);
    return res.json({ userId, agentRestrictions, updated: true });
  } catch (error) {
    console.error('[adminManagement] PATCH /users/:userId/agent-restrictions error:', error.message);
    return res.status(500).json({ error: 'update_failed', message: error.message });
  }
});

module.exports = router;
