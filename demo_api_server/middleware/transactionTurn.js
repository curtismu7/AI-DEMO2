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

function transactionTurnMiddleware(req, res, next) {
  if (configStore.getEffective('ff_transaction_ledger') === 'false') return next();

  const startedAt = Date.now();

  emitHop({
    phase: 'ui.request',
    op: `${req.method} ${req.baseUrl}${req.path}`,
    identity: {
      sub: req.session?.user?.sub || req.user?.id || null,
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

module.exports = { transactionTurnMiddleware };
