/**
 * Audience (aud) Claim Configuration
 *
 * Defines audience values for all APIs and services in the system.
 * These values are used to:
 * 1. Validate the 'aud' claim in incoming OAuth tokens (fail-closed policy)
 * 2. Ensure tokens are intended for the correct recipient (prevent token confusion)
 * 3. Configure PingOne applications with the correct audience values
 *
 * References:
 * - RFC 6749 Section 5.3 — Aud claim in OAuth access tokens
 * - RFC 8693 Section 3 — Token Exchange (aud parameter for target resource)
 * - docs/ENVIRONMENT_MAPPING_AUD_AUDIT.md — Complete aud value audit per environment
 */

'use strict';

const NODE_ENV = process.env.NODE_ENV || 'development';

/**
 * BFF API Audience
 * Used to validate user tokens and agent (actor) tokens accessing the banking API.
 * Identifies the BFF as the intended recipient of the token.
 *
 * Environment-specific defaults:
 * - development: https://banking-api.local
 * - vercel (staging): https://banking-api.vercel.app
 * - production: https://banking-api-prod.example.com (configure via AUD_BFF_API env var)
 */
const BFF_AUD = (() => {
  // Allow override via environment variable (useful for different deployments)
  if (process.env.AUD_BFF_API) {
    return process.env.AUD_BFF_API;
  }

  // Default per environment
  switch (NODE_ENV) {
    case 'production':
      return 'https://banking-api-prod.example.com';
    case 'vercel':
    case 'staging':
      return 'https://banking-api.vercel.app';
    case 'development':
    default:
      return 'https://banking-api.local';
  }
})();

/**
 * MCP Server Audience
 * Used to validate tokens accessing the MCP (Model Context Protocol) gateway.
 * Identifies the MCP server as the intended recipient of delegated tokens.
 *
 * Environment-specific defaults:
 * - development: mcp.pingdemo.com
 * - vercel (staging): mcp.pingstaging.com
 * - production: mcp.example.com (configure via AUD_MCP_SERVER env var)
 */
const MCP_SERVER_AUD = (() => {
  // Allow override via environment variable
  if (process.env.AUD_MCP_SERVER) {
    return process.env.AUD_MCP_SERVER;
  }

  // Default per environment
  switch (NODE_ENV) {
    case 'production':
      return 'mcp.example.com';
    case 'vercel':
    case 'staging':
      return 'mcp.pingstaging.com';
    case 'development':
    default:
      return 'mcp.pingdemo.com';
  }
})();

/**
 * PingOne Resource Audiences
 * Each PingOne resource server has its own audience identifier.
 * Used for validating tokens targeting PingOne Management API.
 *
 * Format: https://api.pingone.com/v1/environments/{ENV_ID}/{resource}
 */
const RESOURCE_AUDS = {
  /**
   * PingOne Users API aud
   * Used by admin/worker app tokens when calling user management endpoints
   */
  users: `https://api.pingone.com/v1/environments/${process.env.PINGONE_ENVIRONMENT_ID}/users`,

  /**
   * PingOne Applications API aud
   * Used by admin tokens when managing OAuth applications
   */
  applications: `https://api.pingone.com/v1/environments/${process.env.PINGONE_ENVIRONMENT_ID}/applications`,

  /**
   * PingOne Resource Servers API aud
   * Used by admin tokens when managing resource servers
   */
  resourceServers: `https://api.pingone.com/v1/environments/${process.env.PINGONE_ENVIRONMENT_ID}/resourceServers`,

  /**
   * PingOne Scopes/Resources API aud
   * Used by admin tokens when managing scopes
   */
  resources: `https://api.pingone.com/v1/environments/${process.env.PINGONE_ENVIRONMENT_ID}/resources`,
};

/**
 * Route-Specific Audience Requirements
 * Maps HTTP routes to their expected audience values.
 * Used by audValidationMiddleware to validate requests.
 *
 * Default: All routes default to BFF_AUD unless explicitly mapped
 */
