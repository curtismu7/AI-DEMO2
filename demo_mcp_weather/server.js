/**
 * demo_mcp_weather — HTTP-to-stdio bridge for the third-party weather-mcp server.
 * weather-mcp ships stdio-only; Agent Gateway (ping-gateway)'s ReverseProxyHandler
 * needs an HTTP backend. This bridge spawns weather-mcp as a long-lived stdio
 * child and exposes it over MCP Streamable HTTP (POST /mcp, JSON-RPC 2.0).
 */
'use strict';

const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');

const PORT = parseInt(process.env.PORT || '8896', 10);
const CHILD_ENTRY = path.join(__dirname, 'node_modules', '@dangahagan', 'weather-mcp', 'dist', 'index.js');
const INIT_ID = '__bridge_init__';

let child = null;
let stdoutBuffer = '';
const pending = new Map(); // JSON-RPC id -> { resolve, reject, timer }

function sendRaw(message) {
  child.stdin.write(JSON.stringify(message) + '\n');
}

function startChild() {
  child = spawn(process.execPath, [CHILD_ENTRY], { stdio: ['pipe', 'pipe', 'inherit'] });
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
    console.error(`[mcp-weather] child exited (code=${code}) — will respawn on next request`);
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(new Error('weather-mcp child exited'));
    }
    pending.clear();
    child = null;
  });

  child.on('error', (err) => {
    console.error(`[mcp-weather] child spawn error: ${err.message}`);
    child = null;
  });

  // One-time MCP handshake so the child is always ready for tools/list and
  // tools/call regardless of whether the HTTP caller sends its own initialize.
  sendRaw({
    jsonrpc: '2.0',
    id: INIT_ID,
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'demo-mcp-weather-bridge', version: '1.0.0' },
    },
  });
}

function handleChildLine(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch (e) {
    console.error(`[mcp-weather] unparseable child line: ${line.slice(0, 200)}`);
    return;
  }
  if (msg.id === INIT_ID) {
    sendRaw({ jsonrpc: '2.0', method: 'notifications/initialized' });
    return;
  }
  const waiter = pending.get(msg.id);
  if (!waiter) return; // stray notification or no in-flight HTTP request waiting on this id
  clearTimeout(waiter.timer);
  pending.delete(msg.id);
  msg.id = waiter.callerId;
  waiter.resolve(msg);
}

function callChild(message, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    if (!child) startChild();
    const internalId = randomUUID();
    const timer = setTimeout(() => {
      pending.delete(internalId);
      reject(new Error('weather-mcp child timeout'));
    }, timeoutMs);
    pending.set(internalId, { resolve, reject, timer, callerId: message.id });
    child.stdin.write(JSON.stringify({ ...message, id: internalId }) + '\n');
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
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (e) { reject(Object.assign(e, { status: 400 })); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    return send(res, 200, { ok: true, childAlive: !!child });
  }

  if (req.method === 'POST' && req.url === '/mcp') {
    let rpc;
    try {
      rpc = await readBody(req);
    } catch (e) {
      return send(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    }

    // The bridge is always initialized against the child at startup — answer
    // any caller-side initialize locally instead of forwarding a second one.
    if (rpc.method === 'initialize') {
      return send(res, 200, {
        jsonrpc: '2.0',
        id: rpc.id,
        result: {
          protocolVersion: (rpc.params && rpc.params.protocolVersion) || '2025-03-26',
          capabilities: { tools: {} },
          serverInfo: { name: 'demo-mcp-weather-bridge', version: '1.0.0' },
        },
      });
    }
    if (rpc.method === 'notifications/initialized') {
      res.writeHead(202);
      return res.end();
    }

    try {
      // Agent/BFF call get_weather; third-party weather-mcp's default ENABLED_TOOLS
      // has get_current_conditions (not get_weather). Rewrite at the bridge so
      // gateway-scoped PERMIT demos return real weather instead of isError.
      let forward = rpc;
      if (
        rpc &&
        rpc.method === 'tools/call' &&
        rpc.params &&
        rpc.params.name === 'get_weather'
      ) {
        forward = {
          ...rpc,
          params: { ...rpc.params, name: 'get_current_conditions' },
        };
      }
      const result = await callChild(forward);
      return send(res, 200, result);
    } catch (e) {
      return send(res, 502, { jsonrpc: '2.0', id: rpc.id != null ? rpc.id : null, error: { code: -32000, message: e.message } });
    }
  }

  send(res, 404, { error: 'Not found' });
});

startChild();
server.listen(PORT, () => {
  console.log(`[mcp-weather] listening on :${PORT}`);
});
