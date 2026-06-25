'use strict';
/**
 * reportFormatter.js — Format run records as Markdown, HTML, or PDF.
 *
 * Run record shape (stored by reportStore + augmented by routes/reports.js):
 *   { runId, userId, vertical, prompt, startedAt, completedAt,
 *     toolsCalled[], tokenEvents[], tokenCount, mcpToolCallsChain[],
 *     agentPath, confidence, intent, success, files[] }
 *
 * Token event shape (from agentMcpTokenService / buildTokenEvent):
 *   { id, label, status, timestamp, claims, explanation, rfc, alg,
 *     eventType, intent?, confidence?, permitted_tools?, ... }
 *
 * MCP tool call shape (from tokenChainService.getMCPToolCalls):
 *   { id, timestamp, toolName, status, duration, chainIndex, isDelegated,
 *     scopes[], requestJson, resultJson, resultSummary }
 */

function isEventSuccess(evt) {
  return evt.status === 'success' || evt.status === 'active'
    || evt.status === 'valid' || evt.status === 'permit'
    || evt.status === 'exchanged' || evt.status === 'skipped';
}

// All claims to surface in reports — mirrors agentMcpTokenService sanitizeClaims
// plus intent-token-specific extras (permitted_tools, prompt_hash, vertical).
var INTERESTING_CLAIMS = [
  'sub', 'aud', 'scope', 'iss', 'exp', 'iat',
  'act', 'may_act', 'client_id', 'azp', 'jti',
  'intent', 'confidence', 'permitted_tools', 'vertical', 'prompt_hash'
];

function formatClaimsBlock(claims) {
  if (!claims || typeof claims !== 'object') { return ''; }
  const lines = [];
  for (const k of INTERESTING_CLAIMS) {
    if (claims[k] == null) continue;
    const v = typeof claims[k] === 'object' ? JSON.stringify(claims[k]) : String(claims[k]);
    lines.push('  - **' + k + '**: `' + v + '`');
  }
  return lines.join('\n');
}

/**
 * Walk the nested `act` chain into a readable delegation order.
 * act:{specialist, act:{generalist}} on sub:user → "user → generalist → specialist".
 * Returns { chain: string, depth: number } or null when there is no act claim.
 */
function delegationChain(claims) {
  if (!claims || !claims.act) { return null; }
  const actors = [];
  let node = claims.act;
  let guard = 0;
  while (node && (node.sub || node.client_id) && guard < 6) {
    actors.push(node.sub || node.client_id);
    node = node.act;
    guard += 1;
  }
  if (actors.length === 0) { return null; }
  // Outermost act is the current actor; reverse so the chain reads in delegation order.
  const order = [claims.sub || 'user', ...actors.slice().reverse()];
  return { chain: order.join(' → '), depth: actors.length };
}

// ─── MARKDOWN ──────────────────────────────────────────────────────────────

