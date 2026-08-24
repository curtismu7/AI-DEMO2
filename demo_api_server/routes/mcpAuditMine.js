'use strict';

const express = require('express');
const router = express.Router();
const mcpAuditStore = require('../services/lmdb/mcpAuditStore.lmdb');

/**
 * GET /api/mcp/audit/mine
 *
 * Session-scoped view of the same durable MCP audit trail /api/mcp/audit
 * reads (admin-only) — filters to events whose `userId` (the PingOne `sub`
 * the gateway stamped, see demo_mcp_gateway/src/gatewayAudit.ts) matches the
 * signed-in session's user id. Powers the external-door movie reel (LM
 * Studio → Agent Gateway calls) for a regular, non-admin demo user.
 *
 * Session enforced at server.js registration level (requireSession).
 */
router.get('/', (req, res) => {
  const userId = req.session.user.id;
  try {
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : undefined;
    const events = mcpAuditStore
      .query({ limit: Number.isFinite(limit) ? limit : undefined })
      .filter((event) => event.userId === userId);
    return res.json(events);
  } catch (err) {
    console.warn('[mcpAuditMine] store read failed:', err?.message);
    return res.json([]);
  }
});

module.exports = router;
