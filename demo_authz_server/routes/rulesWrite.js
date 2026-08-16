'use strict';

/**
 * PUT  /rules        — apply a sparse patch to the editable policy (ruleStore).
 * POST /rules/reset  — clear all overrides, revert to scope-topology.json + env.
 *
 * Env-gated guard: when AUTHZ_ADMIN_TOKEN is set, both require a matching
 * X-Authz-Admin-Token header. When unset, the guard falls back to the bind
 * address: it stays inactive only when HOST is genuinely loopback (the k8s
 * sidecar deployment never overrides HOST, so it defaults to 127.0.0.1, and
 * the BFF admin role is the primary control there). A non-loopback bind
 * (e.g. docker-compose's HOST=0.0.0.0, published to the host) with no token
 * configured would leave these write routes open to anyone who can reach the
 * port, so fail closed instead of silently allowing unauthenticated writes.
 */

const crypto = require('crypto');
const ruleStore = require('../ruleStore');

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

function isLoopbackBind() {
  const host = process.env.HOST || '127.0.0.1';
  return LOOPBACK_HOSTS.has(host);
}

function guardOk(req) {
  const expected = process.env.AUTHZ_ADMIN_TOKEN;
  if (!expected) return isLoopbackBind();
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
