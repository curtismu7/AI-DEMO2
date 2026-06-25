'use strict';
const configStore = require('./configStore');

const DEFAULT_ADMIN_PATH = '/api/auth/oauth/callback';
const DEFAULT_USER_PATH  = '/api/auth/oauth/user/callback';
const MAX_PATH_LENGTH    = 255;

function _validatePath(path) {
  return typeof path === 'string' && path.startsWith('/') && path.length <= MAX_PATH_LENGTH;
}

/**
 * Registers OAuth callback routes at configured paths.
 *
 * Default paths (/api/auth/oauth/callback and /api/auth/oauth/user/callback) are
 * already handled by the router mounts in server.js. This dispatcher registers
 * additional routes only when paths are customised (e.g., /oauth2/callback for
 * Federate, /callback for Auth0). Default paths are always registered so the
 * dispatcher is the single source of truth for callback route registration.
 *
 * @param {import('express').Application} app
 * @param {Function} adminRouter  - oauthRoutes Express router
 * @param {Function} userRouter   - oauthUserRoutes Express router
 * @param {Function} [rateLimiter] - optional rate-limiter middleware
 */
function registerCallbacks(app, adminRouter, userRouter, rateLimiter) {
  const adminPath = configStore.getEffective('oauth_admin_callback_path') || DEFAULT_ADMIN_PATH;
  const userPath  = configStore.getEffective('oauth_user_callback_path')  || DEFAULT_USER_PATH;

  console.log('[callback-dispatcher] Registering OAuth callbacks:', { admin: adminPath, user: userPath });

  const middlewares = rateLimiter ? [rateLimiter] : [];

  if (_validatePath(adminPath)) {
    const qs = (url) => (url.includes('?') ? url.slice(url.indexOf('?')) : '');
    app.get(adminPath, ...middlewares, (req, res, next) => {
      req.url = '/callback' + qs(req.url);
      adminRouter(req, res, next);
    });
  } else {
    console.warn('[callback-dispatcher] Invalid admin callback path — skipping registration:', adminPath);
  }

  if (_validatePath(userPath) && userPath !== adminPath) {
    const qs = (url) => (url.includes('?') ? url.slice(url.indexOf('?')) : '');
    app.get(userPath, ...middlewares, (req, res, next) => {
      req.url = '/callback' + qs(req.url);
      userRouter(req, res, next);
    });
  } else if (_validatePath(userPath) && userPath === adminPath) {
    console.log('[callback-dispatcher] Admin and user share the same callback path — admin handler takes priority');
  }
}

module.exports = { registerCallbacks };
