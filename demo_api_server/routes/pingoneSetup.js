'use strict';
const axios = require('axios');
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const configStore = require('../services/configStore');
const { getMcpUrl, extractJsonRpc } = require('../services/mcpPingOneHttpAdapter');

// GET /api/pingone/setup/defaults - Return the worker credentials from the
// server .env so the setup form can pre-fill them. No auth required so the
// form seeds itself for any visitor. Values are still editable client-side;
// this only seeds the form.
router.get('/defaults', (req, res) => {
  res.json({
    environmentId: process.env.PINGONE_ENVIRONMENT_ID || '',
    clientId: process.env.PINGONE_WORKER_CLIENT_ID || '',
    clientSecret: process.env.PINGONE_WORKER_CLIENT_SECRET || '',
  });
});

// POST /api/pingone/setup - Provision PingOne MCP worker credentials
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { environmentId, clientId, clientSecret } = req.body;

    if (!environmentId || !clientId || !clientSecret) {
      return res.status(400).json({
        success: false,
        error: 'Missing required credentials',
        missing: {
          environmentId: !environmentId,
          clientId: !clientId,
          clientSecret: !clientSecret,
        },
      });
    }

    const region = configStore.getEffective('pingone_region') || 'com';
    const tokenEndpoint = `https://auth.pingone.${region}/${environmentId}/as/token`;
    // Hosted PingOne MCP server URL — built by the adapter (single source of
    // truth for the https://mcp.pingone.{region}/admin/{envId}/mcp format).
    const mcpUrl = getMcpUrl({ region, envId: environmentId });

    const results = {
      tokenAcquisition: { success: false, error: null },
      gatewayConnectivity: { success: false, error: null },
      toolCall: { success: false, error: null, toolsFound: 0, tools: [] },
    };

    let accessToken = null;

    try {
      const tokenResponse = await axios.post(
        tokenEndpoint,
        'grant_type=client_credentials',
        {
          auth: { username: clientId, password: clientSecret },
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 10000,
        }
      );
      accessToken = tokenResponse.data.access_token;
      results.tokenAcquisition.success = true;
    } catch (err) {
      results.tokenAcquisition.error = err.response?.data?.error || err.message;
      return res.json(buildResponse(results, false));
    }

    // One streamable-HTTP JSON-RPC POST to the hosted PingOne MCP server
    // validates both reachability (the server accepted the worker token) and
    // the tools/list result. The hosted server is stateless — no initialize
    // handshake or session id (see mcpPingOneHttpAdapter, which the agent
    // path uses to make the same call).
    let mcpResponse;
    try {
      mcpResponse = await axios.post(
        mcpUrl,
        { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
          },
          timeout: 10000,
          // Keep the raw body; extractJsonRpc handles JSON or SSE framing.
          responseType: 'text',
          transformResponse: (d) => d,
        }
      );
      results.gatewayConnectivity.success = true;
    } catch (err) {
      const status = err.response?.status;
      results.gatewayConnectivity.error = status ? `HTTP ${status}` : err.message;
      return res.json(buildResponse(results, false));
    }

    try {
      const rpc = extractJsonRpc(mcpResponse.data);
      if (rpc?.error) throw new Error(rpc.error.message || 'MCP JSON-RPC error');
      const tools = rpc?.result?.tools;
      if (!Array.isArray(tools)) throw new Error('tools/list returned no tools array');
      results.toolCall.success = true;
      results.toolCall.tools = tools;
      results.toolCall.toolsFound = tools.length;
    } catch (err) {
      results.toolCall.error = err.message;
    }

    return res.json(buildResponse(results, results.toolCall.success));
  } catch (error) {
    console.error('PingOne setup error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

function buildResponse(results, allPassed) {
  return {
    success: allPassed,
    steps: results,
    nextSteps: allPassed ? [
      'Restart BFF: ./run-docker.sh restart demo-api-server',
      'Verify in UI: Navigate to https://local.ping-devops.com:4000',
      'Test agent actions that use MCP tools',
    ] : [
      'Check credentials in PingOne console',
      'Verify worker app has admin roles',
      'Ensure environment ID matches the app environment',
      'Run test again',
    ],
  };
}

module.exports = router;