function formatMarkdown(run) {
  const date = new Date(run.startedAt).toLocaleString();
  const toolsList = (run.toolsCalled || []).join(', ') || '(none)';
  const verticalLabel = run.vertical || 'banking';
  const mcpChain = run.mcpToolCallsChain || [];

  let md = `# Agent Run Report\n\n`;
  md += `> **OAuth Token Chain & MCP Delegation Audit**  \n`;
  md += `> Every step of the authorization pipeline — user authentication, token exchange, `;
  md += `agent delegation, and tool invocation — is recorded below.  \n`;
  md += `> Use this report to verify that only authorized actions were taken with appropriately-scoped tokens.\n\n`;
  md += `---\n\n`;

  md += `## Summary\n\n`;
  md += `| Field | Value |\n|-------|-------|\n`;
  md += `| **Vertical** | ${verticalLabel} |\n`;
  md += `| **Date** | ${date} |\n`;
  md += '| **Run ID** | `' + run.runId + '` |\n';
  md += `| **Status** | ${run.success ? '✅ Success' : '❌ Failed'} |\n`;
  md += `| **Agent Path** | ${run.agentPath || 'unknown'} |\n`;
  md += `| **Intent** | ${run.intent || 'unknown'} |\n`;
  md += `| **Tools Called** | ${toolsList} |\n`;
  md += `| **Confidence** | ${(run.confidence || 0).toFixed(2)} |\n`;
  md += `| **Token Events** | ${run.tokenCount || run.tokenEvents?.length || 0} |\n`;
  md += `| **MCP Tool Calls** | ${mcpChain.length} |\n`;
  md += '\n';

  md += `## Prompt\n\n`;
  md += `> *The original natural-language prompt submitted by the user.*\n\n`;
  md += '```\n' + run.prompt + '\n```\n\n';

  md += `---\n\n`;

  // OAuth token chain
  if (run.tokenEvents && run.tokenEvents.length > 0) {
    md += `## OAuth Token Chain (${run.tokenEvents.length} events)\n\n`;
    md += `> Each step below represents a token lifecycle event in the authorization pipeline:\n`;
    md += `> user authentication (RFC 6749), token introspection (RFC 7662), token exchange\n`;
    md += `> (RFC 8693), and intent binding (draft-ietf-oauth-intent-token).\n\n`;
    for (let i = 0; i < run.tokenEvents.length; i++) {
      const evt = run.tokenEvents[i];
      const icon = isEventSuccess(evt) ? '✅' : (evt.status === 'skipped' ? '⚠️' : '❌');
      const time = new Date(evt.timestamp).toLocaleTimeString();

      md += `### ${i + 1}. ${evt.label || evt.id || 'Event'}\n\n`;
      let statusLine = '**Status:** ' + icon + ' `' + evt.status + '`';
      if (evt.eventType) statusLine += '  ·  **Type:** `' + evt.eventType + '`';
      if (evt.alg) statusLine += '  ·  **Alg:** `' + evt.alg + '`';
      if (evt.clientAuthMethod) statusLine += '  ·  **Client Auth:** `' + evt.clientAuthMethod + '`';
      md += statusLine + '\n';
      md += `**Time:** ${time}\n`;
      if (evt.rfc) md += `**RFC:** ${evt.rfc}\n`;
      // Auth event fields (from tokenChainService trackTokenEvent shape)
      if (evt.tokenType) md += `**Token Type:** ${evt.tokenType}\n`;
      if (evt.tokenSub) md += '**Subject:** `' + evt.tokenSub + '`\n';
      if (evt.audience) md += `**Audience:** ${Array.isArray(evt.audience) ? evt.audience.join(', ') : evt.audience}\n`;
      if (evt.issuer) md += `**Issuer:** ${evt.issuer}\n`;
      if (evt.expiry) md += `**Expiry:** ${new Date(evt.expiry).toLocaleString()}\n`;
      if (evt.explanation) md += `\n> ${evt.explanation.replace(/\n/g, '  \n> ')}\n`;

      const claimsBlock = formatClaimsBlock(evt.claims);
      if (claimsBlock) {
        md += `\n**Token Claims:**\n\n${claimsBlock}\n`;
      }

      // Delegation chain (RFC 8693 act). A depth >= 2 chain is an A2A specialist
      // delegation (a generalist agent handed off to a per-vertical specialist).
      const del = delegationChain(evt.claims);
      if (del) {
        md += `\n**Delegation chain:** ${del.chain}`;
        if (del.depth >= 2) md += `  ·  🔗 A2A specialist delegation (act depth ${del.depth})`;
        md += `\n`;
      }

      // Exchange steps (RFC 8693 multi-leg token exchange)
      if (evt.exchangeSteps && evt.exchangeSteps.length > 0) {
        md += `\n**Exchange Steps:**\n\n`;
        evt.exchangeSteps.forEach(function(step, si) {
          md += `  ${si + 1}. **${step.step || 'Step ' + (si + 1)}** — ${step.description || ''}\n`;
          if (step.timestamp) md += `     _${new Date(step.timestamp).toLocaleTimeString()}_\n`;
        });
      }
      md += '\n';
    }
  } else {
    md += `## OAuth Token Chain\n\n`;
    md += `> *No token events were recorded for this run.*  \n`;
    md += `> NL-routed runs that resolve via heuristics only do not invoke the full agent pipeline and produce no token events.\n\n`;
  }

  md += `---\n\n`;

  // MCP delegation trail
  if (mcpChain.length > 0) {
    md += `## MCP Delegation Trail (${mcpChain.length} tool calls)\n\n`;
    md += `> These are the Model Context Protocol (MCP) tool invocations made by the agent during this session.\n`;
    md += `> Each call was authorized via the token exchange chain above. Delegated calls\n`;
    md += '> carry an actor token (`act` claim) binding the agent\'s identity (RFC 8693 §4.4).\n\n';
    for (let i = 0; i < mcpChain.length; i++) {
      const call = mcpChain[i];
      const icon = call.status === 'success' ? '✅' : '❌';
      const time = call.timestamp ? new Date(call.timestamp).toLocaleTimeString() : '';
      md += '### ' + (i + 1) + '. `' + (call.toolName || 'unknown') + '`\n\n';
      let callLine = '**Status:** ' + icon + ' `' + call.status + '`';
      if (call.duration) callLine += `  ·  **Duration:** ${call.duration}ms`;
      if (call.isDelegated) callLine += '  ·  🔗 Delegated';
      if (call.chainIndex != null) callLine += `  ·  **Step:** ${call.chainIndex}`;
      md += callLine + '\n';
      if (time) md += `**Time:** ${time}\n`;
      if (call.scopes && call.scopes.length) md += '**Scopes:** `' + (Array.isArray(call.scopes) ? call.scopes.join(' ') : call.scopes) + '`\n';
      if (call.resultSummary) md += `**Result:** ${call.resultSummary}\n`;
      if (call.requestJson) {
        md += '\n**Request:**\n\n```json\n' + JSON.stringify(call.requestJson, null, 2) + '\n```\n';
      }
      if (call.resultJson) {
        md += '\n**Response:**\n\n```json\n' + JSON.stringify(call.resultJson, null, 2) + '\n```\n';
      }
      md += '\n';
    }
  } else {
    md += `## MCP Delegation Trail\n\n`;
    md += `> *No MCP tool call events found for this session.*  \n`;
    md += `> Tool calls are recorded by the MCP audit server and matched to the current user session.\n\n`;
  }

  md += `---\n\n`;

  md += `## Metadata\n\n`;
  md += `| Field | Value |\n|-------|-------|\n`;
  md += `| **Started** | ${run.startedAt} |\n`;
  md += `| **Completed** | ${run.completedAt} |\n`;
  if (run.savedAt) md += `| **Saved** | ${run.savedAt} |\n`;
  if (run.userId) md += '| **User ID** | `' + run.userId + '` |\n';
  md += '\n';
  md += `---\n\n`;
  md += `*Report generated by the AI Demo authorization audit system.*\n`;

  return md;
}

