// demo_api_server/routes/obo.js
'use strict';
const express = require('express');
const { validateToken } = require('../services/tokenValidationService');
const { getOboConfig } = require('../services/oboConfig');
const { runObo } = require('../services/oboExchangeService');
const { verifyDownstream } = require('../services/oboDownstream');
const hub = require('../services/oboEventHub');

const router = express.Router();

const bearer = (req) => (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || null;
const baseUrl = (req) => process.env.PUBLIC_APP_URL || `${req.protocol}://${req.get('host')}`;

function challenge(req, res) {
  res.set('WWW-Authenticate', `Bearer resource_metadata="${baseUrl(req)}/.well-known/oauth-protected-resource/api/obo/mcp"`);
  return res.status(401).json({ error: 'unauthorized' });
}

function metadataHandler(req, res) {
  const cfg = getOboConfig();
  res.json({
    resource: `${baseUrl(req)}/api/obo/mcp`,
    authorization_servers: [cfg.issuer],
    scopes_supported: ['mcp:invoke', 'read'],
    bearer_methods_supported: ['header'],
  });
}

const TOOLS = [{
  name: 'act_on_my_behalf',
  description: 'Calls a downstream API on behalf of the signed-in user using a delegated (RFC 8693) token and reports who acted for whom.',
  inputSchema: { type: 'object', properties: {} },
}];

// What the MODEL sees: claims and status codes only. Withheld entirely if anything token-shaped slipped in.
function toolText(ev) {
  if (ev.leak) return 'withheld: result contained a token';
  return JSON.stringify({
    acting_for: ev.sub,
    acted_by: ev.delegated.act,
    delegated_claims: { sub: ev.delegated.sub, aud: ev.delegated.aud, scope: ev.delegated.scope, act: ev.delegated.act, exp: ev.delegated.exp },
    downstream: ev.downstream,
    checks: ev.checks.map(({ label, pass }) => ({ label, pass })),
  }, null, 2);
}

router.get('/downstream', async (req, res) => {
  const token = bearer(req);
  if (!token) return res.status(401).json({ error: 'unauthorized' });
  const r = await verifyDownstream(token);
  return res.status(r.status).json(r);
});

router.post('/mcp', async (req, res) => {
  const token = bearer(req);
  if (!token) return challenge(req, res);
  const cfg = getOboConfig();
  let caller;
  try {
    caller = await validateToken(token, { jwksUri: cfg.jwksUri, issuer: cfg.issuer, audience: cfg.inboundAudiences });
  } catch (_e) {
    return challenge(req, res);
  }

  const msg = req.body || {};
  if (msg.id === undefined) return res.status(202).end();
  const ok = (result) => res.json({ jsonrpc: '2.0', id: msg.id, result });

  switch (msg.method) {
    case 'initialize':
      return ok({ protocolVersion: msg.params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'obo-demo', version: '1.0.0' } });
    case 'tools/list':
      return ok({ tools: TOOLS });
    case 'ping':
      return ok({});
    case 'tools/call':
      try {
        const ev = await runObo({ req, subjectToken: token, source: 'claude' });
        hub.publish(caller.sub, ev);
        return ok({ content: [{ type: 'text', text: toolText(ev) }] });
      } catch (e) {
        return ok({ isError: true, content: [{ type: 'text', text: `error: ${e.message}` }] });
      }
    default:
      return res.json({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'method not found' } });
  }
});

module.exports = { router, metadataHandler };
