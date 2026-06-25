/**
 * Token introspection middleware for Banking API
 * Implements RFC 7662 - OAuth 2.0 Token Introspection
 *
 * Delegates all introspection to tokenIntrospectionService (per-client cache key,
 * 30s TTL with 60s eviction interval). That service introspects AS the token's
 * issuing client (Demo User App / dedicated introspection client) — NOT the Worker,
 * which PingOne rejects as active:false for another client's token.
 * Removes old middleware-local cache (token prefix collision risk, ADMIN_CLIENT_ID fallback).
 */

const { logger } = require('../utils/logger');
const { logEvent: logAppEvent } = require('../services/appEventService');
const tokenIntrospectionService = require('../services/tokenIntrospectionService');

/**
 * Introspect token by delegating to tokenIntrospectionService (RFC 7662).
 * Normalizes response for existing callers: active, scope string, sub, exp, iat, client_id.
 */
async function introspectToken(token, opts = {}) {
  const result = await tokenIntrospectionService.validateToken(token, opts);
  return {
    active: result.valid === true,
    scope: Array.isArray(result.scopes) ? result.scopes.join(' ') : (result.scope || ''),
    sub: result.sub || null,
    exp: result.exp || null,
    iat: result.iat || null,
    client_id: result.client_id || null,
    aud: result.aud || null,
    token_type: result.token_type || 'Bearer',
  };
}

/** Middleware: introspect and validate tokens - checks active and not revoked */
async function tokenIntrospectionMiddleware(req, _res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (typeof authHeader !== 'string' || authHeader.startsWith('Bearer ') === false) {
      return next();
    }
    const token = authHeader.substring(7);
    const r = await introspectToken(token);
    if (r.active !== true) {
      logger.warn('Inactive token rejected', { sub: r.sub, path: req.path });
      logAppEvent('introspection', 'warning', 'Token rejected — PingOne returned inactive',
        { tag: 'introspection/middleware-inactive', metadata: { sub: r.sub || null, path: req.path } });
      return next(new Error('Token is not active or has been revoked'));
    }
    req.tokenIntrospection = { active: r.active, sub: r.sub, client_id: r.client_id, scope: r.scope, exp: r.exp, iat: r.iat };
    logger.debug('Token introspection successful', { sub: r.sub, active: true, path: req.path });
    logAppEvent('introspection', 'info', 'Token validated via PingOne introspection',
      { tag: 'introspection/middleware-validated', metadata: { active: true, sub: r.sub || null, path: req.path, scope: r.scope || null } });
    next();
  } catch (error) {
    logger.error('Token introspection middleware error', { error: error.message, path: req.path });
    logAppEvent('introspection', 'error', 'Token introspection middleware failed: ' + error.message,
      { tag: 'introspection/middleware-error', metadata: { error: error.message, path: req.path } });
    const failOpen = process.env.INTROSPECTION_FAIL_OPEN === 'true';
    if (failOpen) {
      logger.warn('Introspection failed but FAIL_OPEN enabled, allowing request');
      req.tokenIntrospection = { active: null, failOpen: true };
      req.introspectionFailedOpen = true;
      next();
    } else { next(error); }
  }
}

/** Optional middleware - only introspect if ENABLE_TOKEN_INTROSPECTION=true */
function optionalTokenIntrospectionMiddleware(req, res, next) {
  if (process.env.ENABLE_TOKEN_INTROSPECTION !== 'true') return next();
  return tokenIntrospectionMiddleware(req, res, next);
}

/** Clear introspection cache via service (test helper) */
function clearIntrospectionCache() {
  tokenIntrospectionService.clearCache();
}

module.exports = { tokenIntrospectionMiddleware, optionalTokenIntrospectionMiddleware, introspectToken, clearIntrospectionCache };
