'use strict';

/**
 * Opt-in auth gate for the feature-flags admin endpoint.
 *
 * The endpoint is unauthenticated by default (a deliberate demo-ergonomics
 * choice so any signed-in user can toggle flags from the header pill). Setting
 * FF_ADMIN_REQUIRE_AUTH to a truthy value requires an authenticated session for
 * MUTATIONS (anything that is not a GET/HEAD read). Reads stay open in both
 * modes so the pill can always display flag state.
 *
 * Factory form (takes the app's authenticateToken middleware) keeps the gate
 * unit-testable without booting the server.
 *
 * @param {import('express').RequestHandler} authenticateToken
 * @returns {import('express').RequestHandler}
 */
function makeFeatureFlagsAuthGate(authenticateToken) {
  return function featureFlagsAuthGate(req, res, next) {
    // Reads (GET/HEAD) are always open so the UI pill can display flag state.
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    // Mutations (PATCH/PUT/POST/DELETE) require authentication by default.
    // Only allow anonymous mutations when FF_ADMIN_ALLOW_ANONYMOUS_MUTATIONS is
    // explicitly set (dev/demo ergonomics). This is fail-secure: unset = require auth.
    const allowAnonymous = /^(1|true|yes|on)$/i.test(String(process.env.FF_ADMIN_ALLOW_ANONYMOUS_MUTATIONS || ''));
    if (allowAnonymous) {
      console.warn('[featureFlags] WARNING: Anonymous feature flag mutations are allowed (FF_ADMIN_ALLOW_ANONYMOUS_MUTATIONS=true)');
      return next();
    }
    return authenticateToken(req, res, next);
  };
}

module.exports = { makeFeatureFlagsAuthGate };
