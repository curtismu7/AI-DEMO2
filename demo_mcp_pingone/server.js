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
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');

const PORT = parseInt(process.env.PORT || '8083', 10);
const CHILD_BIN = process.env.PINGONE_MCP_BIN || '/usr/local/bin/pingone-mcp-server';
// Curated on purpose. The full catalog is 15 tools across four collections;
// applications+populations with writes enabled is what gives the Privilege demo
// its contrast — permit list_applications, deny create_oidc_application.
// Override with PINGONE_MCP_ARGS (space-separated) rather than editing this.
const CHILD_ARGS = (process.env.PINGONE_MCP_ARGS
  || 'run --disable-read-only --include-tool-collections applications,populations').split(/\s+/).filter(Boolean);
const CALL_TIMEOUT_MS = parseInt(process.env.PINGONE_MCP_TIMEOUT_MS || '30000', 10);
const INIT_ID = '__bridge_init__';
const SSE_KEEPALIVE_MS = 25_000;

let child = null;
let childInit = null; // the upstream's own initialize result, echoed to callers
let stdoutBuffer = '';
const pending = new Map(); // internal id -> { resolve, reject, timer, callerId }
const sseSessions = new Map(); // sse session id -> open response stream
const keepAlives = new Set(); // live keep-alive intervals, so shutdown can clear them

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
  if (rpc.method === 'initialize') {
    if (!child) startChild();
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
  if (typeof rpc.method === 'string' && rpc.method.startsWith('notifications/')) return null;
  if (rpc.id == null) return null; // any other notification: nothing to answer

  try {
    return await callChild(rpc);
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
  if (req.method === 'POST' && req.url === '/mcp') {
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

module.exports = { server, dispatch, shutdown };
