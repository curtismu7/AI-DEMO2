'use strict';

/**
 * enterpriseIdpAuthStore.js — in-memory codes and pending PingOne federation
 * handshakes for the demo Enterprise IdP's /authorize + /authorize/callback
 * (leg 1 of MCP Enterprise-Managed Authorization). Mirrors
 * oauth-mcp/src/oauth/TokenStore.ts's createCode/createPendingAuthorization
 * pair — same shapes, same TTLs — since /authorize/callback here federates to
 * PingOne exactly the way oauth-mcp's own /authorize/callback already does.
 */

const crypto = require('crypto');

let codes = new Map();
let pending = new Map();

function createCode(params) {
  const code = crypto.randomBytes(32).toString('base64url');
  codes.set(code, { ...params, code, expiresAt: Date.now() + 60_000 });
  return code;
}

function consumeCode(code) {
  const entry = codes.get(code);
  if (!entry) return null;
  codes.delete(code);
  if (Date.now() > entry.expiresAt) return null;
  return entry;
}

function createPendingAuthorization(params) {
  const state = crypto.randomBytes(32).toString('base64url');
  // 10 minutes — a real PingOne login takes longer than a code exchange.
  pending.set(state, { ...params, state, expiresAt: Date.now() + 600_000 });
  return state;
}

function consumePendingAuthorization(state) {
  const entry = pending.get(state);
  if (!entry) return null;
  pending.delete(state);
  if (Date.now() > entry.expiresAt) return null;
  return entry;
}

/** Test-only: clears both maps so each test starts fresh. */
function resetForTests() {
  codes = new Map();
  pending = new Map();
}

module.exports = { createCode, consumeCode, createPendingAuthorization, consumePendingAuthorization, resetForTests };
