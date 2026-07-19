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
 * Resolves the acting principal's identity from whichever request shape is
 * actually populated, checked in order:
 *
 *  1. `req.user?.id` / `req.user?.sub` — set by `authenticateToken`
 *     (middleware/auth.js), present on authenticated routes such as the
 *     transaction-trace read side. `id` and `sub` are both the PingOne
 *     `sub` claim (see auth.js: `req.user = { id: decoded.sub, sub:
 *     decoded.sub, ... }`), so either suffices.
 *  2. `req.session?.user?.id` — the BFF session-user shape stored at
 *     login (`{id, username, email, firstName, lastName, role}`, see
 *     routes/auth.js `req.session.user = user`). It has NO `sub` field.
 *     This is the only identity available on `/api/demo-agent`, which has
 *     no `authenticateToken` ahead of this middleware.
 *
 * Returns `null` (never `undefined`, never the string `"undefined"`) when
 * neither source carries an identity, so an unresolved principal can never
 * be mistaken for an attributable one.
 */
function resolveActingIdentity(req) {
  const id = req.user?.id ?? req.user?.sub ?? req.session?.user?.id ?? null;
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
