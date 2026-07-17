'use strict';

/**
 * Auth gate for the feature-flags admin endpoint.
 *
 * Fail-secure: MUTATIONS (anything that is not a GET/HEAD read) require an
 * authenticated session by DEFAULT. Setting FF_ADMIN_ALLOW_ANONYMOUS_MUTATIONS to
 * a truthy value opts back in to anonymous mutations for dev/demo ergonomics (so
 * any visitor can toggle flags from the header pill). Reads stay open in both
 * modes so the pill can always display flag state.
 *
 * NOTE: this replaced an earlier opt-IN FF_ADMIN_REQUIRE_AUTH gate (unset =
 * open). That env var is no longer read — setting it has no effect.
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