const ROUTE_AUD_MAP = {
  // Banking API routes expect BFF_AUD
  'POST /api/transactions': BFF_AUD,
  'GET /api/transactions': BFF_AUD,
  'GET /api/transactions/:id': BFF_AUD,
  'GET /api/accounts': BFF_AUD,
  'GET /api/accounts/:id': BFF_AUD,
  'POST /api/transfers': BFF_AUD,
  'GET /api/transfers': BFF_AUD,
  'GET /api/dashboard': BFF_AUD,

  // Token exchange route — expects user token with BFF_AUD, returns agent token with MCP_SERVER_AUD
  'POST /api/token-exchange': BFF_AUD,

  // MCP routes expect MCP_SERVER_AUD
  'POST /api/mcp/invoke': MCP_SERVER_AUD,
  'POST /api/mcp/call-tool': MCP_SERVER_AUD,
  'WS /mcp': MCP_SERVER_AUD,

  // Admin routes may require specific audiences
  'POST /api/admin/users': RESOURCE_AUDS.users,
  'GET /api/admin/users': RESOURCE_AUDS.users,
  'PUT /api/admin/users/:id': RESOURCE_AUDS.users,

  // Public/health routes: typically skip aud validation in middleware
  'GET /health': null,
  'GET /metrics': null,
  'GET /.well-known/*': null,
};

/**
 * Get expected audience for a given route
 * Returns the aud value that the token's aud claim must match for this route.
 *
 * @param {string} method - HTTP method (GET, POST, PUT, etc)
 * @param {string} path - Request path (e.g., "/api/transactions")
 * @returns {string|null} - Expected aud value, or null if aud validation is skipped
 */
function getExpectedAudForRoute(method, path) {
  // Try exact route match first
  const routeKey = `${method} ${path}`;
  if (routeKey in ROUTE_AUD_MAP) {
    return ROUTE_AUD_MAP[routeKey];
  }

  // Try wildcard routes (if any)
  for (const [route, aud] of Object.entries(ROUTE_AUD_MAP)) {
    const [routeMethod, routePath] = route.split(' ');
    if (routeMethod === method && this._pathMatches(routePath, path)) {
      return aud;
    }
  }

  // Default: all authenticated routes expect BFF_AUD
  return BFF_AUD;
}

/**
 * Helper: Check if a route pattern matches a request path
 * Supports simple wildcards (e.g., "/api/transactions/:id" matches "/api/transactions/123")
 * @private
 */
function _pathMatches(pattern, path) {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = path.split('/').filter(Boolean);

  if (patternParts.length !== pathParts.length) return false;

  for (let i = 0; i < patternParts.length; i++) {
    const patternPart = patternParts[i];
    const pathPart = pathParts[i];

    // Wildcard segment (e.g., ":id", "*")
    if (patternPart.startsWith(':') || patternPart === '*') {
      continue;
    }

    // Exact match required
    if (patternPart !== pathPart) {
      return false;
    }
  }

  return true;
}

/**
 * Validate an aud value format
 * Ensures aud values follow best practices (HTTPS URLs, no IP addresses, etc.)
 *
 * @param {string} aud - Aud value to validate format
 * @returns {{valid: boolean, error?: string}}
 */
function validateAudFormat(aud) {
  if (!aud) {
    return { valid: false, error: 'Aud value is empty' };
  }

  // Allow both URLs and service names
  if (aud.includes('http://') || aud.includes('https://')) {
    // Must be HTTPS (except localhost)
    if (aud.includes('http://') && !aud.includes('localhost')) {
      return { valid: false, error: 'Aud values must use HTTPS (not HTTP) except for localhost' };
    }
    // Avoid IP addresses (e.g., http://192.168.1.1)
    if (/http:\/\/\d+\.\d+\.\d+\.\d+/.test(aud)) {
      return { valid: false, error: 'Aud values should use hostnames, not IP addresses' };
    }
  }

  return { valid: true };
}

module.exports = {
  // Aud values
  BFF_AUD,
  MCP_SERVER_AUD,
  RESOURCE_AUDS,

  // Route mapping
  ROUTE_AUD_MAP,
  getExpectedAudForRoute,

  // Validation
  validateAudFormat,

  // Environment info
  NODE_ENV,
};
