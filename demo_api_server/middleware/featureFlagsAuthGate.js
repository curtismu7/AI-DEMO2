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
    const requireAuth = /^(1|true|yes|on)$/i.test(String(process.env.FF_ADMIN_REQUIRE_AUTH || ''));
    if (!requireAuth || req.method === 'GET' || req.method === 'HEAD') return next();
    return authenticateToken(req, res, next);
  };
}

module.exports = { makeFeatureFlagsAuthGate };
