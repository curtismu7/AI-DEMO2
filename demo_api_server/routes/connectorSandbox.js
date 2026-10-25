'use strict';

/**
 * routes/connectorSandbox.js — the HTTP face of services/connectorSandbox.js (the "add a connector to ChatGPT/Claude"
 * flow). Public documents and the gateway are reachable without a session; the browser legs (authorize, consent,
 * callback) and the run endpoints need the signed-in demo member.
 */

const express = require('express');
const svc = require('../services/connectorSandbox');
const { requireSession } = require('../middleware/auth');

const router = express.Router();

function origin(req) {
  try {
    if (process.env.PUBLIC_APP_URL) return new URL(process.env.PUBLIC_APP_URL).origin;
  } catch { /* malformed PUBLIC_APP_URL: use the request */ }
  return `${req.get('x-forwarded-proto') || req.protocol}://${req.get('host')}`;
}

// The member is whoever is signed in to the demo. `sub` is the stable id the PingOne session carries.
function member(req) {
  const user = req.session?.user;
  const sub = user && String(user.oauthId || user.id || '').trim();
  return sub ? { sub, name: user.username || user.email || sub } : null;
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>
<style>body{font:16px/1.5 Montserrat,system-ui,sans-serif;margin:0;background:#f4f6f9;color:#151a24}main{max-width:460px;margin:8vh auto;background:#fff;border:1px solid #d9dee6;border-radius:12px;padding:28px}
h1{font-size:20px;margin:0 0 4px}dl{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;margin:18px 0;font-size:14px}dt{color:#4b5563}dd{margin:0;overflow-wrap:anywhere}
.row{display:flex;gap:10px;margin-top:22px}button{flex:1;padding:11px;border-radius:8px;border:1px solid #151a24;background:#fff;font:600 14px inherit;cursor:pointer}button.allow{background:#b5231a;border-color:#b5231a;color:#fff}.note{font-size:12px;color:#4b5563}</style></head><body><main>${body}</main></body></html>`;
}

// ------------------------------------------------------------------------------------------------ public documents
router.get('/.well-known/oauth-protected-resource', (req, res) => res.json(svc.protectedResourceMetadata(origin(req))));
router.get('/as/.well-known/oauth-authorization-server', (req, res) => res.json(svc.authorizationServerMetadata(origin(req))));
router.get('/as/jwks.json', (_req, res) => res.json(svc.asJwks()));
router.get('/client.json', (req, res) => res.json(svc.clientDocument(origin(req))));
router.get('/jwks.json', (_req, res) => res.json(svc.clientJwks()));

// ------------------------------------------------------------------------------------------------- the MCP gateway
router.post('/mcp', express.json(), (req, res) => {
  const out = svc.gatewayHandle(origin(req), { authorization: req.get('authorization'), body: req.body });
  Object.entries(out.headers || {}).forEach(([k, v]) => res.set(k, v));
  res.status(out.status).json(out.body);
});

// ------------------------------------------------------------------------------- authorization server (browser legs)
router.get('/as/authorize', (req, res) => {
  const user = member(req);
  if (!user) return res.status(401).send(page('Sign in', '<h1>Sign in first</h1><p>Sign in to the demo, then start the connector again.</p>'));
  const result = svc.authorizeRequest(origin(req), req.query, user);
  if (result.error) return res.status(400).send(page('Cannot continue', `<h1>Cannot continue</h1><p>${escapeHtml(result.error)}: ${escapeHtml(result.description)}</p>`));
  return res.redirect(`${svc.urls(origin(req)).issuer}/consent?rid=${encodeURIComponent(result.rid)}`);
});

router.get('/as/consent', (req, res) => {
  const user = member(req);
  const view = user && svc.consentView(String(req.query.rid || ''), user);
  if (!view) return res.status(400).send(page('Expired', '<h1>This consent request has expired</h1><p>Start the connector again.</p>'));
  return res.send(page('Allow access', `<h1>Allow ${escapeHtml(view.clientName)} to use your benefits?</h1>
<p class="note">Signed in as ${escapeHtml(user.name)}</p>
<dl><dt>Client</dt><dd>${escapeHtml(view.clientId)}</dd><dt>Allow</dt><dd>${escapeHtml(view.allow)}</dd><dt>Downstream</dt><dd>${escapeHtml(view.downstream)}</dd><dt>Purpose</dt><dd>${escapeHtml(view.purpose)}</dd><dt>Scope</dt><dd>${escapeHtml(view.scope)}</dd></dl>
<form method="post" action="${escapeHtml(svc.urls(origin(req)).issuer)}/consent"><input type="hidden" name="rid" value="${escapeHtml(req.query.rid)}">
<div class="row"><button name="decision" value="deny">Deny</button><button class="allow" name="decision" value="allow">Allow</button></div></form>
<p class="note">Your decision is stored as a consent record (id and version) the gateway checks on every call.</p>`));
});

router.post('/as/consent', express.urlencoded({ extended: false }), (req, res) => {
  const user = member(req);
  if (!user) return res.status(401).send(page('Sign in', '<h1>Sign in first</h1>'));
  const out = svc.decideConsent(String(req.body.rid || ''), user, req.body.decision === 'allow');
  if (out.error) return res.status(400).send(page('Expired', '<h1>This consent request has expired</h1>'));
  return res.redirect(out.redirect);
});

// The client's redirect_uri (what ChatGPT calls connector_platform_oauth_redirect): receives the code, then closes the popup.
router.get('/callback', (req, res) => {
  const run = svc.receiveCallback(req.query);
  const done = run && run.status === 'code_received';
  res.send(page('Connected', `<h1>${done ? 'Connected' : 'Not connected'}</h1><p>${done ? 'You can close this window.' : 'Access was not granted.'}</p><script>setTimeout(function(){window.close()},600)</script>`));
});

// ----------------------------------------------------------------------------- run endpoints (the ChatGPT stand-in)
function ownedRun(req, res) {
  const user = member(req);
  if (!user || !svc.runOwnedBy(req.params.id, user.sub)) { res.status(404).json({ error: 'run not found' }); return null; }
  return user;
}

router.post('/runs', requireSession, express.json(), (req, res) => {
  const user = member(req);
  if (!user) return res.status(401).json({ error: 'Sign in to the demo first.' });
  const tool = req.body?.tool && svc.TOOLS[req.body.tool] ? req.body.tool : 'get_my_benefits';
  const { run, authUrl } = svc.startRun(origin(req), user, tool);
  return res.json({ authUrl, run: svc.publicRun(run.id) });
});

router.get('/runs/:id', requireSession, (req, res) => {
  if (!ownedRun(req, res)) return undefined;
  return res.json({ run: svc.publicRun(req.params.id) });
});

router.post('/runs/:id/token', requireSession, (req, res) => {
  if (!ownedRun(req, res)) return undefined;
  const out = svc.exchangeToken(req.params.id);
  return res.status(out.error ? 400 : 200).json({ ...(out.error ? { error: out.error } : {}), run: svc.publicRun(req.params.id) });
});

router.post('/runs/:id/call', requireSession, express.json(), (req, res) => {
  if (!ownedRun(req, res)) return undefined;
  const out = svc.callTool(req.params.id, req.body?.tool);
  return res.status(out.error ? 400 : 200).json({ ...(out.error ? { error: out.error } : { result: { status: out.status, body: out.body } }), run: svc.publicRun(req.params.id) });
});

module.exports = router;
