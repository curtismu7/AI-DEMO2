/**
 * Token Introspection Route
 * POST /api/introspect - Validate Bearer tokens and return scope information
 * 
 * Phase 91-01: External client token validation
 * Implements RFC 7662 (OAuth 2.0 Token Introspection)
 * 
 * Security: No authentication required on this endpoint.
 * External clients use this to validate their own tokens.
 */

'use strict';

const express = require('express');
const router = express.Router();
const { validateToken, extractScopes } = require('../services/tokenIntrospectionService');
const { logger: structuredLoggerInstance, LOG_CATEGORIES } = require('../utils/logger');
// logger is a StructuredLogger instance — use console.log as the log function for compatibility
const logger = (category, message, data) => console.log(`[${category}]`, message, data || '');

/**
 * POST /api/introspect
 * Introspect a Bearer token to validate it and extract scopes.
 * 
 * Request body: { token: "..." } OR Authorization: Bearer <token>
 * Response: RFC 7662 introspection response
 */
// Router is mounted at '/api/introspect' (see server.js), so the handler path is
// '/' — together they form POST /api/introspect (not /api/introspect/introspect).
router.post('/', async (req, res) => {
  try {
    let token = null;

    // Try to get token from request body first
    if (req.body && req.body.token) {
      token = req.body.token;
    }

    // Try to extract from Authorization header (Bearer token)
    if (!token && req.headers.authorization) {
      const authHeader = req.headers.authorization;
      const matches = authHeader.match(/^Bearer\s+([^\s]+)$/i);
      if (matches && matches[1]) {
        token = matches[1];
      }
    }

    // Token is required
    if (!token) {
      logger(LOG_CATEGORIES.AUTH, 'Introspection request missing token', {
        hasBody: !!req.body,
        hasAuthHeader: !!req.headers.authorization,
      });
      return res.status(400).json({
        error: 'invalid_request',
        error_description: 'Missing token in request body or Authorization header',
      });
    }

    // Validate token
    const introspectionResult = await validateToken(token);

    // Build RFC 7662 response
    const response = {
      active: introspectionResult.valid,
    };

    // Include additional metadata if token is valid
    if (introspectionResult.valid) {
      if (introspectionResult.scopes && introspectionResult.scopes.length > 0) {
        response.scope = introspectionResult.scopes.join(' ');
      }
      if (introspectionResult.client_id) {
        response.client_id = introspectionResult.client_id;
      }
      if (introspectionResult.sub) {
        response.sub = introspectionResult.sub;
      }
      if (introspectionResult.exp) {
        response.exp = introspectionResult.exp;
      }
      if (introspectionResult.iat) {
        response.iat = introspectionResult.iat;
      }
      if (introspectionResult.aud) {
        response.aud = introspectionResult.aud;
      }
      if (introspectionResult.token_type) {
        response.token_type = introspectionResult.token_type;
      }
      if (introspectionResult.username) {
        response.username = introspectionResult.username;
      }
    }

    // Return introspection response (always 200, per RFC 7662)
    res.json(response);

  } catch (error) {
    logger(LOG_CATEGORIES.ERROR, 'Introspection route error', {
      error: error.message,
      stack: error.stack,
    });

    // Server error during introspection
    res.status(500).json({
      error: 'server_error',
      error_description: 'Failed to introspect token',
    });
  }
});

module.exports = router;
