// demo_api_server/routes/mcpOAuthConfig.js
//
// Illustrative OAuth config admin route for banking-mcp (see
// docs/mocks/mcp-oauth-config-mock.html and privilege/CURRENT-CONFIGURATION.md).
// GET/PUT hold the form values (secret write-only, see mcpOAuthConfigStore.js).
// POST /test mints a real client_credentials token against the saved issuer,
// then calls the live banking-mcp door on the Privilege gateway with it and
// reports the upstream status/body as-is. Auth Mode OAuth is a documented
// platform blocker on that gateway today, so a 401 here is an honest result,
// not a route failure — this is not an attempt to re-fight that wall.

'use strict';

const express = require('express');
const store = require('./../services/mcpOAuthConfigStore');

const router = express.Router();

// The gateway's client URL pattern is <base>/<AgenticAppName>/mcp — see
// services/mcpProfileStore.js's PRIVILEGE_GATEWAY_BASE and
// privilege/CURRENT-CONFIGURATION.md for how banking-mcp is registered.
const PRIVILEGE_GATEWAY_BANKING_MCP_URL = 'https://mcpgw.ai-demo.ping-devops.com/banking-mcp/mcp';

router.get('/', (req, res) => {
  res.json(store.getConfig());
});

router.put('/', (req, res) => {
  const { clientId, clientSecret, issuer, tokenEndpoint, scopes, audience } = req.body || {};
  res.json(store.saveConfig({ clientId, clientSecret, issuer, tokenEndpoint, scopes, audience }));
});

async function mintToken(config) {
  const response = await fetch(config.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: config.clientId,
      client_secret: config.clientSecret,
      scope: config.scopes || '',
    }),
  });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  return { ok: response.ok && !!body.access_token, status: response.status, body };
}

router.post('/test', async (req, res) => {
  const config = store.getConfigWithSecret();
  if (!config || !config.clientId || !config.clientSecret || !config.tokenEndpoint) {
    return res.status(400).json({ error: 'save clientId, clientSecret and tokenEndpoint before testing' });
  }

  const tokenResult = await mintToken(config);
  if (!tokenResult.ok) {
    return res.json({ step: 'token', status: tokenResult.status, body: tokenResult.body });
  }

  const mcpResponse = await fetch(PRIVILEGE_GATEWAY_BANKING_MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${tokenResult.body.access_token}`,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
  });
  const mcpText = await mcpResponse.text();
  let mcpBody;
  try { mcpBody = JSON.parse(mcpText); } catch { mcpBody = { raw: mcpText }; }
  res.json({ step: 'mcp', status: mcpResponse.status, body: mcpBody });
});

module.exports = router;