// ─── HTML ───────────────────────────────────────────────────────────────────

function formatHtml(run) {
  const date = new Date(run.startedAt).toLocaleString();
  const toolsList = (run.toolsCalled || []).join(', ') || '(none)';
  const verticalLabel = run.vertical || 'banking';
  const sanitizedPrompt = (run.prompt || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const mcpChain = run.mcpToolCallsChain || [];

  let html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Run Report — ${verticalLabel} — ${date}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      line-height: 1.6;
      color: #333;
      background: #f0f4f8;
      padding: 2rem;
    }
    .container {
      max-width: 960px;
      margin: 0 auto;
      background: white;
      border-radius: 10px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.12);
      overflow: hidden;
    }
    .report-banner {
      background: linear-gradient(135deg, #1a5276 0%, #277ba5 60%, #2e86c1 100%);
      color: white;
      padding: 2rem 2.5rem 1.5rem;
    }
    .report-banner h1 { font-size: 1.8rem; font-weight: 700; letter-spacing: -0.02em; margin-bottom: 0.25rem; }
    .report-banner .subtitle { font-size: 0.9rem; opacity: 0.85; font-weight: 400; line-height: 1.5; }
    .report-banner .run-id { margin-top: 0.75rem; font-size: 0.78rem; opacity: 0.7; font-family: "Monaco", "Menlo", monospace; }
    .content { padding: 2rem 2.5rem; }
    h2 {
      color: #1a5276;
      font-size: 1.15rem;
      font-weight: 700;
      margin-top: 2.5rem;
      margin-bottom: 0.35rem;
      padding-bottom: 0.4rem;
      border-bottom: 2px solid #d6eaf8;
    }
    h2:first-of-type { margin-top: 0; }
    .section-desc { font-size: 0.82rem; color: #666; margin-bottom: 1rem; line-height: 1.5; font-style: italic; }
    .summary-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 0.75rem; margin: 1rem 0 1.5rem; }
    .summary-cell { background: #f4f8fb; padding: 0.75rem 1rem; border-radius: 6px; border-left: 3px solid #277ba5; font-size: 0.88rem; }
    .summary-cell strong { color: #1a5276; display: block; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 0.2rem; }
    .summary-cell.success { border-left-color: #27ae60; }
    .summary-cell.failed { border-left-color: #e74c3c; }
    .badge { display: inline-block; padding: 0.15rem 0.55rem; border-radius: 999px; font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
    .badge-success { background: #d5f5e3; color: #1e8449; }
    .badge-failed { background: #fde8e8; color: #c0392b; }
    .badge-skipped { background: #fef9e7; color: #9a7d0a; }
    .badge-active { background: #d6eaf8; color: #1a5276; }
    .badge-neutral { background: #eaecee; color: #555; }
    code { background: #f0f4f8; padding: 1px 5px; border-radius: 3px; font-family: "Monaco", "Menlo", monospace; font-size: 0.82em; color: #1a5276; }
    pre { background: #1e2a35; color: #a8d8ea; padding: 1rem 1.25rem; border-radius: 6px; overflow-x: auto; margin: 0.75rem 0 1.5rem; font-size: 0.9rem; line-height: 1.55; }
    pre code { background: none; padding: 0; color: inherit; font-size: inherit; }
    .event-list { margin: 0.5rem 0 1rem; }
    .event-item { background: #f9fbfd; padding: 0.9rem 1.1rem; margin-bottom: 0.65rem; border-radius: 6px; border-left: 4px solid #277ba5; }
    .event-item.failed { border-left-color: #e74c3c; background: #fdf8f8; }
    .event-item.skipped { border-left-color: #f0b429; background: #fdfbf3; }
    .event-header { display: flex; align-items: baseline; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.35rem; }
    .event-index { font-size: 0.75rem; color: #888; font-weight: 600; }
    .event-label { font-weight: 600; color: #1a5276; font-size: 0.95rem; flex: 1; }
    .event-pills { display: flex; gap: 0.35rem; flex-wrap: wrap; margin-bottom: 0.4rem; }
    .pill { display: inline-flex; align-items: center; gap: 0.25rem; padding: 0.1rem 0.5rem; border-radius: 999px; font-size: 0.72rem; font-weight: 500; background: #eaf2fb; color: #2471a3; border: 1px solid #d6eaf8; }
    .pill.rfc { background: #f0fff4; color: #1e8449; border-color: #abebc6; }
    .pill.alg { background: #fdf2f8; color: #7d3c98; border-color: #e8daef; }
    .pill.type { background: #fef9e7; color: #7e5109; border-color: #fad7a0; }
    .event-explanation { font-size: 0.83rem; color: #555; margin: 0.45rem 0; font-style: italic; line-height: 1.55; padding-left: 0.5rem; border-left: 2px solid #d6eaf8; }
    .claims-block { margin-top: 0.6rem; padding: 0.6rem 0.85rem; background: #fff; border-radius: 5px; border: 1px solid #e8edf3; }
    .claims-title { font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #888; margin-bottom: 0.35rem; }
    .claim-row { display: flex; gap: 0.5rem; font-size: 0.8rem; padding: 0.1rem 0; border-bottom: 1px solid #f5f5f5; }
    .claim-row:last-child { border-bottom: none; }
    .claim-key { color: #2471a3; font-weight: 600; min-width: 120px; flex-shrink: 0; }
    .claim-val { color: #444; font-family: "Monaco", "Menlo", monospace; font-size: 0.77rem; word-break: break-all; }
    .mcp-list { margin: 0.5rem 0 1rem; }
    .mcp-item { background: #f9fbfd; padding: 0.9rem 1.1rem; margin-bottom: 0.65rem; border-radius: 6px; border-left: 4px solid #8e44ad; }
    .mcp-item.failed { border-left-color: #e74c3c; background: #fdf8f8; }
    .mcp-header { display: flex; align-items: baseline; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.35rem; }
    .mcp-index { font-size: 0.75rem; color: #888; font-weight: 600; }
    .mcp-label { font-weight: 600; color: #6c3483; font-size: 0.95rem; font-family: "Monaco", "Menlo", monospace; flex: 1; }
    .mcp-result { font-size: 0.83rem; color: #555; margin-top: 0.35rem; font-style: italic; }
    .json-block { margin-top: 0.55rem; border: 1px solid #e0e8f0; border-radius: 5px; overflow: hidden; }
    .json-block summary { padding: 0.35rem 0.75rem; background: #f0f4f8; font-size: 0.78rem; font-weight: 600; color: #2471a3; cursor: pointer; user-select: none; }
    .json-block summary:hover { background: #dce8f5; }
    .json-pre { margin: 0; padding: 0.75rem 1rem; background: #1e2a35; color: #a8d8ea; font-size: 0.78rem; line-height: 1.5; overflow-x: auto; }
    .exchange-steps { margin-top: 0.6rem; padding: 0.6rem 0.85rem; background: #fff; border-radius: 5px; border: 1px solid #e8edf3; }
    .exchange-step { display: flex; gap: 0.6rem; padding: 0.2rem 0; font-size: 0.8rem; border-bottom: 1px solid #f5f5f5; }
    .exchange-step:last-child { border-bottom: none; }
    .exchange-step-num { background: #eaf2fb; color: #2471a3; border-radius: 999px; width: 1.4rem; height: 1.4rem; display: flex; align-items: center; justify-content: center; font-size: 0.7rem; font-weight: 700; flex-shrink: 0; margin-top: 0.1rem; }
    .exchange-step-body { color: #444; line-height: 1.5; }
    .empty-section { background: #f8f9fa; border: 1px dashed #ced4da; border-radius: 6px; padding: 1rem 1.25rem; color: #777; font-size: 0.85rem; font-style: italic; margin: 0.5rem 0 1rem; }
    .meta-table { width: 100%; border-collapse: collapse; font-size: 0.875rem; margin: 0.75rem 0 1.5rem; }
    .meta-table tr:nth-child(even) { background: #f8f9fa; }
    .meta-table td { padding: 0.45rem 0.75rem; border: 1px solid #e9ecef; }
    .meta-table td:first-child { font-weight: 600; color: #1a5276; width: 160px; }
    .report-footer { background: #f4f8fb; border-top: 1px solid #d6eaf8; padding: 1rem 2.5rem; display: flex; justify-content: space-between; align-items: center; font-size: 0.78rem; color: #888; }
    .download-btn { background: #277ba5; color: white; padding: 0.55rem 1.2rem; border: none; border-radius: 5px; cursor: pointer; font-size: 0.85rem; font-weight: 600; }
    .download-btn:hover { background: #1a5276; }
    @media print {
      body { background: white; padding: 0; }
      .container { box-shadow: none; border-radius: 0; }
      .report-footer { display: none; }
    }
  </style>
</head>
<body>
  <div class="container">

    <div class="report-banner">
      <h1>Agent Run Report</h1>
      <div class="subtitle">OAuth Token Chain &amp; MCP Delegation Audit &nbsp;·&nbsp; ${verticalLabel.charAt(0).toUpperCase() + verticalLabel.slice(1)} Vertical</div>
      <div class="run-id">Run ID: ${run.runId} &nbsp;·&nbsp; ${date}</div>
    </div>

    <div class="content">

      <h2>Summary</h2>
      <div class="section-desc">High-level outcome of this agent run, including the detected intent and how it was fulfilled.</div>
      <div class="summary-grid">
        <div class="summary-cell ${run.success ? 'success' : 'failed'}">
          <strong>Status</strong>
          ${run.success ? '&#x2705; Success' : '&#x274C; Failed'}
        </div>
        <div class="summary-cell">
          <strong>Intent</strong>
          ${(run.intent || 'unknown').replace(/_/g, ' ')}
        </div>
        <div class="summary-cell">
          <strong>Tools Called</strong>
          ${toolsList}
        </div>
        <div class="summary-cell">
          <strong>Agent Path</strong>
          ${run.agentPath || 'unknown'}
        </div>
        <div class="summary-cell">
          <strong>Confidence</strong>
          ${(run.confidence || 0).toFixed(2)}
        </div>
        <div class="summary-cell">
          <strong>Token Events</strong>
          ${run.tokenCount || run.tokenEvents?.length || 0}
        </div>
        <div class="summary-cell">
          <strong>MCP Tool Calls</strong>
          ${mcpChain.length}
        </div>
        <div class="summary-cell">
          <strong>Vertical</strong>
          ${verticalLabel}
        </div>
      </div>

      <h2>Prompt</h2>
      <div class="section-desc">The original natural-language prompt submitted by the user.</div>
      <pre><code>${sanitizedPrompt}</code></pre>
`;

  // Token chain section
  if (run.tokenEvents && run.tokenEvents.length > 0) {
    html += `
      <h2>OAuth Token Chain (${run.tokenEvents.length} events)</h2>
      <div class="section-desc">
        Each step represents a token lifecycle event in the authorization pipeline: user authentication
        (RFC 6749), token introspection (RFC 7662), token exchange (RFC 8693), and intent binding
        (draft-ietf-oauth-intent-token). The <em>act</em> and <em>may_act</em> claims establish the
        delegation chain binding the user's identity to agent-initiated actions.
      </div>
      <div class="event-list">
`;
    for (let i = 0; i < run.tokenEvents.length; i++) {
      const evt = run.tokenEvents[i];
      const ok = isEventSuccess(evt);
      const icon = ok ? '&#x2705;' : (evt.status === 'skipped' ? '&#x26A0;&#xFE0F;' : '&#x274C;');
      const badgeClass = ok ? 'badge-success' : (evt.status === 'skipped' ? 'badge-skipped' : 'badge-failed');
      const timestamp = new Date(evt.timestamp).toLocaleTimeString();
      const itemClass = ok ? '' : (evt.status === 'skipped' ? ' skipped' : ' failed');
      const safeLabel = (evt.label || evt.id || 'Event').replace(/</g, '&lt;').replace(/>/g, '&gt;');

      html += `        <div class="event-item${itemClass}">
          <div class="event-header">
            <span class="event-index">#${i + 1}</span>
            <span class="event-label">${icon} ${safeLabel}</span>
          </div>
          <div class="event-pills">
            <span class="badge ${badgeClass}">${evt.status}</span>
            <span class="pill">${timestamp}</span>`;
      if (evt.eventType) html += `\n            <span class="pill type">type: ${evt.eventType}</span>`;
      if (evt.alg) html += `\n            <span class="pill alg">alg: ${evt.alg}</span>`;
      if (evt.clientAuthMethod) html += `\n            <span class="pill auth">client auth: ${String(evt.clientAuthMethod).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>`;
      if (evt.rfc) html += `\n            <span class="pill rfc">${evt.rfc.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>`;
      html += `\n          </div>`;

      if (evt.explanation) {
        html += `\n          <div class="event-explanation">${evt.explanation.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`;
      }

      if (evt.claims && typeof evt.claims === 'object') {
        const pairs = INTERESTING_CLAIMS
          .filter(k => evt.claims[k] != null)
          .map(k => {
            const v = typeof evt.claims[k] === 'object'
              ? JSON.stringify(evt.claims[k])
              : String(evt.claims[k]);
            return `<div class="claim-row"><span class="claim-key">${k}</span><span class="claim-val">${v.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span></div>`;
          });
        if (pairs.length > 0) {
          html += `\n          <div class="claims-block"><div class="claims-title">Token Claims</div>${pairs.join('')}</div>`;
        }
      }

      // Delegation chain (RFC 8693 act); depth >= 2 marks an A2A specialist delegation.
      const htmlDel = delegationChain(evt.claims);
      if (htmlDel) {
        const a2aTag = htmlDel.depth >= 2 ? ` <span class="pill alg">A2A · depth ${htmlDel.depth}</span>` : '';
        html += `\n          <div class="claims-block"><div class="claims-title">Delegation chain</div><div class="claim-row"><span class="claim-val">${htmlDel.chain.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</span>${a2aTag}</div></div>`;
      }

      // Auth event fields (tokenChainService trackTokenEvent shape — present alongside buildTokenEvent shape)
      if (evt.tokenType || evt.tokenSub || evt.audience || evt.issuer || evt.expiry) {
        const authPairs = [];
        if (evt.tokenType) authPairs.push(`<div class="claim-row"><span class="claim-key">tokenType</span><span class="claim-val">${evt.tokenType}</span></div>`);
        if (evt.tokenSub) authPairs.push(`<div class="claim-row"><span class="claim-key">subject</span><span class="claim-val">${evt.tokenSub}</span></div>`);
        if (evt.audience) authPairs.push(`<div class="claim-row"><span class="claim-key">audience</span><span class="claim-val">${Array.isArray(evt.audience) ? evt.audience.join(', ') : evt.audience}</span></div>`);
        if (evt.issuer) authPairs.push(`<div class="claim-row"><span class="claim-key">issuer</span><span class="claim-val">${evt.issuer}</span></div>`);
        if (evt.expiry) authPairs.push(`<div class="claim-row"><span class="claim-key">expiry</span><span class="claim-val">${new Date(evt.expiry).toLocaleString()}</span></div>`);
        html += `\n          <div class="claims-block"><div class="claims-title">Authorization Detail</div>${authPairs.join('')}</div>`;
      }

      // Exchange steps (RFC 8693 multi-leg token exchange)
      if (evt.exchangeSteps && evt.exchangeSteps.length > 0) {
        html += `\n          <div class="exchange-steps"><div class="claims-title">Exchange Steps</div>`;
        evt.exchangeSteps.forEach(function(step, si) {
          const stepTime = step.timestamp ? new Date(step.timestamp).toLocaleTimeString() : '';
          html += `<div class="exchange-step"><span class="exchange-step-num">${si + 1}</span><span class="exchange-step-body"><strong>${(step.step || '').replace(/</g, '&lt;')}</strong>${step.description ? ' — ' + step.description.replace(/</g, '&lt;') : ''}${stepTime ? ' <em>' + stepTime + '</em>' : ''}</span></div>`;
        });
        html += `</div>`;
      }

      html += `\n        </div>\n`;
    }
    html += `      </div>\n`;
  } else {
    html += `
      <h2>OAuth Token Chain</h2>
      <div class="section-desc">Token lifecycle events from the authorization pipeline.</div>
      <div class="empty-section">
        No token events were recorded for this run. NL-routed runs that resolve via heuristics only
        do not invoke the full agent pipeline and produce no token events.
      </div>
`;
  }

  // MCP delegation trail section
  if (mcpChain.length > 0) {
    html += `
      <h2>MCP Delegation Trail (${mcpChain.length} tool calls)</h2>
      <div class="section-desc">
        Model Context Protocol (MCP) tool invocations made by the agent during this session.
        Each call was authorized via the token exchange chain above. Delegated calls carry an
        actor token (<code>act</code> claim) binding the agent's identity (RFC 8693 &sect;4.4).
      </div>
      <div class="mcp-list">
`;
    for (let i = 0; i < mcpChain.length; i++) {
      const call = mcpChain[i];
      const ok = call.status === 'success';
      const icon = ok ? '&#x2705;' : '&#x274C;';
      const badgeClass = ok ? 'badge-success' : 'badge-failed';
      const timestamp = call.timestamp ? new Date(call.timestamp).toLocaleTimeString() : '';
      const toolLabel = (call.toolName || 'unknown').replace(/</g, '&lt;').replace(/>/g, '&gt;');

      html += `        <div class="mcp-item${ok ? '' : ' failed'}">
          <div class="mcp-header">
            <span class="mcp-index">#${i + 1}</span>
            <span class="mcp-label">${icon} ${toolLabel}</span>
          </div>
          <div class="event-pills">
            <span class="badge ${badgeClass}">${call.status}</span>`;
      if (timestamp) html += `\n            <span class="pill">${timestamp}</span>`;
      if (call.duration) html += `\n            <span class="pill">${call.duration}ms</span>`;
      if (call.isDelegated) html += `\n            <span class="pill alg">delegated</span>`;
      if (call.chainIndex != null) html += `\n            <span class="pill">step ${call.chainIndex}</span>`;
      if (call.scopes && call.scopes.length) {
        const scopeStr = (Array.isArray(call.scopes) ? call.scopes.join(' ') : call.scopes).replace(/</g, '&lt;');
        html += `\n            <span class="pill rfc">scopes: ${scopeStr}</span>`;
      }
      html += `\n          </div>`;
      if (call.resultSummary) {
        html += `\n          <div class="mcp-result">${call.resultSummary.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`;
      }
      if (call.requestJson) {
        html += `\n          <details class="json-block"><summary>Request</summary><pre class="json-pre">${JSON.stringify(call.requestJson, null, 2).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre></details>`;
      }
      if (call.resultJson) {
        html += `\n          <details class="json-block"><summary>Response</summary><pre class="json-pre">${JSON.stringify(call.resultJson, null, 2).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre></details>`;
      }
      html += `\n        </div>\n`;
    }
    html += `      </div>\n`;
  } else {
    html += `
      <h2>MCP Delegation Trail</h2>
      <div class="section-desc">MCP tool invocations made by the agent during this session.</div>
      <div class="empty-section">
        No MCP tool call events found for this session. Tool calls are recorded by the MCP audit
        server and matched to the current user session.
      </div>
`;
  }

  html += `
      <h2>Metadata</h2>
      <div class="section-desc">Run timing and identity information.</div>
      <table class="meta-table">
        <tr><td>Started</td><td>${run.startedAt}</td></tr>
        <tr><td>Completed</td><td>${run.completedAt}</td></tr>`;
  if (run.savedAt) html += `\n        <tr><td>Saved</td><td>${run.savedAt}</td></tr>`;
  if (run.userId) html += `\n        <tr><td>User ID</td><td><code>${run.userId}</code></td></tr>`;
  html += `
      </table>

    </div><!-- .content -->

    <div class="report-footer">
      <span>AI Demo Authorization Audit System</span>
      <button class="download-btn" onclick="window.print()">Print / Save as PDF</button>
    </div>

  </div><!-- .container -->
</body>
</html>`;

  return html;
}

// ─── PDF ────────────────────────────────────────────────────────────────────

// Pure-JS PDF via pdfkit — no headless browser, so it works in the slim
// container image (Chromium isn't installed). Mirrors the Markdown report's
// sections. No emojis: the built-in PDF fonts have no emoji glyphs.
function formatPdf(run) {
  let PDFDocument;
  try {
    PDFDocument = require('pdfkit');
  } catch (_) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const ACCENT = '#277ba5';
      const DARK = '#1a5276';
      const W = 495; // content width inside A4 margins
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', () => resolve(null));

      const date = new Date(run.startedAt).toLocaleString();
      const toolsList = (run.toolsCalled || []).join(', ') || '(none)';
      const verticalLabel = run.vertical || 'banking';
      const mcpChain = run.mcpToolCallsChain || [];

      const heading = (t, size = 14) => {
        doc.moveDown(0.7).fillColor(ACCENT).font('Helvetica-Bold').fontSize(size).text(t);
        doc.moveDown(0.2).fillColor('#333').font('Helvetica').fontSize(10);
      };
      const subheading = (t) => {
        doc.font('Helvetica-Bold').fontSize(11).fillColor(DARK).text(t);
        doc.font('Helvetica').fontSize(10).fillColor('#333');
      };

      // Header
      doc.fillColor(DARK).font('Helvetica-Bold').fontSize(22).text('Agent Run Report');
      doc.moveDown(0.2).fillColor(ACCENT).font('Helvetica').fontSize(10)
        .text('OAuth Token Chain & MCP Delegation Audit');
      doc.moveDown(0.5).fillColor('#333').fontSize(10);
      doc.text(`Vertical: ${verticalLabel}`);
      doc.text(`Date: ${date}`);
      doc.text(`Run ID: ${run.runId}`);

      // Summary
      heading('Summary');
      doc.text(`Status: ${run.success ? 'Success' : 'Failed'}`);
      doc.text(`Intent: ${run.intent || 'unknown'}`);
      doc.text(`Tools Called: ${toolsList}`);
      doc.text(`Agent Path: ${run.agentPath || 'unknown'}`);
      doc.text(`Confidence: ${(run.confidence || 0).toFixed(2)}`);
      doc.text(`Token Events: ${run.tokenCount || run.tokenEvents?.length || 0}`);
      doc.text(`MCP Tool Calls: ${mcpChain.length}`);

      // Prompt
      heading('Prompt');
      doc.font('Courier').fontSize(9).text(run.prompt || '(none)', { width: W });
      doc.font('Helvetica').fontSize(10);

      // Token chain
      if (run.tokenEvents && run.tokenEvents.length > 0) {
        heading(`OAuth Token Chain (${run.tokenEvents.length} events)`);
        run.tokenEvents.forEach((evt, i) => {
          doc.moveDown(0.3);
          subheading(`${i + 1}. ${evt.label || evt.id || 'Event'}`);
          const okLabel = isEventSuccess(evt) ? 'OK' : 'FAIL';
          const time = evt.timestamp ? new Date(evt.timestamp).toLocaleTimeString() : '';
          let statusStr = `Status: ${okLabel} (${evt.status})`;
          if (evt.eventType) statusStr += `  |  Type: ${evt.eventType}`;
          if (evt.alg) statusStr += `  |  Alg: ${evt.alg}`;
          if (evt.clientAuthMethod) statusStr += `  |  Client Auth: ${evt.clientAuthMethod}`;
          doc.text(statusStr, { width: W });
          if (time) doc.text(`Time: ${time}`);
          if (evt.rfc) doc.text(`RFC: ${evt.rfc}`);
          if (evt.tokenType) doc.text(`Token Type: ${evt.tokenType}`);
          if (evt.tokenSub) doc.text(`Subject: ${evt.tokenSub}`);
          if (evt.audience) doc.text(`Audience: ${Array.isArray(evt.audience) ? evt.audience.join(', ') : evt.audience}`);
          if (evt.issuer) doc.text(`Issuer: ${evt.issuer}`);
          if (evt.expiry) doc.text(`Expiry: ${new Date(evt.expiry).toLocaleString()}`);
          if (evt.explanation) doc.text(`Notes: ${evt.explanation}`, { width: W });
          if (evt.exchangeSteps && evt.exchangeSteps.length > 0) {
            doc.text('Exchange Steps:', { width: W });
            evt.exchangeSteps.forEach(function(step, si) {
              doc.text(`  ${si + 1}. ${step.step || ''}: ${step.description || ''}`, { width: W });
            });
          }
          const claims = evt.claims;
          if (claims && typeof claims === 'object') {
            for (const k of INTERESTING_CLAIMS) {
              if (claims[k] == null) continue;
              const v = typeof claims[k] === 'object' ? JSON.stringify(claims[k]) : String(claims[k]);
              doc.text(`  ${k}: ${v}`, { width: W });
            }
          }
        });
      }

      // MCP tool calls
      if (mcpChain.length > 0) {
        heading(`MCP Delegation Trail (${mcpChain.length} tool calls)`);
        mcpChain.forEach((call, i) => {
          doc.moveDown(0.3);
          subheading(`${i + 1}. ${call.toolName || 'unknown'}`);
          const okLabel = call.status === 'success' ? 'OK' : 'FAIL';
          const time = call.timestamp ? new Date(call.timestamp).toLocaleTimeString() : '';
          let statusStr = `Status: ${okLabel} (${call.status})`;
          if (call.duration) statusStr += `  |  ${call.duration}ms`;
          if (call.isDelegated) statusStr += `  |  Delegated`;
          if (call.chainIndex != null) statusStr += `  |  Step: ${call.chainIndex}`;
          doc.text(statusStr, { width: W });
          if (time) doc.text(`Time: ${time}`);
          if (call.scopes && call.scopes.length) {
            doc.text(`Scopes: ${Array.isArray(call.scopes) ? call.scopes.join(' ') : call.scopes}`, { width: W });
          }
          if (call.resultSummary) doc.text(`Result: ${call.resultSummary}`, { width: W });
          if (call.requestJson) doc.font('Courier').fontSize(8).text('Request: ' + JSON.stringify(call.requestJson), { width: W }).font('Helvetica').fontSize(10);
          if (call.resultJson) doc.font('Courier').fontSize(8).text('Response: ' + JSON.stringify(call.resultJson), { width: W }).font('Helvetica').fontSize(10);
        });
      }

      // Metadata
      heading('Metadata');
      doc.text(`Started: ${run.startedAt}`);
      doc.text(`Completed: ${run.completedAt}`);
      if (run.savedAt) doc.text(`Saved: ${run.savedAt}`);
      if (run.userId) doc.text(`User ID: ${run.userId}`);

      doc.end();
    } catch (_) {
      resolve(null);
    }
  });
}

module.exports = { formatMarkdown, formatHtml, formatPdf };
