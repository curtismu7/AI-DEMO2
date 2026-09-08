/**
 * demo_mcp_pingone — HTTP/SSE bridge for pingidentity/pingone-mcp-server.
 *
 * The upstream server (github.com/pingidentity/pingone-mcp-server, Go) speaks
 * stdio ONLY — `run` has no --port/--http/--sse flag, and its Docker guidance is
 * a one-shot `docker run -i --rm`. PingOne Privilege's AI Gateway discovers a
 * backend by issuing a GET and waiting for an SSE `endpoint` event, so it can
 * never reach a stdio process. This bridge closes that gap: it owns ONE
 * long-lived stdio child and exposes it over both transports the estate uses.
 *
 * It is deliberately a composition of two patterns already in this repo rather
 * than a new invention:
 *   - the stdio child + id-remapping bridge from demo_mcp_weather/server.js
 *   - the SSE endpoint handshake from demo_mcp_brave/server.js
 *
 * AUTH: the upstream server is run with a worker client_credentials grant
 * (PINGONE_AUTH_GRANT_TYPE=client_credentials), which is undocumented in its
 * README but supported by the binary. That matters enormously here: its two
 * DOCUMENTED grants (authorization_code, device_code) surface their
 * authorization URL on STDERR as a log line, not as an MCP elicitation — so a
 * caller arriving through the gateway would hang on "Waiting for
 * authorization..." forever with nothing displayed. client_credentials needs no
 * human, so nothing has to traverse the gateway. Measured 2026-09-07.
 *
 * Consequence worth stating on stage: the upstream acts as a SERVICE identity,
 * so PingOne's own role filtering is static and EVERY per-user access decision
 * comes from Privilege policy. That is the point of the demo, but it is a real
 * change from the hosted server's "roles ride on the signed-in user" model.
 */
'use strict';

const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');

const PORT = parseInt(process.env.PORT || '8083', 10);
const CHILD_BIN = process.env.PINGONE_MCP_BIN || '/usr/local/bin/pingone-mcp-server';
// Curated on purpose. The full catalog is 15 tools across four collections;
// applications+populations with writes enabled is what gives the Privilege demo
// its contrast — permit list_applications, deny create_oidc_application.
// Override with PINGONE_MCP_ARGS (space-separated) rather than editing this.
//
// --store-type file is NOT optional in a container. The upstream default is
// `keychain`, which on Linux means the DBus Secret Service; without it the
// process exits 1 on EVERY start with
//   keychain is not accessible: exec: "dbus-launch": executable file not found
// and the bridge just reports "child exited" on each call. It is invisible on
// macOS, which has a keychain — so this only shows up once deployed.
const CHILD_ARGS = (process.env.PINGONE_MCP_ARGS
  || 'run --store-type file --disable-read-only --include-tool-collections applications,populations').split(/\s+/).filter(Boolean);
const CALL_TIMEOUT_MS = parseInt(process.env.PINGONE_MCP_TIMEOUT_MS || '30000', 10);
const INIT_ID = '__bridge_init__';
const SSE_KEEPALIVE_MS = 25_000;

// --- Session minting ---------------------------------------------------------
// The Linux v0.0.2 binary does NOT honour PINGONE_AUTH_GRANT_TYPE=client_credentials
// — it never attempts the flow and fails every tool call with "no active auth
// session found and a browser can't be used for login". The darwin build of the
// SAME commit (68064d2) does honour it, proven by a wrong-secret run returning
// `invalid_client`. Measured 2026-09-07 on v0.0.2.
//
// So the bridge mints the worker token itself and writes the session file the
// binary reads. This deliberately depends on that file's UNDOCUMENTED shape:
//   { accessToken, refreshToken: "", expiry: <RFC3339>, sessionId }
// If an upstream release changes it, this breaks — sessionShape.test.js
// pins the shape so the break is a red test, not a silent demo failure.
//
// There is no refresh token (client_credentials never issues one), so expiry is
// handled by RE-MINTING, and by retrying once when the child reports an auth
// failure — that self-heals even if the child cached a token in memory.
const SESSION_FILE = process.env.PINGONE_MCP_SESSION_FILE
  || path.join(process.env.HOME || os.homedir(), '.pingone_mcp_session.json');
