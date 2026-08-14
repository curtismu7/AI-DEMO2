// demo_api_server/routes/privilegeMcpSimple.js
// A deliberately minimal Privilege-style MCP relay: client_credentials token in,
// MCP JSON-RPC out. No browser OAuth, no PKCE, no per-user session state.
//
// Why this exists alongside routes/privilegeMcpClient.js (which is NOT touched):
// that route models the full interactive flow — a human signs in to PingOne, the
// gateway applies per-user policy — and it cannot complete until an MCP Server
// application is defined in the PingOne Privilege console. This route proves the
// token half of the same story today, machine-to-machine, and switches to the
// gateway by changing one env var once the console side exists.
//
//   BFF -> PingOne (client_credentials, scope=mcp:invoke) -> aud mcpserver.ping.demo
//   BFF -> PRIVILEGE_SIMPLE_MCP_URL (MCP JSON-RPC over HTTP)
//
// Point PRIVILEGE_SIMPLE_MCP_URL at the Privilege gateway frontend and the same
// code path runs through Privilege instead of straight at the MCP server.

'use strict';

const express = require('express');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const { getTokenEndpoint } = require('../services/oauthEndpointResolver');

const router = express.Router();

const TOKEN_SKEW_MS = 60 * 1000;

// One cached token per process. Nothing here is per-user by design.
let cachedToken = null; // { accessToken, expiresAt }
let mcpSessionId = null;
let negotiatedProtocol = null;

function mtlsEnabled() {
  return process.env.MCP_MTLS_ENABLED === 'true';
}

/**
 * mcp-server listens on one port, 8080, and only speaks TLS when mTLS is on —
 * so the scheme has to follow the same switch the client cert does, exactly as
 * docker-compose derives every other consumer's URL from MCP_MTLS_ON. A fixed
 * https:// here fails with "wrong version number" whenever mTLS is off.
 */
function targetUrl() {
  if (process.env.PRIVILEGE_SIMPLE_MCP_URL) return process.env.PRIVILEGE_SIMPLE_MCP_URL;
  return `http${mtlsEnabled() ? 's' : ''}://mcp-server:8080/mcp`;
}

/**
 * Client certificate for the MCP server's mTLS listener. The same pair
 * PingGateway presents; the BFF already has certs/ mounted. Absent or unreadable
 * means "no client cert", which is correct when mTLS is off.
 */
function clientCertOptions() {
  if (!mtlsEnabled()) return {};
  const certPath = process.env.MCP_MTLS_GATEWAY_CERT_PATH || '/certs/gw-mtls/gw-client.crt';
  const keyPath = certPath.replace(/\.crt$/, '.key');
  try {
    return { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) };
  } catch {
    return {};
  }
}

/**
 * MCP responses may be JSON or an SSE-framed body (`data:` lines) — the same
 * duality routes/privilegeMcpClient.js handles. Take the last parsable frame.
 */
function decodeMcpBody(text) {
  if (!text || !text.trim()) return {};
  try { return JSON.parse(text); } catch { /* continue */ }
  const dataLines = text.split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).trim())
    .filter(Boolean);
  for (let i = dataLines.length - 1; i >= 0; i--) {
    try { return JSON.parse(dataLines[i]); } catch { /* continue */ }
  }
  return { raw: text };
}

/** Minimal request helper — node http/https so a client cert can be attached. */
function post(urlString, body, headers, extraOptions) {
  const url = new URL(urlString);
  const isHttps = url.protocol === 'https:';
  const transport = isHttps ? https : http;
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  const options = {
    host: url.hostname,
    port: url.port || (isHttps ? 443 : 80),
    path: url.pathname + url.search,
    method: 'POST',
    headers: { ...headers, 'Content-Length': Buffer.byteLength(payload) },
    ...(isHttps ? extraOptions : {}),
  };
  return new Promise((resolve, reject) => {
    const req = transport.request(options, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: data }));
    });
    req.on('error', reject);
    req.end(payload);
  });
}

/**
 * client_credentials for the MCP server's audience.
 *
 * `scope=mcp:invoke` is REQUIRED, not decorative: the Privilege SSO app holds
 * grants on three resources, and PingOne rejects a bare client_credentials
 * request with "May not request scopes for multiple resources". Naming the scope
 * pins the request to one resource and yields aud=mcpserver.ping.demo.
 */
