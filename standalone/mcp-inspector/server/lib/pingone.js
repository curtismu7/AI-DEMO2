'use strict';
/**
 * pingone.js — local-loopback OAuth Authorization Code + PKCE login for the
 * hosted PingOne MCP server (https://mcp.pingone.{region}/admin/{envId}/mcp),
 * plus a thin JSON-RPC client using the resulting token.
 *
 * No client secret, no worker credentials, no dynamic app provisioning: this
 * is a standalone single-user tool, so it expects the user to have already
 * created a PingOne OIDC app themselves (Authorization Code grant, PKCE
 * S256_REQUIRED, token endpoint auth method "none") with this tool's own
 * callback URL registered as a redirect URI — see README. Config comes from
 * PINGONE_ENVIRONMENT_ID / PINGONE_REGION / PINGONE_MCP_CLIENT_ID env vars.
 *
 * Token is held in a single process-local variable — this tool drives one
 * operator identity, like the rest of this app (no login system of its own).
 */
const crypto = require('crypto');
const axios = require('axios');
const { normalizeAxiosError } = require('./normalizeAxiosError');

const CALLBACK_PATH = '/api/pingone/callback';

let _token = null; // { accessToken, expiresAt }
let _pending = null; // { state, codeVerifier, redirectUri }
let _toolsCache = null;

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function region() {
  return process.env.PINGONE_REGION || 'com';
}

function environmentId() {
  const id = process.env.PINGONE_ENVIRONMENT_ID;
  if (!id) throw new Error('PINGONE_ENVIRONMENT_ID is not set (see .env.example)');
  return id;
}

function clientId() {
  const id = process.env.PINGONE_MCP_CLIENT_ID;
  if (!id) throw new Error('PINGONE_MCP_CLIENT_ID is not set (see .env.example)');
  return id;
}

function authBase() {
  return `https://auth.pingone.${region()}/${environmentId()}/as`;
}

function mcpUrl() {
  return `https://mcp.pingone.${region()}/admin/${environmentId()}/mcp`;
}

function isConfigured() {
  return Boolean(process.env.PINGONE_ENVIRONMENT_ID && process.env.PINGONE_MCP_CLIENT_ID);
}

function status() {
  return {
    configured: isConfigured(),
    signedIn: Boolean(_token && _token.expiresAt > Date.now()),
    expiresAt: _token ? _token.expiresAt : null,
  };
}

// Fixed to the server's own port (not req.headers.host) so the registered
// PingOne redirect URI is stable regardless of whether the browser reached
// this server directly or through the Vite dev proxy on a different port.
function callbackUrl() {
  const port = process.env.PORT || '3900';
  return `http://127.0.0.1:${port}${CALLBACK_PATH}`;
}

/**
 * Starts the login redirect: pushes a PAR request (RFC 9126) then 302s the
 * browser to /as/authorize?client_id=...&request_uri=.... PAR (rather than
 * an inline `resource` param) is this codebase's own proven-working pattern
 * for getting a token scoped to the MCP resource instead of PingOne's
 * default Management API resource.
 */
// Where to send the browser back after login — the built app in production,
// or the Vite dev server (set WEB_URL=http://127.0.0.1:5173 in .env) in dev.
function webUrl() {
  return process.env.WEB_URL || `http://127.0.0.1:${process.env.PORT || '3900'}`;
}

async function startLogin(req, res) {
  const state = crypto.randomBytes(16).toString('hex');
  const codeVerifier = base64url(crypto.randomBytes(32));
  const codeChallenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest());
  const redirectUri = callbackUrl();
  _pending = { state, codeVerifier, redirectUri };

  const authParams = {
    response_type: 'code',
    client_id: clientId(),
    redirect_uri: redirectUri,
    scope: 'openid',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    resource: mcpUrl(),
  };

  try {
    const parResp = await axios.post(
      `${authBase()}/par`,
      new URLSearchParams(authParams).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 },
    );
    const requestUri = parResp.data.request_uri;
    if (!requestUri) throw new Error('PAR endpoint did not return request_uri');
    const authorizeParams = new URLSearchParams({ client_id: clientId(), request_uri: requestUri });
    res.redirect(`${authBase()}/authorize?${authorizeParams.toString()}`);
  } catch (err) {
    const n = normalizeAxiosError(err, { label: 'PingOne PAR push' });
    res.redirect(`${webUrl()}/?pingone_error=${encodeURIComponent(n.message)}`);
  }
}

async function handleCallback(req, res) {
  const { code, state, error, error_description: errorDescription } = req.query;
  const pending = _pending;
  const fail = (message) => {
    _pending = null;
    res.redirect(`${webUrl()}/?pingone_error=${encodeURIComponent(message)}`);
  };

  if (error) return fail(errorDescription || error);
  if (!pending || !state || state !== pending.state) return fail('invalid_state');
  if (!code) return fail('missing_code');

  try {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: pending.redirectUri,
      client_id: clientId(),
      code_verifier: pending.codeVerifier,
      resource: mcpUrl(),
    });
    const resp = await axios.post(`${authBase()}/token`, body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15000,
    });
    const expiresInMs = (resp.data.expires_in || 3600) * 1000;
    _token = { accessToken: resp.data.access_token, expiresAt: Date.now() + expiresInMs };
    _toolsCache = null;
    _pending = null;
    res.redirect(`${webUrl()}/?pingone_login=success`);
  } catch (err) {
    const n = normalizeAxiosError(err, { label: 'PingOne token request' });
    fail(n.message);
  }
}

function requireToken() {
  if (!_token || !(_token.expiresAt > Date.now())) {
    const e = new Error('Not signed in to PingOne. Click "Sign in" on the PingOne tab.');
    e.code = 'pingone_login_required';
    throw e;
  }
  return _token.accessToken;
}

function extractJsonRpc(data) {
  if (data && typeof data === 'object') return data;
  if (typeof data !== 'string') return data;
  const trimmed = data.trim();
  if (trimmed.startsWith('{')) return JSON.parse(trimmed);
  const dataLines = trimmed.split('\n').filter((l) => l.startsWith('data:'));
  if (dataLines.length) return JSON.parse(dataLines[dataLines.length - 1].slice(5).trim());
  throw new Error('PingOne MCP: unrecognized response framing');
}

let _msgId = 0;

async function send(method, params) {
  const token = requireToken();
  const id = ++_msgId;
  let resp;
  try {
    resp = await axios.post(
      mcpUrl(),
      { jsonrpc: '2.0', id, method, params },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        timeout: 30000,
        validateStatus: (s) => s >= 200 && s < 300,
        responseType: 'text',
        transformResponse: (d) => d,
      }
    );
  } catch (err) {
    throw normalizeAxiosError(err, { label: 'PingOne MCP HTTP request', timeoutMs: 30000 });
  }
  const json = extractJsonRpc(resp.data);
  if (json && json.error) {
    const e = new Error(json.error.message || 'PingOne MCP JSON-RPC error');
    e.code = 'pingone_mcp_rpc_error';
    e.mcpCode = json.error.code;
    throw e;
  }
  return json ? json.result : undefined;
}

async function listTools() {
  if (_toolsCache) return _toolsCache;
  const result = await send('tools/list', {});
  _toolsCache = Array.isArray(result?.tools) ? result.tools : [];
  return _toolsCache;
}

async function callTool(tool, params) {
  return send('tools/call', { name: tool, arguments: params || {} });
}

module.exports = { CALLBACK_PATH, isConfigured, status, startLogin, handleCallback, listTools, callTool };
