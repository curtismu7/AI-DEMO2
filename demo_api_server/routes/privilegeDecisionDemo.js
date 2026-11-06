'use strict';

/**
 * Live-Privilege decision demo route (platform-update demos, 2026-11).
 *
 * The five Privilege platform pages (intent-triage, coding-agents, saas-access,
 * prompt-log, pii-detection) resolve their scenario outcomes through THIS route
 * instead of local mock tables: the BFF performs a real MCP `tools/call` against
 * the tenant's Privilege AI Gateway (`*.applications.procyon.ai` mesh frontend,
 * agent-key bearer auth) and relays the governed result. The gateway's own
 * policy — not this file — decides allow/deny: a policy refusal surfaces as a
 * 403 from the gateway and is reported as `denied` with the gateway's reason.
 *
 * Safety: session-required (same guard as the other privilege routes); the
 * tool name must match a fixed allowlist so the browser cannot use this as a
 * general MCP proxy; arguments are passed through as JSON, size-capped.
 */

const express = require('express');
const { requireSession } = require('../middleware/auth');
const configStore = require('../services/configStore');
const { getProcyonDispatcher, isProcyonAgentUrl } = require('./privilegeMcpClient');

const router = express.Router();

// The mesh frontend proven live (agent key → initialize → tools/list 200).
const GATEWAY_URL = process.env.PRIVILEGE_DECISION_GATEWAY_URL
  || 'https://a2a-mcp-tools.default.applications.procyon.ai:8643/mcp';

// Tools this demo may invoke through the gateway. Everything else is refused
// client-side of the MCP call: this endpoint is a demo decision path, not a
// general MCP proxy.
const ALLOWED_TOOLS = new Set([
  'list_entitlements',
  'who_has_role',
  'get_access_grants',
  'open_ticket',
  'get_portfolio_summary',
  'get_investment_accounts',
  'get_investment_balance',
  'get_investment_transactions',
  'sensitive_patient_records',
  'sensitive_order_history',
  'sensitive_membership_details',
  'sensitive_payroll_details',
  'sensitive_tax_record',
  'sensitive_student_finance',
  'sensitive_supplier_contract',
  'sensitive_holdings',
  'sensitive_passenger_record',
  'sensitive_customer_identity',
]);

const MAX_ARGS_CHARS = 2000;

function agentKey() {
  return configStore.getEffective('PRIVILEGE_A2A_MAIN_AGENT_KEY')
    || process.env.PRIVILEGE_A2A_MAIN_AGENT_KEY
    || '';
}

function sseDataLine(text) {
  const line = String(text).split('\n').find((l) => l.startsWith('data: '));
  return line ? line.slice(6) : null;
}

// headers is shared and mutated in place: the initialize call captures the
// gateway's mcp-session-id into it so the following tools/call carries it.
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

// POST /api/privilege/decision — { tool, args } → the gateway's governed answer.
router.post('/decision', requireSession, async (req, res, next) => {
  try {
    const { tool, args } = req.body || {};
    if (typeof tool !== 'string' || !ALLOWED_TOOLS.has(tool)) {
      return res.status(400).json({ error: `tool must be one of the demo allowlist (got ${JSON.stringify(tool ?? null)})` });
    }
    if (args !== undefined && (typeof args !== 'object' || args === null || Array.isArray(args))) {
      return res.status(400).json({ error: 'args must be a JSON object when present' });
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
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'ai-demo-privilege-decision', version: '1' } },
    });
    if (!init.res.ok) {
      return res.status(502).json({ error: `gateway refused initialize (${init.res.status})`, upstream: init.text.slice(0, 400) });
    }
    // init.text is the awaited body (mcpCall already consumed the stream).

    const call = await mcpCall(mcpHeaders, {
      jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: tool, arguments: args ?? {} },
    });
    const latencyMs = Date.now() - started;

    if (call.res.status === 403) {
      // A real policy decision by the gateway: the agent key was not permitted.
      return res.json({ ok: true, decision: 'denied', by: 'privilege-gateway', status: 403, latencyMs, upstream: call.text.slice(0, 500) });
    }
    if (!call.res.ok) {
      return res.status(502).json({ error: `gateway refused tools/call (${call.res.status})`, upstream: call.text.slice(0, 400), latencyMs });
    }

    const parsed = parseResult(call.text);
    const isError = Boolean(parsed?.result?.isError);
    return res.json({
      ok: true,
      decision: isError ? 'tool_error' : 'allowed',
      by: 'privilege-gateway',
      status: call.res.status,
      latencyMs,
      upstream: parsed?.result?.content?.[0]?.text ?? parsed?.raw ?? call.text.slice(0, 500),
    });
  } catch (err) {
    err.status = err.status || 502;
    err.expose = true;
    return next(err);
  }
});

module.exports = { router, ALLOWED_TOOLS, GATEWAY_URL };
