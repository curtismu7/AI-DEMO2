'use strict';
const axios = require('axios');
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const configStore = require('../services/configStore');

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
    const configuredGatewayUrl = configStore.getEffective('mcp_gateway_http_url') || process.env.DEMO_API_BASE_URL;
    const gatewayUrl = configuredGatewayUrl || 'https://api.ping.demo:3036';

    if (!configuredGatewayUrl) {
      console.warn('PingOne setup: using default gateway URL (not configured via configStore or DEMO_API_BASE_URL)');
    }

    const tokenEndpoint = `https://auth.pingone.${region}/${environmentId}/as/token`;

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

    try {
      await axios.get(`${gatewayUrl}/.well-known/mcp`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 5000,
      });
      results.gatewayConnectivity.success = true;
    } catch (err) {
      results.gatewayConnectivity.error = err.response?.statusText || err.message;
      return res.json(buildResponse(results, false));
    }

    try {
      const toolsResponse = await axios.post(
        `${gatewayUrl}/mcp/tools/list`,
        { jsonrpc: '2.0', method: 'tools/list', id: 1 },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          timeout: 5000,
        }
      );
      results.toolCall.success = true;
      results.toolCall.tools = toolsResponse.data.result?.tools || [];
      results.toolCall.toolsFound = results.toolCall.tools.length;
    } catch (err) {
      results.toolCall.error = err.response?.data?.error || err.message;
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
      'Verify in UI: Navigate to http://localhost:3000',
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