const AUTH_HOST = () => `https://auth.${process.env.PINGONE_ROOT_DOMAIN || 'pingone.com'}`;
const EXPIRY_SKEW_MS = 5 * 60 * 1000;

let child = null;
let childInit = null; // the upstream's own initialize result, echoed to callers
let stdoutBuffer = '';
const pending = new Map(); // internal id -> { resolve, reject, timer, callerId }
const sseSessions = new Map(); // sse session id -> open response stream
const keepAlives = new Set(); // live keep-alive intervals, so shutdown can clear them

/** Is the session file present and good for at least EXPIRY_SKEW_MS more? */
function sessionIsFresh() {
  try {
    const s = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    if (!s.accessToken || !s.expiry) return false;
    return new Date(s.expiry).getTime() - Date.now() > EXPIRY_SKEW_MS;
  } catch {
    return false;
  }
}

/**
 * Mint a worker client_credentials token and write the session file the
 * upstream binary reads. No-op when the current one is still fresh unless
 * `force` is set (used by the retry-once path after an auth failure).
 */
async function ensureSession({ force = false } = {}) {
  if (!force && sessionIsFresh()) return;
  const envId = process.env.PINGONE_MCP_ENVIRONMENT_ID;
  const clientId = process.env.PINGONE_CLIENT_CREDENTIALS_CLIENT_ID;
  const clientSecret = process.env.PINGONE_CLIENT_CREDENTIALS_CLIENT_SECRET;
  if (!envId || !clientId || !clientSecret) {
    throw new Error('PINGONE_MCP_ENVIRONMENT_ID / PINGONE_CLIENT_CREDENTIALS_CLIENT_ID / _CLIENT_SECRET are required');
  }
  const body = new URLSearchParams({ grant_type: 'client_credentials' });
  if (process.env.PINGONE_CLIENT_CREDENTIALS_SCOPES) {
    body.set('scope', process.env.PINGONE_CLIENT_CREDENTIALS_SCOPES);
  }
  const res = await fetch(`${AUTH_HOST()}/${envId}/as/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body,
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  if (!res.ok) {
    // Surface PingOne's own reason (invalid_client, invalid_scope, ...) rather
    // than a generic failure — it is the difference between a bad secret and a
    // bad scope, and the sidecar's logs are the only place anyone will look.
    throw new Error(`token endpoint ${res.status}: ${text.slice(0, 300)}`);
  }
  const tok = JSON.parse(text);
  fs.writeFileSync(SESSION_FILE, `${JSON.stringify({
    accessToken: tok.access_token,
    refreshToken: '',
    expiry: new Date(Date.now() + (tok.expires_in || 3600) * 1000).toISOString(),
    sessionId: randomUUID(),
  })}\n`, { mode: 0o600 });
  console.log(`[mcp-pingone] minted worker session, expires in ${tok.expires_in || 3600}s`);
}

function startChild() {
  // stderr is inherited on purpose: the upstream logs auth and API failures
  // there and nowhere else, so it must reach `kubectl logs` unfiltered.
  child = spawn(CHILD_BIN, CHILD_ARGS, { stdio: ['pipe', 'pipe', 'inherit'] });
  stdoutBuffer = '';

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk;
    let idx;
    while ((idx = stdoutBuffer.indexOf('\n')) !== -1) {
      const line = stdoutBuffer.slice(0, idx);
      stdoutBuffer = stdoutBuffer.slice(idx + 1);
      if (line.trim()) handleChildLine(line);
    }
  });

  child.on('exit', (code) => {
    console.error(`[mcp-pingone] child exited (code=${code}) — will respawn on next request`);
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(new Error('pingone-mcp-server child exited'));
    }
    pending.clear();
    child = null;
    childInit = null;
  });

  child.on('error', (err) => {
    console.error(`[mcp-pingone] child spawn error: ${err.message}`);
    child = null;
    childInit = null;
  });

  // One-time handshake so the child is ready regardless of whether (or how
  // often) HTTP callers send their own initialize. Each gateway session sends
  // one; forwarding them all would re-handshake a single shared child.
  sendRaw({
    jsonrpc: '2.0',
    id: INIT_ID,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'demo-mcp-pingone-bridge', version: '1.0.0' },
    },
  });
}

function sendRaw(message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

function handleChildLine(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    console.error(`[mcp-pingone] unparseable child line: ${line.slice(0, 200)}`);
    return;
  }
  if (msg.id === INIT_ID) {
    childInit = msg.result || null;
    sendRaw({ jsonrpc: '2.0', method: 'notifications/initialized' });
    return;
  }
  const waiter = pending.get(msg.id);
  if (!waiter) return; // stray notification, or the caller already timed out
  clearTimeout(waiter.timer);
  pending.delete(msg.id);
  // Restore the CALLER's id. Sessions pick their own ids independently, so two
  // concurrent gateway sessions both using id 1 would otherwise cross-talk.
  msg.id = waiter.callerId;
  waiter.resolve(msg);
}

/** The upstream's message when it has no usable session. */
function isAuthFailure(response) {
  const text = JSON.stringify(response || '');
  return /no active auth session found|failed to login|Unable to authenticate/i.test(text);
}

function callChild(message, timeoutMs = CALL_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    if (!child) startChild();
    const internalId = randomUUID();
    const timer = setTimeout(() => {
      pending.delete(internalId);
      reject(new Error('pingone-mcp-server child timeout'));
    }, timeoutMs);
    pending.set(internalId, { resolve, reject, timer, callerId: message.id });
    child.stdin.write(`${JSON.stringify({ ...message, id: internalId })}\n`);
  });
}

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

/**
 * One JSON-RPC message in, one response out (or null for a notification).
 * Shared by both transports so they cannot drift apart.
 */
async function dispatch(rpc) {
  if (!rpc || typeof rpc !== 'object' || !rpc.method) {
    return { jsonrpc: '2.0', id: (rpc && rpc.id) ?? null, error: { code: -32600, message: 'Invalid Request' } };
  }
  // Answered locally — the bridge is already initialized against the child.
  // Deliberately does NOT spawn the child: the first spawn should happen after
  // ensureSession() below has written a session file, otherwise every first
  // tool call pays for a guaranteed auth failure and retry.
  if (rpc.method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id: rpc.id,
      result: {
        protocolVersion: (rpc.params && rpc.params.protocolVersion) || '2025-06-18',
        capabilities: (childInit && childInit.capabilities) || { tools: {} },
        serverInfo: { name: 'demo-mcp-pingone-bridge', version: '1.0.0' },
      },
    };
  }
  // The AI Gateway issues `server/discover` to enumerate a backend's tools for
  // policy. It is a GATEWAY method, not MCP — the upstream binary answers
  // `JSON RPC not handled: "server/discover" unsupported`, and forwarding that
  // error breaks the gateway session for every subsequent call. Answer it here
  // with the tool inventory it is actually asking for.
  if (rpc.method === 'server/discover') {
    try {
      await ensureSession();
      const listed = await callChild({ jsonrpc: '2.0', id: rpc.id, method: 'tools/list', params: {} });
      return { jsonrpc: '2.0', id: rpc.id, result: listed.result || { tools: [] } };
    } catch (e) {
      return { jsonrpc: '2.0', id: rpc.id, error: { code: -32000, message: e.message } };
    }
  }
  if (typeof rpc.method === 'string' && rpc.method.startsWith('notifications/')) return null;
  if (rpc.id == null) return null; // any other notification: nothing to answer

  try {
    await ensureSession();
    let response = await callChild(rpc);
    if (isAuthFailure(response)) {
      // The token expired, or the child cached one from before the last mint.
      // Re-mint, restart the child so it re-reads the file, and try once more.
      // This is what makes expiry self-healing without a refresh timer.
      console.warn('[mcp-pingone] auth failure from child — re-minting session and retrying once');
      await ensureSession({ force: true });
      if (child) { child.kill(); child = null; childInit = null; }
      response = await callChild(rpc);
    }
    return response;
  } catch (e) {
    return { jsonrpc: '2.0', id: rpc.id, error: { code: -32000, message: e.message } };
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    return send(res, 200, { ok: true, childAlive: !!child, sseSessions: sseSessions.size });
  }

  // --- SSE transport: what the Privilege AI Gateway actually speaks ---------
  // It issues a bare GET and waits for the `endpoint` event; it never POSTs
  // initialize. /mcp answers on GET too because apps added from the Privilege
  // MCP catalog pin their backend to .../mcp and the field cannot be edited.
  if (req.method === 'GET' && (req.url === '/sse' || req.url === '/mcp')) {
    if (!child) startChild();
    const sessionId = randomUUID();
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    sseSessions.set(sessionId, res);
    res.write(`event: endpoint\ndata: /messages?sessionId=${sessionId}\n\n`);
    const keepAlive = setInterval(() => {
      // Proxies drop an idle stream and the gateway holds this open for the
      // life of the session.
      res.write(': keep-alive\n\n');
    }, SSE_KEEPALIVE_MS);
    keepAlives.add(keepAlive);
    req.on('close', () => {
      clearInterval(keepAlive);
      keepAlives.delete(keepAlive);
      sseSessions.delete(sessionId);
    });
    return undefined;
  }

  if (req.method === 'POST' && req.url.startsWith('/messages')) {
    const sessionId = new URL(req.url, 'http://localhost').searchParams.get('sessionId');
    const stream = sseSessions.get(sessionId);
    if (!stream) {
      // Name the actual fault: a stale session id is indistinguishable from a
      // broken server otherwise.
      return send(res, 404, { error: 'Unknown or closed SSE session', sessionId });
    }
    let rpc;
    try {
      rpc = await readBody(req);
    } catch {
      return send(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    }
    const response = await dispatch(rpc);
    // In this transport the POST is only an ACK; the reply rides the stream.
    res.writeHead(202);
    res.end();
    if (response) stream.write(`event: message\ndata: ${JSON.stringify(response)}\n\n`);
    return undefined;
  }

  // --- Streamable HTTP transport -------------------------------------------
  // /sse accepts POST too. The gateway forwards to whatever path the Agentic App
  // was registered with, so an app registered as .../sse sends its JSON-RPC
  // POSTs to /sse — not to /messages. Handling only GET there returned our own
  // 404 for every call, which looks exactly like a missing app on the gateway.
  if (req.method === 'POST' && (req.url === '/mcp' || req.url === '/sse')) {
    let rpc;
    try {
      rpc = await readBody(req);
    } catch {
      return send(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    }
    const response = await dispatch(rpc);
    if (!response) {
      res.writeHead(202);
      return res.end();
    }
    return send(res, 200, response);
  }

  return send(res, 404, { error: 'Not found' });
});

/**
 * Release everything that holds the event loop open: the stdio child, the
 * keep-alive intervals, and any live SSE stream. Without this a SIGTERM'd pod
 * sits until the kubelet's grace period expires, and a test run never exits.
 */
function shutdown() {
  for (const t of keepAlives) clearInterval(t);
  keepAlives.clear();
  for (const stream of sseSessions.values()) { try { stream.end(); } catch { /* already closed */ } }
  sseSessions.clear();
  for (const { reject, timer } of pending.values()) {
    clearTimeout(timer);
    reject(new Error('bridge shutting down'));
  }
  pending.clear();
  if (child) { child.kill(); child = null; childInit = null; }
}

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`[mcp-pingone] listening on :${PORT} — child=${CHILD_BIN} ${CHILD_ARGS.join(' ')}`);
  });
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => {
      console.log(`[mcp-pingone] ${sig} — shutting down`);
      shutdown();
      server.close(() => process.exit(0));
    });
  }
}

module.exports = { server, dispatch, shutdown, ensureSession, sessionIsFresh, isAuthFailure };