async function getAccessToken() {
  if (cachedToken && Date.now() < cachedToken.expiresAt - TOKEN_SKEW_MS) {
    return cachedToken.accessToken;
  }
  const clientId = process.env.PRIVILEGE_SSO_CLIENT_ID || process.env.PINGONE_MCP_GATEWAY_CLIENT_ID;
  const clientSecret = process.env.PRIVILEGE_SSO_CLIENT_SECRET || process.env.PINGONE_MCP_GATEWAY_CLIENT_SECRET;
  const envId = process.env.PRIVILEGE_SSO_ENV_ID || process.env.PINGONE_ENVIRONMENT_ID;
  if (!clientId || !clientSecret || !envId) {
    throw new Error('Missing client credentials: need PRIVILEGE_SSO_CLIENT_ID/_SECRET and an environment id.');
  }

  const tokenUrl = getTokenEndpoint();
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      // mcp:invoke alone opens the transport but fails every tool with
      // "Insufficient scope for tool 'get_my_accounts'" — the per-tool check
      // wants the data scopes too. All three live on the mcpserver.ping.demo
      // resource, so asking for them together stays within one resource.
      scope: process.env.PRIVILEGE_SIMPLE_SCOPE || 'read write mcp:invoke',
    }),
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = {}; }
  if (!response.ok || !data.access_token) {
    const err = new Error(`Token request failed: ${response.status} ${text.slice(0, 200)}`);
    err.upstreamStatus = response.status;
    throw err;
  }
  cachedToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  };
  return cachedToken.accessToken;
}

async function callMcp(rpc) {
  const token = await getAccessToken();
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    Authorization: `Bearer ${token}`,
  };
  if (mcpSessionId) headers['MCP-Session-Id'] = mcpSessionId;
  // Required on every non-initialize request — the MCP server answers
  // 400 "mcp-protocol-version header is required" without it. The value comes
  // from the initialize response so client and server agree on one version.
  if (rpc.method && rpc.method !== 'initialize') {
    headers['mcp-protocol-version'] = negotiatedProtocol || '2024-11-05';
  }

  const res = await post(targetUrl(), rpc, headers, {
    ...clientCertOptions(),
    // The MCP server regenerates a self-signed cert on every start, so pinning it
    // is impossible; the channel is container-to-container on a private network
    // and the property being demonstrated is CLIENT authentication.
    rejectUnauthorized: false,
  });

  const sid = res.headers['mcp-session-id'];
  if (sid && sid !== mcpSessionId) mcpSessionId = sid;

  if (res.status >= 400) {
    const err = new Error(`MCP request failed: ${res.status} ${res.text.slice(0, 200)}`);
    err.upstreamStatus = res.status;
    throw err;
  }
  const parsed = decodeMcpBody(res.text);
  if (parsed && parsed.error) {
    throw new Error(`MCP RPC error: ${parsed.error.message || JSON.stringify(parsed.error)}`);
  }
  return parsed;
}

let initialized = false;
async function ensureInitialized() {
  if (initialized) return;
  const init = await callMcp({
    jsonrpc: '2.0',
    id: Date.now(),
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'Privilege MCP Simple Relay', version: '1.0.0' },
    },
  });
  negotiatedProtocol = (init && init.result && init.result.protocolVersion) || '2024-11-05';
  await callMcp({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
  initialized = true;
}

// An upstream 4xx is the caller's problem and must survive the hop; everything
// else is this relay failing to complete a valid request.
function failureStatus(err) {
  const status = err && err.upstreamStatus;
  return Number.isInteger(status) && status >= 400 && status < 500 ? status : 500;
}

function resetSession() {
  initialized = false;
  mcpSessionId = null;
  negotiatedProtocol = null;
}

// GET /status — what this relay is pointed at, without calling anything.
router.get('/status', (req, res) => {
  res.json({
    mcpUrl: targetUrl(),
    mtls: mtlsEnabled(),
    tokenCached: Boolean(cachedToken && Date.now() < cachedToken.expiresAt),
    initialized,
  });
});

// POST /tools/list — the whole point: token in, tools out.
router.post('/tools/list', express.json(), async (req, res) => {
  try {
    await ensureInitialized();
    const data = await callMcp({ jsonrpc: '2.0', id: Date.now(), method: 'tools/list', params: {} });
    res.json({ tools: (data.result && data.result.tools) || [] });
  } catch (err) {
    resetSession();
    res.status(failureStatus(err)).json({ error: err.message });
  }
});

// POST /tools/call — { name, arguments }
router.post('/tools/call', express.json(), async (req, res) => {
  try {
    const { name, arguments: args } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name is required' });
    await ensureInitialized();
    const data = await callMcp({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name, arguments: args || {} },
    });
    res.json(data);
  } catch (err) {
    resetSession();
    res.status(failureStatus(err)).json({ error: err.message });
  }
});

module.exports = router;
