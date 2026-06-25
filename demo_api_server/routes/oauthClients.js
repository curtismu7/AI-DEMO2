/**
 * OAuth Client Registration API Routes
 * RESTful API for OAuth client management
 * 
 * Phase 57-01: OAuth Client Registration System
 * Security-focused implementation with comprehensive validation
 */

'use strict';

const express = require('express');
const router = express.Router();
const {
  registerOAuthClient,
  getClient,
  updateClient,
  deleteClient,
  rotateClientSecret,
  listClients,
  validateClientCredentials,
  getClientStatistics
} = require('../services/oauthClientRegistry');
const { requireAdmin } = require('../middleware/auth');

/**
 * Middleware to extract request metadata for audit logging
 */
function extractRequestMetadata(req, res, next) {
  req.metadata = {
    sourceIP: req.ip || req.connection.remoteAddress,
    userAgent: req.get('User-Agent'),
    requestId: req.id || require('crypto').randomUUID()
  };
  next();
}


/**
 * POST /api/oauth/clients/register
 * Register a new OAuth client
 */
router.post('/register', extractRequestMetadata, requireAdmin, async (req, res, next) => {
  try {
    const clientRequest = {
      client_name: req.body.client_name,
      client_type: req.body.client_type || 'confidential',
      grant_types: req.body.grant_types || ['client_credentials'],
      scope: req.body.scope ? req.body.scope.split(' ').filter(Boolean) : [],
      redirect_uris: req.body.redirect_uris || [],
      token_endpoint_auth_method: req.body.token_endpoint_auth_method || 'client_secret_basic'
    };

    const client = await registerOAuthClient(clientRequest, req.metadata);

    res.status(201).json({
      client_id: client.client_id,
      client_secret: client.client_secret,
      client_id_issued_at: client.client_id_issued_at,
      client_secret_expires_at: client.client_secret_expires_at,
      registration_access_token: client.registration_access_token,
      scope: client.scope,
      token_endpoint_auth_method: clientRequest.token_endpoint_auth_method,
      client_uri: null,
      logo_uri: null
    });

  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({
        error: 'invalid_client_metadata',
        error_description: err.message,
        errors: err.errors || []
      });
    }
    next(err);
  }
});

/**
 * GET /api/oauth/clients
 * List all clients (admin only)
 */
router.get('/', extractRequestMetadata, requireAdmin, async (req, res, next) => {
  try {
    const filter = {
      status: req.query.status,
      client_type: req.query.client_type
    };

    // Remove undefined filters
    Object.keys(filter).forEach(key => {
      if (filter[key] === undefined) {
        delete filter[key];
      }
    });

    const clients = listClients(filter);
    res.json({
      clients,
      total: clients.length
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/oauth/clients/statistics
 * Get client registry statistics (admin only)
 */
router.get('/statistics', extractRequestMetadata, requireAdmin, async (req, res, next) => {
  try {
    const stats = getClientStatistics();
    res.json(stats);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/oauth/clients/:clientId
 * Get client information
 */
router.get('/:clientId', extractRequestMetadata, requireAdmin, async (req, res, next) => {
  try {
    const client = getClient(req.params.clientId);
    res.json(client);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({
        error: 'invalid_client',
        error_description: err.message
      });
    }
    next(err);
  }
});

/**
 * PUT /api/oauth/clients/:clientId
 * Update client information
 */
router.put('/:clientId', extractRequestMetadata, requireAdmin, async (req, res, next) => {
  try {
    const updates = {
      client_name: req.body.client_name,
      scope: req.body.scope ? req.body.scope.split(' ').filter(Boolean) : undefined,
      token_endpoint_auth_method: req.body.token_endpoint_auth_method,
      status: req.body.status
    };

    // Remove undefined values
    Object.keys(updates).forEach(key => {
      if (updates[key] === undefined) {
        delete updates[key];
      }
    });

    const client = updateClient(req.params.clientId, updates, req.metadata);
    res.json(client);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({
        error: 'invalid_client_metadata',
        error_description: err.message,
        errors: err.errors || []
      });
    }
    next(err);
  }
});

/**
 * DELETE /api/oauth/clients/:clientId
 * Delete client
 */
router.delete('/:clientId', extractRequestMetadata, requireAdmin, async (req, res, next) => {
  try {
    deleteClient(req.params.clientId, req.metadata);
    res.status(204).send();
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({
        error: 'invalid_client',
        error_description: err.message
      });
    }
    next(err);
  }
});

/**
 * POST /api/oauth/clients/validate
 * Validate client credentials (internal use)
 */
router.post('/validate', extractRequestMetadata, requireAdmin, async (req, res, next) => {
  try {
    const { client_id, client_secret } = req.body;

    if (!client_id || !client_secret) {
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'client_id and client_secret are required'
      });
    }

    const validation = validateClientCredentials(client_id, client_secret);

    if (!validation.valid) {
      return res.status(401).json({
        error: 'invalid_client',
        error_description: validation.error
      });
    }

    res.json({
      active: true,
      client_id: validation.client.client_id,
      scope: validation.client.scope.join(' '),
      client_id_issued_at: validation.client.client_id_issued_at,
      token_endpoint_auth_method: validation.client.token_endpoint_auth_method
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/oauth/clients/:clientId/rotate-secret
 * Rotate client secret
 */
router.post('/:clientId/rotate-secret', extractRequestMetadata, requireAdmin, async (req, res, next) => {
  try {
    const result = rotateClientSecret(req.params.clientId, {
      ...req.metadata,
      reason: req.body.reason || 'manual'
    });
    res.json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({
        error: 'invalid_client',
        error_description: err.message
      });
    }
    next(err);
  }
});

/**
 * Error handling middleware
 */
router.use((err, req, res, next) => {
  console.error('[OAuth Clients] Error:', err);
  
  res.status(err.status || 500).json({
    error: 'server_error',
    error_description: 'Internal server error'
  });
});

module.exports = router;
