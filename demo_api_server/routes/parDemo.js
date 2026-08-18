'use strict';

/**
 * PAR (RFC 9126) demo routes — self-contained mock, no PingOne dependency.
 *
 * The real /api/auth/par + /api/auth/authorize routes (routes/parRequest.js)
 * are documented for reference but were never given a @body annotation, so
 * the protocol playground fired them with no request at all — and the real
 * /authorize is a GET with query params the playground engine has no way to
 * populate from a threaded response value. This mirrors the same mechanics
 * — push a request, get a request_uri; redeem the request_uri, get a code —
 * as plain POST/JSON, same tradeoff PKCE's demo route already made (see
 * pkceDemo.js's header comment) for the same reason.
 */
const express = require('express');
const crypto = require('crypto');
const router = express.Router();

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function deriveRequestUri(clientId, redirectUri) {
  const hash = base64url(crypto.createHash('sha256').update(`${clientId}|${redirectUri}`).digest()).slice(0, 24);
  return `urn:par:${hash}`;
}

/**
 * Push an authorization request for later retrieval. Client sends
 * authorization parameters and receives a request_uri for later use.
 *
 * @flow par
 * @name PAR
 * @rfc https://datatracker.ietf.org/doc/html/rfc9126 RFC 9126
 * @why PAR (Pushed Authorization Requests) moves authorization parameters off the front channel: normally they travel through the browser as a query string — visible, tamperable, logged in history. With PAR the client pushes them directly to the authorization server over an authenticated backchannel and receives a one-time request_uri; the redirect carries only that opaque reference.
 * @example Like handing your paperwork to the bank clerk in person and getting a ticket number, instead of writing your account details on a postcard that passes through every intermediate hand. A malicious browser extension that rewrites redirect URLs has nothing to rewrite.
 * @ai The intent of the flow is fixed and integrity-protected before anything user-facing happens — an agent (or anything between it and the AS) cannot quietly alter scope, redirect target, or amount mid-redirect.
 * @actor client-app
 * @to auth-server
 * @step 1
 * @body {"client_id":"demo-par-client","redirect_uri":"https://ai-demo.ping-devops.com/callback","scope":"openid profile"}
 */
router.post('/par', express.json(), (req, res) => {
  const { client_id, redirect_uri } = req.body || {};
  if (!client_id || !redirect_uri) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'client_id and redirect_uri are required' });
  }
  res.json({ request_uri: deriveRequestUri(client_id, redirect_uri), expires_in: 900 });
});

/**
 * Authorize a pushed authorization request. Authorization server processes
 * the request_uri and issues an authorization code.
 *
 * @flow par
 * @actor auth-server
 * @to client-app
 * @step 2
 * @body {"request_uri":":requestUri","client_id":"demo-par-client"}
 */
router.post('/authorize', express.json(), (req, res) => {
  const { request_uri, client_id } = req.body || {};
  if (!request_uri || !client_id) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'request_uri and client_id are required' });
  }
  if (!String(request_uri).startsWith('urn:par:')) {
    return res.status(400).json({ error: 'invalid_request_uri', error_description: 'request_uri was not issued by this server' });
  }
  res.json({ code: base64url(crypto.createHash('sha256').update(String(request_uri)).digest()).slice(0, 24) });
});

module.exports = router;
