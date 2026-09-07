#!/usr/bin/env node
'use strict';
/**
 * ai-gateway-client server — a local, no-login test client for an
 * OAuth-protected MCP gateway. Drives OAuth PKCE + Dynamic Client
 * Registration against the gateway's own authorization server, then relays
 * MCP JSON-RPC (tools/list, tools/call, and the other protocol methods)
 * through it. Defaults to PingOne's Privilege AI Gateway; point it at any
 * other self-advertising (RFC 9728/8414) MCP gateway via env vars.
 */
require('dotenv').config();

const path = require('path');
const express = require('express');
const relay = require('./lib/relay');

const PORT = parseInt(process.env.PORT || '3910', 10);
const app = express();

app.use('/api/gateway', relay);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// ── Static web build (production) ───────────────────────────────────────
const webDist = path.join(__dirname, '..', 'web', 'dist');
app.use(express.static(webDist));
app.get(/^(?!\/api\/).*/, (_req, res, next) => {
  res.sendFile(path.join(webDist, 'index.html'), (err) => {
    if (err) next();
  });
});

app.listen(PORT, () => {
  console.log(`[ai-gateway-client] listening on http://127.0.0.1:${PORT}`);
});
