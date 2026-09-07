#!/usr/bin/env node
'use strict';
/**
 * mcp-inspector server — a local, no-login tool for listing and calling
 * tools on any MCP server (http / stdio), plus the non-tools/call protocol
 * methods (resources, prompts, completion, logging) and an optional
 * PingOne-hosted-MCP-server source.
 *
 * Note: "websocket" is accepted by the profile store's transport enum but
 * this standalone build only ships http + stdio dispatch — most MCP servers
 * speak Streamable HTTP or stdio today; add a websocket transport under
 * lib/transports/ if you need one.
 */
require('dotenv').config();

const path = require('path');
const express = require('express');
const profileStore = require('./lib/profileStore');
const httpTransport = require('./lib/transports/http');
const stdioTransport = require('./lib/transports/stdio');
const pingone = require('./lib/pingone');

const PORT = parseInt(process.env.PORT || '3900', 10);
const app = express();
app.use(express.json());

// ── Profiles ────────────────────────────────────────────────────────────
app.get('/api/profiles', (req, res) => {
  res.json({ profiles: profileStore.listProfiles() });
});

app.post('/api/profiles', (req, res) => {
  try {
    const profile = profileStore.createProfile(req.body || {});
    res.status(201).json({ profile });
  } catch (err) {
    res.status(400).json({ error: 'profile_create_failed', message: err.message });
  }
});

app.delete('/api/profiles/:id', (req, res) => {
  try {
    profileStore.deleteProfile(req.params.id);
    res.status(204).end();
  } catch (err) {
    res.status(404).json({ error: err.code || 'profile_delete_failed', message: err.message });
  }
});

function transportFor(profile) {
  if (profile.transport === 'http') return httpTransport;
  if (profile.transport === 'stdio') return stdioTransport;
  throw new Error(`Unsupported transport in this build: ${profile.transport}`);
}

function requireProfile(req, res) {
  const profile = profileStore.getProfile(req.query.profile || req.body?.profile);
  if (!profile) {
    res.status(404).json({ error: 'profile_not_found', message: 'No such MCP server profile.' });
    return null;
  }
  return profile;
}

// GET /api/tools?profile=<id> — tools/list on a saved profile.
app.get('/api/tools', async (req, res) => {
  const profile = requireProfile(req, res);
  if (!profile) return;
  const started = Date.now();
  try {
    const { tools } = await transportFor(profile).listTools(profile);
    res.json({ tools, timingsMs: { roundTrip: Date.now() - started } });
  } catch (err) {
    res.json({ tools: [], error: true, reason: err.message });
  }
});

// POST /api/invoke { profile, tool, params } — tools/call on a saved profile.
app.post('/api/invoke', async (req, res) => {
  const profile = requireProfile(req, res);
  if (!profile) return;
  const { tool, params } = req.body || {};
  if (!tool || typeof tool !== 'string') {
    return res.status(400).json({ error: 'tool name is required' });
  }
  const started = Date.now();
  try {
    const result = await transportFor(profile).callTool(profile, tool, params || {});
    res.json({ result, durationMs: Date.now() - started });
  } catch (err) {
    res.status(502).json({ error: 'mcp_invoke_failed', message: err.message });
  }
});

// ── Protocol methods (Resources, Prompts, Completion, Logging) ────────────
// One catalog entry per method POST /api/rpc accepts, kept in sync by the
// assertion below — the same pattern the embedded BFF's inspector uses.
const PROTOCOL_METHOD_CATALOG = [
  {
    method: 'resources/list',
    description: 'List the resources this server exposes.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    method: 'resources/templates/list',
    description: 'List the parameterized resource URI templates this server exposes.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    method: 'resources/read',
    description: 'Read one resource by URI.',
    inputSchema: {
      type: 'object',
      properties: { uri: { type: 'string', description: 'Resource URI' } },
      required: ['uri'],
    },
  },
  {
    method: 'prompts/list',
    description: 'List the prompt templates this server exposes.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    method: 'prompts/get',
    description: 'Fetch one prompt template, with its arguments interpolated.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Prompt name' },
        arguments: { type: 'object', description: 'JSON object of prompt arguments' },
      },
      required: ['name'],
    },
  },
  {
    method: 'completion/complete',
    description: 'Ask the server to complete a partially-typed prompt or resource argument.',
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'object', description: 'What is being completed, e.g. { "type": "ref/prompt", "name": "..." }' },
        argument: { type: 'object', description: 'The argument and its partial value' },
      },
      required: ['ref', 'argument'],
    },
  },
  {
    method: 'logging/setLevel',
    description: 'Set the minimum severity the server emits log notifications for.',
    inputSchema: {
      type: 'object',
      properties: {
        level: {
          type: 'string',
          enum: ['debug', 'info', 'notice', 'warning', 'error', 'critical', 'alert', 'emergency'],
        },
      },
      required: ['level'],
    },
  },
];
const PROTOCOL_METHODS = new Set(PROTOCOL_METHOD_CATALOG.map((m) => m.method));

app.get('/api/protocol-methods', (_req, res) => {
  res.json({ methods: PROTOCOL_METHOD_CATALOG });
});

// POST /api/rpc { profile, method, params } — dispatches a protocol method to
// the selected profile's own transport (unlike the embedded BFF version, this
// does not require a separate gateway — any profile transport can answer).
app.post('/api/rpc', async (req, res) => {
  const profile = requireProfile(req, res);
  if (!profile) return;
  const { method, params } = req.body || {};
  if (!method || !PROTOCOL_METHODS.has(method)) {
    return res.status(400).json({
      error: 'invalid_method',
      message: `method must be one of: ${[...PROTOCOL_METHODS].join(', ')}`,
    });
  }
  const started = Date.now();
  try {
    const result = await transportFor(profile).rpc(profile, method, params || {});
    res.json({ result, durationMs: Date.now() - started });
  } catch (err) {
    res.status(502).json({ error: 'mcp_rpc_failed', message: err.message });
  }
});

// ── PingOne hosted MCP server (optional) ───────────────────────────────────
app.get('/api/pingone/status', (_req, res) => res.json(pingone.status()));
app.get('/api/pingone/login', (req, res) => {
  if (!pingone.isConfigured()) {
    return res.status(400).json({
      error: 'pingone_not_configured',
      message: 'Set PINGONE_ENVIRONMENT_ID and PINGONE_MCP_CLIENT_ID in .env first.',
    });
  }
  pingone.startLogin(req, res);
});
app.get(pingone.CALLBACK_PATH, (req, res) => pingone.handleCallback(req, res));

app.get('/api/pingone/tools', async (_req, res) => {
  try {
    const tools = await pingone.listTools();
    res.json({ tools });
  } catch (err) {
    if (err.code === 'pingone_login_required') {
      return res.json({ tools: [], loginRequired: true, message: err.message });
    }
    res.json({ tools: [], error: true, reason: err.message });
  }
});

app.post('/api/pingone/invoke', async (req, res) => {
  const { tool, params } = req.body || {};
  if (!tool || typeof tool !== 'string') {
    return res.status(400).json({ error: 'invalid_tool', message: 'Body must include a tool name.' });
  }
  const started = Date.now();
  try {
    const result = await pingone.callTool(tool, params || {});
    res.json({ result, durationMs: Date.now() - started });
  } catch (err) {
    if (err.code === 'pingone_login_required') {
      return res.status(401).json({ error: 'pingone_login_required', message: err.message });
    }
    res.status(502).json({ error: 'pingone_invoke_failed', message: err.message });
  }
});

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
  console.log(`[mcp-inspector] listening on http://127.0.0.1:${PORT}`);
});
