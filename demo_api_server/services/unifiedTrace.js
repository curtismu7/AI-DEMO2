'use strict';

/**
 * unifiedTrace.js — the per-request token-chain trace (the educational +
 * debugging artefact described in the `service-logging` skill).
 *
 * Writes one `═══` transaction block per agent-path MCP tool call (wired in
 * mcpToolRegistry.callMcpToolInternal) to `${LOG_DIRECTORY}/demo-unified.log`,
 * narrating every hop with its `token_aud`, the gateway introspection/authorize
 * decision, and the forward result. This is the artefact that turns "401
 * somewhere in a 5-hop chain" into a one-line read: a PERMIT at the gateway
 * followed by a forward failure localises the break to the gateway→server hop
 * instantly (the exact shape of the mcpgateway-vs-mcpserver aud drift this file
 * was born from).
 *
 * Scope: the agent path only (the one user chips travel, and the one that broke
 * here). The browser/inspector BFF-proxied path in mcpToolPipeline.js is a
 * follow-up.
 *
 * Gating: writes only when ENABLE_FILE_LOGGING=true AND LOG_DIRECTORY is set
 * (same switches the structured logger uses). Disabled → every call is a
 * cheap no-op, so call sites need no guard. Best-effort: a logging failure
 * NEVER propagates to the request path.
 *
 * Redaction: tokens are never written — only their decoded `aud`/`sub`/`scope`
 * and an 8-char prefix. No PII beyond the PingOne subject (a UUID).
 */

const fs = require('node:fs');
const path = require('node:path');

const FILE_NAME = 'demo-unified.log';

// Remember the directory we last created so we don't mkdirSync on every write
// (the hot path). Re-runs only when LOG_DIRECTORY changes (e.g. in tests).
let _ensuredDir = null;

function enabled() {
  return process.env.ENABLE_FILE_LOGGING === 'true' && !!process.env.LOG_DIRECTORY;
}

function logPath() {
  return path.join(process.env.LOG_DIRECTORY || '.', FILE_NAME);
}

/** First 8 chars of a token/id for correlation without leaking the value. */
function prefix(value) {
  if (!value || typeof value !== 'string') return '—';
  return `${value.slice(0, 8)}…`;
}

/** aud claim may be a string or array — normalise to a display string. */
function fmtAud(aud) {
  if (aud == null) return '—';
  return Array.isArray(aud) ? aud.join(', ') : String(aud);
}

function formatStep(step, idx) {
  const lines = [`  STEP ${idx + 1} — ${String(step.label || 'STEP').toUpperCase()}${step.ok === false ? ' ❌' : ''}`];
  for (const [k, v] of Object.entries(step.fields || {})) {
    if (v === undefined || v === null || v === '') continue;
    lines.push(`    ${k}: ${v}`);
  }
  if (step.result) lines.push(`    Result: ${step.result}`);
  return lines.join('\n');
}

/**
 * Build the formatted transaction block. Pure — exported for unit testing the
 * exact wire shape without touching the filesystem.
 *
 * @param {object} t
 * @param {string} t.type            e.g. 'MCP: TOOL_CALL'
 * @param {string} [t.timestamp]     ISO 8601 (caller-supplied so the module
 *                                   stays deterministic / Date-free)
 * @param {string} [t.correlationId]
 * @param {string} [t.userSub]
 * @param {string} [t.tool]
 * @param {string} [t.sessionId]
 * @param {Array<{label:string,fields?:object,result?:string,ok?:boolean}>} [t.steps]
 * @param {{ok:boolean, detail?:string, durationMs?:number}} [t.outcome]
 */
function formatTransactionBlock(t = {}) {
  const bar = '═'.repeat(72);
  const foot = '─'.repeat(72);
  const head = [
    bar,
    `TRANSACTION: ${t.type || 'UNKNOWN'}  |  ${t.timestamp || ''}  |  correlation_id: ${t.correlationId || '—'}`,
    `User: ${t.userSub || '—'}  |  Tool: ${t.tool || '—'}  |  Session: ${prefix(t.sessionId)}`,
    bar,
  ];
  const steps = (t.steps || []).map(formatStep);
  const outcome = t.outcome || {};
  const resultLine = `  RESULT: ${outcome.ok ? '✅ success' : '❌ failure'}${
    outcome.detail ? ` — ${outcome.detail}` : ''
  }${typeof outcome.durationMs === 'number' ? ` (${outcome.durationMs}ms)` : ''}`;
  return `${[...head, ...steps, resultLine].join('\n')}\n${foot}\n`;
}

