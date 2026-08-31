'use strict';

/**
 * Auth gate for the feature-flags admin endpoint.
 *
 * MUTATIONS (anything that is not a GET/HEAD read) require an authenticated
 * session. Reads stay open so the header Quick Flags pill can always display
 * flag state without a session.
 *
 * There is no opt-out. Two env vars used to sit here and both are gone:
 *
 *   FF_ADMIN_REQUIRE_AUTH              opt-IN hardening; unset meant OPEN
 *   FF_ADMIN_ALLOW_ANONYMOUS_MUTATIONS opt-IN anonymous; unset meant SECURE
 *
 * The second replaced the first, flipping the default to fail-secure. Neither
 * was ever set — not in .env, compose, k8s, or any script — so removing the
 * escape hatch changes no runtime behaviour. It is removed because the flags it
 * exposed are not cosmetic (ff_hitl_enabled, step_up_enabled,
 * ff_skip_token_exchange, ff_inject_*, the gateway policy modes), this demo is
 * internet-facing, and there is no sandbox/prod split — so a single env var was
 * an anonymous kill switch for the controls the demo exists to prove.
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
    // Everything else mutates gateway-visible policy and needs a session.
    return authenticateToken(req, res, next);
  };
}

module.exports = { makeFeatureFlagsAuthGate };
