'use strict';
/**
 * routes/sdkDemoTokens.js — BFF backing store for the OIDC SDK centralized-login
 * demo (/sdk-login). The browser SDK (@forgerock/oidc-client) is configured with a
 * `custom` storage adapter that round-trips token reads/writes here instead of using
 * localStorage, so the demo persists tokens in LMDB (encrypted, per browser).
 *
 *   GET    /api/sdk-demo/tokens?key=<k>   -> { value: string | null }
 *   PUT    /api/sdk-demo/tokens           body { key, value }  -> 204
 *   DELETE /api/sdk-demo/tokens?key=<k>   -> 204
 *
 * Entries are scoped to the caller's express-session id (req.sessionID); a session
 * marker is set so the session persists (saveUninitialized is false) and the id is
 * stable across the SDK's get/set/remove calls.
 */
const express = require('express');
const tokenStore = require('../services/lmdb/sdkDemoTokenStore.lmdb');

const router = express.Router();

const MAX_VALUE_BYTES = 32 * 1024; // token blobs are a few KB; cap to avoid abuse

// Custom-header CSRF guard for state-changing methods.  Cross-origin requests from
// a third-party page cannot set arbitrary headers (CORS preflight blocks them), so
// requiring a custom header is a lightweight, token-free CSRF mitigation.
function requireCsrfHeader(req, res, next) {
  if (!req.headers['x-sdk-demo-csrf']) {
    return res.status(403).json({ error: 'forbidden', reason: 'missing x-sdk-demo-csrf header' });
  }
  return next();
}

// Ensure a stable, persisted session id for this browser.
function sessionId(req) {
  if (req.session && !req.session.sdkDemo) {
    req.session.sdkDemo = true; // marks the session dirty so it is saved + cookie set
  }
  return req.sessionID;
}

router.get('/tokens', (req, res) => {
  const key = String(req.query.key || '');
  if (!key) return res.status(400).json({ error: 'missing_key' });
  const value = tokenStore.get(sessionId(req), key);
  return res.json({ value: value ?? null });
});

router.put('/tokens', requireCsrfHeader, (req, res) => {
  const { key, value } = req.body || {};
  if (!key || typeof key !== 'string') return res.status(400).json({ error: 'missing_key' });
  if (typeof value !== 'string') return res.status(400).json({ error: 'invalid_value' });
  if (Buffer.byteLength(value, 'utf8') > MAX_VALUE_BYTES) {
    return res.status(413).json({ error: 'value_too_large' });
  }
  tokenStore.put(sessionId(req), key, value);
  return res.status(204).end();
});

router.delete('/tokens', requireCsrfHeader, (req, res) => {
  const key = String(req.query.key || '');
  if (!key) return res.status(400).json({ error: 'missing_key' });
  tokenStore.remove(sessionId(req), key);
  return res.status(204).end();
});

module.exports = router;
