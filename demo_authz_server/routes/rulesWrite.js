'use strict';

/**
 * PUT  /rules        — apply a sparse patch to the editable policy (ruleStore).
 * POST /rules/reset  — clear all overrides, revert to scope-topology.json + env.
 *
 * Env-gated guard: when AUTHZ_ADMIN_TOKEN is set, both require a matching
 * X-Authz-Admin-Token header. When unset, the guard is inactive (the server
 * binds 127.0.0.1 as a sidecar; the BFF admin role is the primary control).
 */

const crypto = require('crypto');
const ruleStore = require('../ruleStore');

function guardOk(req) {
  const expected = process.env.AUTHZ_ADMIN_TOKEN;
  if (!expected) return true;
  const got = req.headers['x-authz-admin-token'] || '';
  const a = Buffer.from(String(got));
  const b = Buffer.from(String(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Wraps a write handler with the env-gated guard so every mutating route is
 * protected the same way — a new write endpoint cannot ship unguarded by accident.
 */
function guarded(handler) {
  return (req, res) => {
    if (!guardOk(req)) return res.status(401).json({ error: 'unauthorized: bad or missing X-Authz-Admin-Token' });
    return handler(req, res);
  };
}

const putHandler = guarded((req, res) => {
  try {
    const editable = ruleStore.applyPatch(req.body || {});
    return res.json({ ok: true, editable });
  } catch (err) {
    if (err.code === 'INVALID_PATCH') return res.status(400).json({ error: err.message });
    console.error('[AuthzServer/rules PUT] error:', err.message);
    return res.status(500).json({ error: 'internal_error' });
  }
});

const resetHandler = guarded((_req, res) => {
  const editable = ruleStore.reset();
  return res.json({ ok: true, editable });
});

module.exports = { putHandler, resetHandler };
