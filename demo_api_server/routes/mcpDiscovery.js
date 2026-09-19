'use strict';

const express = require('express');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const defaultClient = require('../services/mcpDiscoveryClient');

function createMcpDiscoveryRouter({ client = defaultClient, authenticate = authenticateToken, requireAdmin: injectedRequireAdmin } = {}) {
  const router = express.Router();
  const adminMiddleware = injectedRequireAdmin || requireAdmin;
  router.use(authenticate, adminMiddleware);

  router.get('/inventory', async (_req, res) => {
    try {
      return res.json(await client.getInventory());
    } catch (error) {
      return res.status(error.httpStatus || 502).json({ error: 'mcp_discovery_unavailable' });
    }
  });

  router.post('/scan', express.json(), async (_req, res) => {
    try {
      return res.status(202).json(await client.requestScan());
    } catch (error) {
      return res.status(error.httpStatus || 502).json({ error: 'mcp_discovery_unavailable' });
    }
  });

  return router;
}

module.exports = createMcpDiscoveryRouter();
module.exports.createMcpDiscoveryRouter = createMcpDiscoveryRouter;
