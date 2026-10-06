'use strict';

const jwt = require('jsonwebtoken');

// Safe copies of protocol traffic for the page to show as proof of what happened. Secrets (authorization codes,
// PKCE verifiers, tokens, client secrets, DPoP proofs) are replaced here, on the server, so none can reach the
// browser; identifiers that are not secret (client_id, redirect_uri, scope) and decoded token CLAIMS are shown.
const SECRET_KEYS = new Set([
  'code', 'code_verifier', 'client_secret', 'access_token', 'refresh_token', 'id_token', 'subject_token', 'assertion',
]);
// Random per-flow values that are not secret, but are long and noisy: show the start only.
const SHORTEN_KEYS = new Set(['state', 'nonce', 'code_challenge']);

function redacted(value) {
  const text = String(value);
  const kind = text.split('.').length === 3 ? 'JWT' : 'opaque';
  return `<redacted ${kind}, ${text.length} chars>`;
}

function shortened(value) {
  const text = String(value);
  return text.length > 12 ? `${text.slice(0, 8)}...` : text;
}

// request_uri is a one-time handle to the pushed request; keep its prefix, which is what teaches.
function maskedRequestUri(value) {
  const text = String(value);
  const at = text.lastIndexOf(':');
  return at > 0 ? `${text.slice(0, at + 1)}${shortened(text.slice(at + 1))}` : shortened(text);
}

function safeValue(key, value) {
  if (value === undefined || value === null) return value;
  if (SECRET_KEYS.has(key)) return redacted(value);
  if (SHORTEN_KEYS.has(key)) return shortened(value);
  if (key === 'request_uri') return maskedRequestUri(value);
  return value;
}

// params: a URLSearchParams, a plain object, or a URL's searchParams. authorization_details stays as parsed JSON.
function safeParams(params) {
  const entries = params instanceof URLSearchParams ? [...params.entries()] : Object.entries(params || {});
  const out = {};
  for (const [key, value] of entries) {
    if (key === 'authorization_details') {
      try { out[key] = JSON.parse(value); } catch { out[key] = String(value).slice(0, 200); }
    } else {
      out[key] = safeValue(key, value);
    }
  }
  return out;
}

// The URL without its query (the parameters are shown separately, redacted).
function bareUrl(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch { return String(value); }
}

function safeBody(body) {
  const out = {};
  for (const [key, value] of Object.entries(body || {})) {
    out[key] = key === 'authorization_details' || (value && typeof value === 'object') ? value : safeValue(key, value);
  }
  return out;
}

// Claims of a JWT (signature not checked here: the BFF verified it before it got this far), or null.
function claimsOf(token) {
  if (typeof token !== 'string' || token.split('.').length !== 3) return null;
  const payload = jwt.decode(token);
  return payload && typeof payload === 'object' ? payload : null;
}

function step({ id, title, request, response = null, claims = null, note = null }) {
  return { id, title, request, response, claims, note };
}

module.exports = { safeParams, safeBody, bareUrl, claimsOf, step, redacted, shortened };
