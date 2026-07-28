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
 *  1. `req.session?.user?.id` — the BFF session-user shape stored at login
 *     (`{id, username, email, firstName, lastName, role}` — note it has NO
 *     `sub`). This is an app-internal id such as `"5"`.
 *  2. `req.user?.id` / `req.user?.sub` — set by `authenticateToken`
 *     (middleware/auth.js sets `{ id: decoded.sub, sub: decoded.sub, ... }`),
 *     so both are the PingOne `sub` claim — a UUID, NOT the same value as (1).
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
  const id = req.session?.user?.id ?? req.user?.id ?? req.user?.sub ?? null;
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
