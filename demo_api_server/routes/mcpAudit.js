'use strict';

const express = require('express');
const router = express.Router();
const mcpAuditStore = require('../services/lmdb/mcpAuditStore.lmdb');
const { resolveActingIdentity } = require('../middleware/transactionTurn');

/**
 * GET /api/mcp/audit
 * Durable MCP Audit Trail — reads the LMDB store fed by the MCP gateway
 * (cross-vertical, survives restarts). Replaces the former proxy to the MCP
 * server's ephemeral in-memory store.
 *
 * A signed-in session is enforced at server.js registration level. Ownership,
 * same rule as /api/admin/agent-gateway/decisions: a non-admin sees only events
 * the gateway stamped with their own PingOne sub; admins see every caller's.
 * Query params: eventType, outcome, agentId, operation, limit, summary
 */
router.get('/', (req, res) => {
  const isSummary = req.query.summary === '1' || req.query.summary === 'true';
  const emptyResult = isSummary ? { totalEvents: 0, byEventType: {}, byOutcome: {} } : [];
  const isAdmin = req.session?.user?.role === 'admin';
  const userId = isAdmin ? undefined : resolveActingIdentity(req);
  // A non-admin with no resolvable sub owns no events; an undefined filter
  // below would mean "everyone's", so answer empty here instead.
  if (!isAdmin && !userId) return res.json(emptyResult);

  try {
    if (isSummary) {
      return res.json(mcpAuditStore.summary(userId));
    }
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : undefined;
    const events = mcpAuditStore.query({
      eventType: req.query.eventType ? String(req.query.eventType) : undefined,
      outcome: req.query.outcome ? String(req.query.outcome) : undefined,
      agentId: req.query.agentId ? String(req.query.agentId) : undefined,
      operation: req.query.operation ? String(req.query.operation) : undefined,
      userId,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    return res.json(events);
  } catch (err) {
    // A read failure should degrade to an empty trail, not a 500 that breaks
    // the admin page.
    console.warn('[mcpAudit] store read failed:', err?.message);
    return res.json(emptyResult);
  }
});

module.exports = router;
