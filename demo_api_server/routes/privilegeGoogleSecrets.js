'use strict';

/**
 * Privilege Hubs — Google secrets demo route (2026-11).
 *
 * Pattern: Privilege Hubs with a Google Secret Manager custodian. The Google
 * credential lives in GCP Secret Manager; Hubs brokers it. An AI agent
 * authenticates to the Hubs/MCP gateway with its agent access key; the
 * gateway's own policy — not this file — decides whether the agent may read
 * a given secret. A policy refusal surfaces as a 403 and is reported as
 * `denied`; the raw secret value returned on allow is masked by default and
 * only revealed when the caller explicitly asks for `reveal`.
 *
 * GUESSED CONFIG (owner to confirm): gateway URL and tool names come from env
 * with defaults matching the existing Procyon mesh frontend. Nothing here
 * talks to GCP directly — the gateway (and its custodian) does.
 *
 * Safety: session-required (same guard as privilegeDecisionDemo); tool names
 * must match a fixed allowlist; output is masked before it reaches the
 * browser unless `reveal: true` is sent, and even then only a trailing
 * 4-char preview plus the secret's metadata are returned — the browser never
 * receives the full raw secret.
 */

const express = require('express');
const { requireSession } = require('../middleware/auth');
const configStore = require('../services/configStore');
const { getProcyonDispatcher, isProcyonAgentUrl } = require('./privilegeMcpClient');

const router = express.Router();

const GATEWAY_URL = process.env.PRIVILEGE_GOOGLE_SECRETS_GATEWAY_URL
  || process.env.PRIVILEGE_DECISION_GATEWAY_URL
  || 'https://a2a-mcp-tools.default.applications.procyon.ai:8643/mcp';

// The allow path (in-scope secret) and the deny path (out-of-scope secret).
// The gateway's policy decides which of these the agent key may read.
const ALLOWED_TOOLS = new Set([
  'get_google_secret',
  'get_google_billing_secret',
]);

const MAX_ARGS_CHARS = 2000;

function agentKey() {
  return configStore.getEffective('PRIVILEGE_A2A_MAIN_AGENT_KEY')
    || process.env.PRIVILEGE_A2A_MAIN_AGENT_KEY
    || '';
}

// Mask any long credential-looking token in upstream text. Keeps enough of a
// tail to prove "a real secret arrived" without shipping the full value.
function maskSecrets(text) {
  return String(text)
    .replace(/\b([A-Za-z0-9_-]{24,})([A-Za-z0-9_-]{4})\b/g, (m, body, tail) => '•'.repeat(8) + tail)
    .replace(/Bearer\s+\S+/gi, 'Bearer [MASKED]');
}

function sseDataLine(text) {
  const line = String(text).split('\n').find((l) => l.startsWith('data: '));
  return line ? line.slice(6) : null;
}

async function mcpCall(headers, body) {
  const fetchOpts = { method: 'POST', headers, body: JSON.stringify(body) };
  if (isProcyonAgentUrl(GATEWAY_URL)) fetchOpts.dispatcher = getProcyonDispatcher();
  const res = await fetch(GATEWAY_URL, fetchOpts);
  const sessionId = res.headers.get('mcp-session-id');
  if (sessionId) headers['mcp-session-id'] = sessionId;
  const text = await res.text();
  return { res, text };
}

function parseResult(text) {
  const data = sseDataLine(text) || (text.trim().startsWith('{') ? text.trim() : null);
  if (!data) return { raw: text };
  try { return JSON.parse(data); } catch { return { raw: text }; }
}

// POST /api/privilege-google-secrets/fetch — { tool, args?, reveal? }.
router.post('/fetch', requireSession, async (req, res, next) => {
  try {
    const { tool, args, reveal } = req.body || {};
    if (typeof tool !== 'string' || !ALLOWED_TOOLS.has(tool)) {
      return res.status(400).json({ error: `tool must be one of the demo allowlist (got ${JSON.stringify(tool ?? null)})` });
    }
    if (args !== undefined && (typeof args !== 'object' || args === null || Array.isArray(args))) {
      return res.status(400).json({ error: 'args must be a JSON object when present' });
    }
    if (reveal !== undefined && typeof reveal !== 'boolean') {
      return res.status(400).json({ error: 'reveal must be a boolean when present' });
    }
    const argsJson = JSON.stringify(args ?? {});
    if (argsJson.length > MAX_ARGS_CHARS) {
      return res.status(400).json({ error: `args too large (${argsJson.length} > ${MAX_ARGS_CHARS} chars)` });
    }
    const key = agentKey();
    if (!key) return res.status(503).json({ error: 'Privilege agent key is not configured on the server (vault entry PRIVILEGE_A2A_MAIN_AGENT_KEY).' });

    const started = Date.now();
    const mcpHeaders = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${key}`,
    };
    const init = await mcpCall(mcpHeaders, {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'ai-demo-privilege-google-secrets', version: '1' } },
    });
    if (!init.res.ok) {
      return res.status(502).json({ error: `gateway refused initialize (${init.res.status})`, upstream: maskSecrets(init.text.slice(0, 400)) });
    }

    const call = await mcpCall(mcpHeaders, {
      jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: tool, arguments: args ?? {} },
    });
    const latencyMs = Date.now() - started;

    if (call.res.status === 403) {
      return res.json({ ok: true, decision: 'denied', by: 'privilege-gateway', status: 403, latencyMs, upstream: maskSecrets(call.text.slice(0, 500)) });
    }
    if (!call.res.ok) {
      return res.status(502).json({ error: `gateway refused tools/call (${call.res.status})`, upstream: maskSecrets(call.text.slice(0, 400)), latencyMs });
    }

    const parsed = parseResult(call.text);
    const isError = Boolean(parsed?.result?.isError);
    const rawUpstream = parsed?.result?.content?.[0]?.text ?? parsed?.raw ?? call.text.slice(0, 500);
    // Even in reveal mode only a preview survives; the gateway/custodian holds
    // the full value and the browser shows enough to prove the flow ran.
    const shown = reveal ? maskSecrets(rawUpstream) : maskSecrets(String(rawUpstream).replace(/[A-Za-z0-9_\/+=-]{20,}[A-Za-z0-9_\/+=-]{4}/g, (m) => '[MASKED:' + m.slice(-4) + ']'));
    return res.json({
      ok: true,
      decision: isError ? 'tool_error' : 'allowed',
      by: 'privilege-gateway',
      status: call.res.status,
      latencyMs,
      revealed: Boolean(reveal),
      upstream: shown,
    });
  } catch (err) {
    err.status = err.status || 502;
    err.expose = true;
    return next(err);
  }
});

// GET /api/privilege-google-secrets/status — what the page shows before running.
router.get('/status', requireSession, (req, res) => {
  res.json({
    gatewayUrl: GATEWAY_URL,
    agentKeyConfigured: Boolean(agentKey()),
    tools: [...ALLOWED_TOOLS],
  });
});

module.exports = { router, ALLOWED_TOOLS, GATEWAY_URL, maskSecrets };
