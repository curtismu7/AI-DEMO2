'use strict';

/**
 * Routes for the Real Agent Gateway (PingGateway / IG) log window.
 * Mounted under /api/admin (authenticateToken applied at mount); open to any
 * signed-in user (customer or admin) — no additional role/scope guard.
 *
 *   GET /api/admin/agent-gateway/logs?tail=200&filter=P1AZ
 *       → raw IG container logs (docker socket), token-redacted.
 *   GET /api/admin/agent-gateway/decisions?limit=20
 *       → recent PingOne Authorize decisions parsed from X-Gw-Audit-Trail.
 */

const express = require('express');
const agentGatewayLogs = require('../services/agentGatewayLogs');
const agentGatewayDecisions = require('../services/agentGatewayDecisions');

const router = express.Router();

router.get('/agent-gateway/logs', async (req, res) => {
  const out = await agentGatewayLogs.fetchLogs({
    tail: req.query.tail,
    filter: req.query.filter,
  });
  // 200 with ok:false carries a human error (e.g. gateway not running) so the UI
  // can render it in the window instead of a blank failure.
  return res.status(200).json(out);
});

router.get('/agent-gateway/decisions', (req, res) => {
  return res.status(200).json({
    ok: true,
    container: agentGatewayLogs.GATEWAY_CONTAINER,
    decisions: agentGatewayDecisions.recent(req.query.limit),
  });
});

module.exports = router;
