'use strict';
/**
 * optionalAuth.js — authenticate when the caller presents credentials, pass
 * through as a guest when they don't.
 *
 * For mounts that mix public and protected routes (e.g. `/api/verticals`:
 * `/list` and `/:id/hero` are public, `/me`, `/stream`, `/active` and the
 * editor are not). Dropping `authenticateToken` from such a mount is NOT
 * equivalent — `req.user` is populated only by that middleware, so removing it
 * makes every downstream `requireSession` / `requireAdmin` route 401/403 for
 * signed-in users too.
 *
 * ── Why this lives in its own module rather than in middleware/auth.js ──
 * 51 test files hand-write `jest.mock('../../middleware/auth', () => ({...}))`
 * with a literal object, and 12 of them also load server.js. Anything server.js
 * destructures from `middleware/auth` is `undefined` under those mocks, so
 * adding an export there breaks all 12 at load with:
 *
 *   TypeError: Router.use() requires a middleware function but got a undefined
 *
 * The error points at the mount line, not the mock, so it reads like a routing
 * bug. Keeping this in a separate module that the mocks do not replace means
 * server.js always gets a real function, while `authenticateToken` is still
 * resolved through the mocked module — which is exactly what those suites want.
 *
 * `authenticateToken` is required lazily, inside the handler, so it always
 * picks up whatever the jest module registry currently holds regardless of
 * mock/require ordering.
 */

/**
 * @type {import('express').RequestHandler}
 * A present-but-invalid token still 401s — this widens who may reach the route,
 * never what an unauthenticated caller is treated as.
 */
function optionalAuthenticateToken(req, res, next) {
  const hasAuthHeader = !!req.headers['authorization']?.split(' ')[1];
  const sessionToken = req.session?.oauthTokens?.accessToken;
  // '_cookie_session' is a read-only identity stub carrying no OAuth token;
  // authenticateToken rejects it, so treat it as "no credentials" here.
  const hasSessionToken = !!sessionToken && sessionToken !== '_cookie_session';
  if (!hasAuthHeader && !hasSessionToken) {
    req.user = null;
    return next();
  }
  // eslint-disable-next-line global-require
  const { authenticateToken } = require('./auth');
  return authenticateToken(req, res, next);
}

module.exports = { optionalAuthenticateToken };
