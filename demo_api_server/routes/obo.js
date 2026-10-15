// demo_api_server/routes/obo.js
'use strict';
const express = require('express');
const { validateToken } = require('../services/tokenValidationService');
const { getOboConfig } = require('../services/oboConfig');
const { runObo } = require('../services/oboExchangeService');
const { verifyDownstream } = require('../services/oboDownstream');
const hub = require('../services/oboEventHub');
const { hasTokenLeak, claims } = require('../services/oboEvidence');

const router = express.Router();

const bearer = (req) => (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || null;
const baseUrl = (req) => process.env.PUBLIC_APP_URL || `${req.protocol}://${req.get('host')}`;

// Metadata lives under /api/ because the frontend proxies /api/ but serves the SPA for /.well-known/.
function challenge(req, res, invalidToken = false) {
  res.set('WWW-Authenticate', `Bearer${invalidToken ? ' error="invalid_token",' : ''} resource_metadata="${baseUrl(req)}/api/obo/mcp/oauth-protected-resource"`);
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

router.get('/mcp/oauth-protected-resource', metadataHandler);
router.get('/mcp', (_req, res) => res.status(405).set('Allow', 'POST').end());

// Best-effort aud/client_id for the rejection log; never the token itself.
function tokenHints(token) {
  try {
    const { aud, client_id: clientId } = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    return `aud=${JSON.stringify(aud)} client_id=${clientId}`;
  } catch (_e) { return 'aud/client_id unreadable'; }
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
  } catch (e) {
    console.warn(`[obo] rejected inbound MCP call: ${e.message} (${tokenHints(token)})`);
    return challenge(req, res, true);
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
      if (msg.params?.name !== 'act_on_my_behalf') {
        return res.json({ jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: 'unknown tool' } });
      }
      try {
        const ev = await runObo({ req, subjectToken: token, source: 'claude' });
        hub.publish(caller.sub, ev.leak ? { ts: ev.ts, source: ev.source, leak: true, checks: ev.checks } : ev);
        return ok({ content: [{ type: 'text', text: toolText(ev) }] });
      } catch (e) {
        return ok({ isError: true, content: [{ type: 'text', text: hasTokenLeak(e.message) ? 'error: withheld (contained a token)' : `error: ${e.message}` }] });
      }
    default:
      return res.json({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'method not found' } });
  }
});

// Page entry point (viewer half): runs the delegation for the signed-in user's BFF session and returns
// evidence only. The subject token is read from the session and never returned to the browser.
router.post('/run', async (req, res) => {
  const subjectToken = req.session?.oauthTokens?.accessToken;
  if (!subjectToken || subjectToken === '_cookie_session') {
    return res.status(401).json({ error: 'Sign in first. The demo runs on your own session token.' });
  }
  try {
    const evidence = await runObo({ req, subjectToken, source: 'page' });
    return res.json(evidence);
  } catch (err) {
    if (err.code === 'obo_not_configured') {
      return res.status(503).json({ error: 'OBO demo is not configured on this environment.' });
    }
    // The failed hop's reason (PingOne's error code/description, HTTP status): never tokens or request bodies.
    // The trace was built token-free in oboTrace.js, so the page may show it as is.
    const failed = (err.trace || []).find((step) => step.status === 'fail');
    const reason = failed?.facts || {};
    console.error('[obo] exchange failed', {
      step: failed?.id,
      error: reason.error || err.pingoneError || err.code || 'unknown',
      description: reason.description || err.pingoneErrorDescription,
      status: reason.httpStatus || err.httpStatus,
    });
    return res.status(502).json({ error: 'OBO exchange failed.', failedStep: failed?.id, steps: err.trace });
  }
});

// Session-authenticated helpers for the /obo-demo page.
// The session access token is server-held (issued by PingOne at login, never supplied by the client),
// so decoding it without signature verification only selects this user's own event stream.
function sessionSub(req) {
  const token = req.session?.oauthTokens?.accessToken;
  if (!token || token === '_cookie_session') return null;
  try { return claims(token).sub || null; } catch (_e) { return null; }
}

function eventsHandler(req, res) {
  const sub = sessionSub(req);
  if (!sub) return res.status(401).json({ error: 'Sign in first.' });
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  res.write(': connected\n\n');
  const off = hub.subscribe(sub, res);
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (_e) { /* closed; the close handler cleans up */ } }, 20000);
  req.on('close', () => { clearInterval(ping); off(); });
  return undefined;
}

router.get('/events', eventsHandler);

module.exports = { router, metadataHandler, eventsHandler };
