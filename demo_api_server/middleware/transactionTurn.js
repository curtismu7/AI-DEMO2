'use strict';
/**
 * Marks the boundaries of one agent turn in the transaction ledger.
 *
 * Mounted only on the two agent-turn entry points (/api/demo-agent and
 * /api/agent) — NOT app-wide. The traced unit is an agent turn; stamping every
 * inbound request would fill the 500-transaction cap with health checks and
 * static asset fetches.
 */
const { emitHop } = require('../services/transactionHop');
const configStore = require('../services/configStore');

/**
 * Resolves the acting principal's identity.
 *
 * ORDER MATTERS, and the session comes FIRST. These are two different
 * identity spaces, and picking the wrong one per-route silently breaks
 * ownership:
 *
 *  1. `req.session?.user?.oauthId` — the PingOne UUID, stored on the session
 *     user at login (routes/oauthUser.js). THIS is the identity.
 *  2. `req.session?.user?.id` — an app-internal key such as `"5"`, legacy on
 *     bootstrap users. NOT an identity, and never used here: per
 *     ARCHITECTURE-TRUTHS T-6 (middleware/agentSessionMiddleware.js) it does
 *     not match per-user data, which is seeded against the PingOne sub. That
 *     middleware refuses to fall back to it and 401s instead.
 *  3. `req.user?.sub` — set by `authenticateToken` (middleware/auth.js sets
 *     `{ id: decoded.sub, sub: decoded.sub, ... }`), so it is the same PingOne
 *     UUID as (1) and agrees with it.
 *
 * Using (2) was a real, live defect: the ledger stamped `"5"` on the
 * `ui.request` hop while authz-server reported the PingOne sub on its own
 * hops, so INV-2 ("one transaction, one subject") fired on ORDINARY agent
 * turns — reporting a confused deputy where there was only one user recorded
 * two ways. An invariant that cries wolf on every turn is worse than none.
 *
 * The write path (`/api/demo-agent`) has no `authenticateToken`, so only the
 * session is available there. The read path (`/api/transaction-trace`) has
 * both. Preferring `req.user` would therefore store the session id on write
 * and compare a PingOne UUID on read — they never match, every record looks
 * like someone else's, and the feature goes invisible to every non-admin.
 * That was a real, live defect; the session is checked first because it is
 * the one source present on BOTH paths.
 *
 * Returns `null` (never `undefined`, never the string `"undefined"`) when
 * neither source carries an identity, so an unresolved principal can never
 * be mistaken for an attributable one.
 */
function resolveActingIdentity(req) {
  // Session first is load-bearing and unchanged: the write path
  // (/api/demo-agent) has no `authenticateToken`, so `req.user` is absent
  // there. Reading the PingOne sub from the SESSION keeps one value on both
  // paths — which is what stops the read/write mismatch that once made every
  // record look like someone else's.
  const id = req.session?.user?.oauthId
    ?? req.session?.user?.sub
    ?? req.user?.sub
    ?? null;
  return id == null ? null : String(id);
}

function transactionTurnMiddleware(req, res, next) {
  if (configStore.getEffective('ff_transaction_ledger') === 'false') return next();

  const startedAt = Date.now();

  emitHop({
    phase: 'ui.request',
    op: `${req.method} ${req.baseUrl}${req.path}`,
    identity: {
      sub: resolveActingIdentity(req),
      sessionId: req.sessionID || null,
    },
    status: 'ok',
  });

  res.on('finish', () => {
    emitHop({
      phase: 'response',
      op: `${res.statusCode}`,
      durationMs: Date.now() - startedAt,
      status: res.statusCode >= 400 ? 'error' : 'ok',
    });
  });

  next();
}

module.exports = { transactionTurnMiddleware, resolveActingIdentity };