/**
 * Append a transaction block to the unified log. No-op when disabled; never
 * throws. Returns true if a line was written (useful in tests).
 */
function writeTransaction(t) {
  if (!enabled()) return false;
  try {
    const dir = process.env.LOG_DIRECTORY;
    if (dir !== _ensuredDir) {
      fs.mkdirSync(dir, { recursive: true });
      _ensuredDir = dir;
    }
    fs.appendFileSync(logPath(), formatTransactionBlock(t));
    return true;
  } catch (err) {
    // Logging must never break the request path.
    console.error('[unifiedTrace] write failed:', err.message);
    return false;
  }
}

/**
 * Convenience: build the standard per-hop steps for an MCP tool call from the
 * decoded inbound token aud + the gateway audit trail + the tool result/error.
 * Keeps the formatting contract in one place so every call site is consistent.
 *
 * @param {object} a
 * @param {string|string[]} [a.tokenAud]   aud of the bearer presented to the gateway
 * @param {object} [a.gwAuditTrail]        { introspection, authorize, mtls, mcpAudit } from X-Gw-Audit-Trail
 * @param {{isError?:boolean}} [a.result]  the tool result (success path)
 * @param {Error} [a.error]                the thrown error (failure path), e.g. gateway 401
 * @returns {Array} steps for formatTransactionBlock
 */
function buildMcpHopSteps({ tokenAud, gwAuditTrail, result, error } = {}) {
  const steps = [];

  steps.push({
    label: 'BFF → GATEWAY (bearer presented)',
    fields: { 'token_aud': fmtAud(tokenAud) },
  });

  const gw = gwAuditTrail || {};
  if (gw.introspection) {
    const i = gw.introspection;
    steps.push({
      label: 'GATEWAY RFC 7662 INTROSPECTION',
      ok: i.skipped ? undefined : i.active !== false,
      fields: { sub: i.sub, exp: i.exp },
      result: i.skipped ? 'skipped' : (i.active ? 'active=true' : 'active=false'),
    });
  }
  if (gw.authorize) {
    const decision = gw.authorize.decision;
    steps.push({
      label: 'GATEWAY PINGONE AUTHORIZE',
      ok: decision === 'PERMIT',
      result: `${decision}${gw.authorize.reason ? ` (${gw.authorize.reason})` : ''}`,
    });
  }
  if (gw.mcpAudit) {
    const a = gw.mcpAudit;
    steps.push({
      label: 'GATEWAY MCP AUDIT (who/what/when/where/how)',
      ok: a.how?.result !== 'blocked',
      fields: {
        who: a.who?.userSub,
        agent: a.who?.agentSub,
        what: a.what?.tool || a.what?.mcpMethod,
        where: a.where?.resourceId,
      },
      result: `${a.how?.decision || '—'} → ${a.how?.result || 'recorded'}`,
    });
  }

  // The downstream hop: gateway → MCP server (forward). On failure this step
  // carries the real cause (e.g. "401 Invalid or expired token" = the MCP
  // server rejected the forwarded aud).
  const forward = { label: 'GATEWAY → MCP SERVER (forward)' };
  if (error) {
    forward.ok = false;
    forward.fields = { http_status: error.httpStatus, gateway_error: error.gatewayErrorCode || error.code };
    forward.result = error.message || 'forward failed';
  } else {
    forward.ok = !result?.isError;
    forward.result = result?.isError ? 'tool returned error' : 'tool executed';
  }
  steps.push(forward);

  return steps;
}

module.exports = {
  formatTransactionBlock,
  writeTransaction,
  buildMcpHopSteps,
  // exported for tests / introspection
  _enabled: enabled,
  _logPath: logPath,
  FILE_NAME,
};
