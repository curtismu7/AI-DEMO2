'use strict';
const express = require('express');
const router = express.Router();
const { getMcpTrafficLog, LOG_PATH } = require('../services/mcpTrafficLogger');

/**
 * GET /api/mcp/traffic?limit=200
 * Returns recent MCP traffic entries from the in-memory ring buffer (newest first).
 * Auth is enforced at the app.use() registration in server.js (requireSession).
 */
router.get('/', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit || '200', 10), 1000);
    const entries = getMcpTrafficLog(limit);
    return res.json({ entries, logFile: LOG_PATH, count: entries.length });
});

module.exports = router;
