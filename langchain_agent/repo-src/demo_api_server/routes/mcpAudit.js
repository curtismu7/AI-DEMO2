'use strict';

const express = require('express');
const router = express.Router();
const mcpAuditStore = require('../services/lmdb/mcpAuditStore.lmdb');

/**
 * GET /api/mcp/audit
 * Durable MCP Audit Trail — reads the LMDB store fed by the MCP gateway
 * (cross-vertical, survives restarts). Replaces the former proxy to the MCP
 * server's ephemeral in-memory store.
 *
 * Admin session is enforced at server.js registration level.
 * Query params: eventType, outcome, agentId, operation, limit, summary
 */
router.get('/', (req, res) => {
  const isSummary = req.query.summary === '1' || req.query.summary === 'true';

  try {
    if (isSummary) {
      return res.json(mcpAuditStore.summary());
    }
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : undefined;
    const events = mcpAuditStore.query({
      eventType: req.query.eventType ? String(req.query.eventType) : undefined,
      outcome: req.query.outcome ? String(req.query.outcome) : undefined,
      agentId: req.query.agentId ? String(req.query.agentId) : undefined,
      operation: req.query.operation ? String(req.query.operation) : undefined,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    return res.json(events);
  } catch (err) {
    // A read failure should degrade to an empty trail, not a 500 that breaks
    // the admin page.
    console.warn('[mcpAudit] store read failed:', err?.message);
    return res.json(isSummary ? { totalEvents: 0, byEventType: {}, byOutcome: {} } : []);
  }
});

module.exports = router;
