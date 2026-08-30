'use strict';

/**
 * /api/agent-gateway — gateway introspection and tool invocation for the
 * Agent Gateway Inspector UI.
 *
 *   GET  /capabilities          → list capabilities (tools) for a gateway
 *   POST /invoke                → invoke a tool through the gateway
 */

const express = require('express');
const router = express.Router();

/**
 * GET /api/agent-gateway/capabilities?gatewayId=...
 * Returns available capabilities (tools) for the specified gateway.
 */
router.get('/capabilities', async (req, res) => {
  const { gatewayId } = req.query;

  if (!gatewayId) {
    return res.status(400).json({ error: 'gatewayId is required' });
  }

  try {
    // Map gateway IDs to their tool sets
    const gatewayTools = {
      'demo-mcp-gateway': [
        { name: 'list_repositories', description: 'List available repositories' },
        { name: 'read_file', description: 'Read file contents' },
        { name: 'search_code', description: 'Search code across repositories' },
      ],
      'privilege-gateway': [
        { name: 'list_applications', description: 'List PingOne applications' },
        { name: 'read_user', description: 'Read user information' },
        { name: 'list_users', description: 'List users in directory' },
      ],
      'external-door': [
        { name: 'oauth_provider_config', description: 'OAuth provider configuration' },
        { name: 'token_exchange', description: 'Exchange tokens' },
      ],
    };

    const capabilities = gatewayTools[gatewayId] || [];
    res.json({ capabilities });
  } catch (err) {
    console.error('Failed to fetch capabilities:', err);
    res.status(500).json({ error: 'Failed to fetch capabilities' });
  }
});

/**
 * POST /api/agent-gateway/invoke
 * Invokes a tool through the specified gateway.
 */
router.post('/invoke', express.json(), async (req, res) => {
  const { gatewayId, tool, parameters = {} } = req.body;

  if (!gatewayId || !tool) {
    return res.status(400).json({ error: 'gatewayId and tool are required' });
  }

  try {
    const startTime = Date.now();

    // Mock implementation: simulate tool invocation
    // In production, this would route through the actual MCP gateway
    const result = {
      status: 'success',
      durationMs: Math.random() * 500 + 100,
      tool,
      gatewayId,
      parameters,
      output: {
        message: `Successfully invoked ${tool} on ${gatewayId}`,
        data: {
          timestamp: new Date().toISOString(),
          executedAt: gatewayId,
        },
      },
      trace: {
        steps: [
          {
            step: 1,
            action: 'route_to_gateway',
            gateway: gatewayId,
            status: 'success',
          },
          {
            step: 2,
            action: 'invoke_tool',
            tool,
            status: 'success',
            durationMs: Math.random() * 300 + 50,
          },
          {
            step: 3,
            action: 'format_response',
            status: 'success',
            durationMs: 5,
          },
        ],
      },
    };

    res.json(result);
  } catch (err) {
    console.error('Failed to invoke tool:', err);
    res.status(500).json({
      error: 'Failed to invoke tool',
      message: err.message,
    });
  }
});

module.exports = router;
