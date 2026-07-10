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
      const icon = isEventSuccess(evt) ? '✅' : (evt.status === 'skipped' ? '⚠️' : (evt.status ? '❌' : '➖'));
      const time = new Date(evt.timestamp).toLocaleTimeString();

      md += `### ${i + 1}. ${evt.label || evt.id || 'Event'}\n\n`;
      let statusLine = '**Status:** ' + icon + ' `' + (evt.status || 'unknown') + '`';
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
    .report-nav { padding: 0.85rem 2.5rem 0; }
    .back-btn { display: inline-block; background: #eaf2fb; color: #1a5276; text-decoration: none; padding: 0.45rem 1rem; border-radius: 5px; font-size: 0.85rem; font-weight: 600; border: 1px solid #d6eaf8; }
    .back-btn:hover { background: #d6eaf8; }
    @media print {
      body { background: white; padding: 0; }
      .container { box-shadow: none; border-radius: 0; }
      .report-footer { display: none; }
      .report-nav { display: none; }
    }
  </style>
</head>
<body>
  <div class="container">

    <div class="report-nav">
      <a class="back-btn" href="/reports">&larr; Back to Reports</a>
    </div>

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
      // An event with no status is "unknown", not a failure — render it neutrally
      // instead of a red ❌ / "UNDEFINED" badge.
      const unknownStatus = !evt.status;
      const statusLabel = evt.status || 'unknown';
      const icon = ok ? '&#x2705;' : (evt.status === 'skipped' ? '&#x26A0;&#xFE0F;' : (unknownStatus ? '&#x2013;' : '&#x274C;'));
      const badgeClass = ok ? 'badge-success' : (evt.status === 'skipped' ? 'badge-skipped' : (unknownStatus ? 'badge-neutral' : 'badge-failed'));
      const timestamp = new Date(evt.timestamp).toLocaleTimeString();
      const itemClass = ok ? '' : (evt.status === 'skipped' ? ' skipped' : (unknownStatus ? '' : ' failed'));
      const safeLabel = (evt.label || evt.id || 'Event').replace(/</g, '&lt;').replace(/>/g, '&gt;');

      html += `        <div class="event-item${itemClass}">
          <div class="event-header">
            <span class="event-index">#${i + 1}</span>
            <span class="event-label">${icon} ${safeLabel}</span>
          </div>
          <div class="event-pills">
            <span class="badge ${badgeClass}">${statusLabel}</span>
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
// container image (Chromium isn't installed). Card-based layout mirroring the
// HTML report: colored header band, demo-highlights callout, summary grid,
// status-colored event cards, claim tables, and token-diff coloring across
// RFC 8693 exchange legs. No emojis: the built-in PDF fonts have no emoji
// glyphs (arrows/dashes limited to WinAnsi: use "->" not "→").

var PDF_COLORS = {
  dark: '#1a5276',
  accent: '#277ba5',
  green: '#27ae60',
  red: '#e74c3c',
  amber: '#f0b429',
  purple: '#8e44ad',
  gray: '#95a5a6',
  text: '#333333',
  mute: '#666666',
  cardBg: '#f4f8fb',
  rowAlt: '#eef3f8',
  codeBg: '#1e2a35',
  codeFg: '#a8d8ea',
};

// Pill tints (bg + fg) matching the HTML report's badge/pill palette.
var PDF_PILL = {
  green: { bg: '#d5f5e3', fg: '#1e8449' },
  red: { bg: '#fde8e8', fg: '#c0392b' },
  amber: { bg: '#fef9e7', fg: '#9a7d0a' },
  gray: { bg: '#eaecee', fg: '#555555' },
  blue: { bg: '#eaf2fb', fg: '#2471a3' },
  purple: { bg: '#fdf2f8', fg: '#7d3c98' },
};

var PDF_TONE_COLOR = {
  green: PDF_COLORS.green,
  amber: PDF_COLORS.amber,
  red: PDF_COLORS.red,
  gray: PDF_COLORS.gray,
};

// Status → color tone. 'skipped' and in-flight statuses read amber even though
// isEventSuccess treats 'skipped' as non-failure; absent status is neutral gray.
function eventTone(evt) {
  const s = evt.status;
  if (!s) return 'gray';
  if (['skipped', 'warning', 'degraded', 'waiting', 'pending', 'acquiring', 'indeterminate'].includes(s)) return 'amber';
  if (isEventSuccess(evt)) return 'green';
  return 'red';
}

function parseScopes(claims) {
  if (!claims || claims.scope == null) return null;
  if (Array.isArray(claims.scope)) return claims.scope.map(String);
  return String(claims.scope).split(/\s+/).filter(Boolean);
}

/**
 * Diff two claim sets across a token-chain step (RFC 8693 least-privilege).
 * Returns { scopesRemoved[], scopesAdded[], claimsAdded[], audienceChanged }
 * or null when there is nothing to compare / nothing changed. iat/exp/jti are
 * volatile per-mint claims and never counted as "added".
 */
function computeClaimDiff(prevClaims, claims) {
  if (!prevClaims || !claims || typeof prevClaims !== 'object' || typeof claims !== 'object') return null;
  const prevScopes = parseScopes(prevClaims) || [];
  const curScopes = parseScopes(claims) || [];
  const scopesRemoved = prevScopes.filter((s) => !curScopes.includes(s));
  const scopesAdded = curScopes.filter((s) => !prevScopes.includes(s));
  const VOLATILE = ['iat', 'exp', 'jti', 'scope', 'aud'];
  const claimsAdded = INTERESTING_CLAIMS.filter(
    (k) => !VOLATILE.includes(k) && claims[k] != null && prevClaims[k] == null
  );
  const audStr = (c) => (Array.isArray(c.aud) ? c.aud.join(', ') : (c.aud != null ? String(c.aud) : null));
  const prevAud = audStr(prevClaims);
  const curAud = audStr(claims);
  const audienceChanged = prevAud && curAud && prevAud !== curAud ? { from: prevAud, to: curAud } : null;
  if (!scopesRemoved.length && !scopesAdded.length && !claimsAdded.length && !audienceChanged) return null;
  return { scopesRemoved, scopesAdded, claimsAdded, audienceChanged };
}

/**
 * First-to-last scope count across the chain's claim-bearing events.
 * Returns { from, to } only when the scope set actually shrank.
 */
function scopeNarrowing(tokenEvents) {
  const counts = (tokenEvents || [])
    .map((e) => parseScopes(e.claims))
    .filter((s) => s && s.length)
    .map((s) => s.length);
  if (counts.length < 2) return null;
  const from = counts[0];
  const to = counts[counts.length - 1];
  return to < from ? { from, to } : null;
}

// ── pdfkit layout helpers ──
// Blocks are { h, draw(x, y) } closures: measured up front so cards can be
// placed whole (no mid-card page splits). All measurement must set font/size
// before heightOfString/widthOfString — pdfkit measures with the current font.

function pdfContentWidth(doc) {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

function ensureSpace(doc, needed) {
  if (doc.y + needed > doc.page.height - doc.page.margins.bottom) doc.addPage();
}

function textBlock(doc, w, str, opts = {}) {
  const font = opts.font || 'Helvetica';
  const size = opts.size || 9;
  doc.font(font).fontSize(size);
  const h = doc.heightOfString(str, { width: w });
  return {
    h: h + (opts.gapAfter != null ? opts.gapAfter : 4),
    draw(x, y) {
      doc.font(font).fontSize(size).fillColor(opts.color || PDF_COLORS.text)
        .text(str, x, y, { width: w });
    },
  };
}

function cardHeaderBlock(doc, w, num, label, color, labelFont = 'Helvetica-Bold') {
  doc.font(labelFont).fontSize(10.5);
  const lh = doc.heightOfString(label, { width: w - 24 });
  const h = Math.max(lh, 16);
  return {
    h: h + 5,
    draw(x, y) {
      doc.circle(x + 8, y + 8, 8).fill(color);
      doc.font('Helvetica-Bold').fontSize(8).fillColor('white')
        .text(String(num), x, y + 4.5, { width: 16, align: 'center' });
      doc.font(labelFont).fontSize(10.5).fillColor(PDF_COLORS.dark)
        .text(label, x + 22, y + 2, { width: w - 24 });
    },
  };
}

function pillRowBlock(doc, w, pills) {
  doc.font('Helvetica-Bold').fontSize(7);
  const pillH = 12;
  const gap = 4;
  const placed = [];
  let cx = 0;
  let cy = 0;
  for (const p of pills) {
    const pw = Math.min(doc.widthOfString(p.text) + 10, w);
    if (cx + pw > w && cx > 0) { cx = 0; cy += pillH + 3; }
    placed.push({ text: p.text, bg: p.bg, fg: p.fg, x: cx, y: cy, w: pw });
    cx += pw + gap;
  }
  return {
    h: cy + pillH + 5,
    draw(x, y) {
      for (const p of placed) {
        doc.roundedRect(x + p.x, y + p.y, p.w, pillH, 6).fill(p.bg);
        doc.font('Helvetica-Bold').fontSize(7).fillColor(p.fg)
          .text(p.text, x + p.x + 5, y + p.y + 3.5, { width: p.w - 10, lineBreak: false });
      }
    },
  };
}

function kvTableBlock(doc, w, title, pairs) {
  const keyW = 110;
  const valW = w - keyW - 8;
  const rows = pairs.map(([k, v]) => {
    doc.font('Courier').fontSize(7.5);
    const vh = doc.heightOfString(String(v), { width: valW });
    return { k: String(k), v: String(v), h: Math.max(vh, 9) + 5 };
  });
  const titleH = title ? 11 : 0;
  const h = titleH + rows.reduce((s, r) => s + r.h, 0);
  return {
    h: h + 4,
    draw(x, y) {
      let cy = y;
      if (title) {
        doc.font('Helvetica-Bold').fontSize(6.5).fillColor('#888888')
          .text(title.toUpperCase(), x, cy, { characterSpacing: 0.5, lineBreak: false });
        cy += titleH;
      }
      rows.forEach((r, i) => {
        if (i % 2 === 1) doc.rect(x, cy - 1.5, w, r.h).fill(PDF_COLORS.rowAlt);
        doc.font('Helvetica-Bold').fontSize(8).fillColor(PDF_COLORS.accent)
          .text(r.k, x + 4, cy + 1, { width: keyW - 8, lineBreak: false });
        doc.font('Courier').fontSize(7.5).fillColor('#444444')
          .text(r.v, x + keyW, cy + 1.5, { width: valW });
        cy += r.h;
      });
    },
  };
}

function diffBlock(doc, w, diff) {
  const lines = [];
  for (const s of diff.scopesRemoved) lines.push({ text: '-  scope removed: ' + s, color: PDF_COLORS.red });
  for (const s of diff.scopesAdded) lines.push({ text: '+  scope added: ' + s, color: PDF_COLORS.green });
  for (const k of diff.claimsAdded) {
    lines.push({
      text: '+  claim added: ' + k + (k === 'act' ? ' (delegated actor identity)' : ''),
      color: PDF_COLORS.green,
    });
  }
  if (diff.audienceChanged) {
    lines.push({
      text: '~  audience: ' + diff.audienceChanged.from + ' -> ' + diff.audienceChanged.to,
      color: '#b7791f',
    });
  }
  doc.font('Courier-Bold').fontSize(7.5);
  const measured = lines.map((l) => ({
    text: l.text,
    color: l.color,
    h: Math.max(doc.heightOfString(l.text, { width: w - 20 }), 9) + 2.5,
  }));
  const titleH = 11;
  const boxH = 7 + titleH + measured.reduce((s, m) => s + m.h, 0) + 6;
  return {
    h: boxH + 6,
    draw(x, y) {
      doc.roundedRect(x, y, w, boxH, 4).fillAndStroke('#fffdf5', '#f0e6c8');
      doc.font('Helvetica-Bold').fontSize(6.5).fillColor('#8a6d1a')
        .text('CHANGES FROM PREVIOUS TOKEN (RFC 8693 LEAST-PRIVILEGE)', x + 10, y + 7, { characterSpacing: 0.5, lineBreak: false });
      let cy = y + 7 + titleH;
      for (const m of measured) {
        doc.font('Courier-Bold').fontSize(7.5).fillColor(m.color)
          .text(m.text, x + 10, cy, { width: w - 20 });
        cy += m.h;
      }
    },
  };
}

function stepsBlock(doc, w, steps) {
  doc.font('Helvetica').fontSize(8);
  const measured = steps.map((s, i) => {
    const text = (s.step || 'step ' + (i + 1))
      + (s.description ? ' — ' + s.description : '')
      + (s.timestamp ? '   (' + new Date(s.timestamp).toLocaleTimeString() + ')' : '');
    return { text, h: Math.max(doc.heightOfString(text, { width: w - 22 }), 13) + 3 };
  });
  const titleH = 11;
  const h = titleH + measured.reduce((s2, m) => s2 + m.h, 0);
  return {
    h: h + 4,
    draw(x, y) {
      doc.font('Helvetica-Bold').fontSize(6.5).fillColor('#888888')
        .text('EXCHANGE STEPS', x, y, { characterSpacing: 0.5, lineBreak: false });
      let cy = y + titleH;
      measured.forEach((m, i) => {
        doc.circle(x + 6, cy + 5, 6).fill('#d6eaf8');
        doc.font('Helvetica-Bold').fontSize(7).fillColor('#1a5276')
          .text(String(i + 1), x, cy + 2, { width: 12, align: 'center' });
        doc.font('Helvetica').fontSize(8).fillColor('#444444')
          .text(m.text, x + 18, cy + 1, { width: w - 22 });
        cy += m.h;
      });
    },
  };
}

function codeBlock(doc, w, title, obj) {
  let lines = JSON.stringify(obj, null, 2).split('\n');
  const MAX_LINES = 40;
  if (lines.length > MAX_LINES) {
    const extra = lines.length - MAX_LINES;
    lines = lines.slice(0, MAX_LINES);
    lines.push('... truncated (' + extra + ' more lines)');
  }
  doc.font('Courier').fontSize(7);
  const maxChars = Math.max(20, Math.floor((w - 16) / doc.widthOfString('M')));
  lines = lines.map((l) => (l.length > maxChars ? l.slice(0, maxChars - 3) + '...' : l));
  const lineH = 8.5;
  const boxH = lines.length * lineH + 10;
  return {
    h: 11 + boxH + 5,
    draw(x, y) {
      doc.font('Helvetica-Bold').fontSize(6.5).fillColor(PDF_COLORS.accent)
        .text(title.toUpperCase(), x, y, { characterSpacing: 0.5, lineBreak: false });
      doc.roundedRect(x, y + 10, w, boxH, 4).fill(PDF_COLORS.codeBg);
      doc.font('Courier').fontSize(7).fillColor(PDF_COLORS.codeFg);
      lines.forEach((l, i) => {
        doc.text(l, x + 8, y + 15 + i * lineH, { lineBreak: false });
      });
    },
  };
}

/**
 * Place a measured card: light background, colored left accent bar, blocks
 * stacked inside. Moves to a new page when the whole card fits there; falls
 * back to block-by-block flow (no background) only for cards taller than a
 * full page, so content is never lost.
 */
function drawCard(doc, blocks, accent) {
  const W = pdfContentWidth(doc);
  const x = doc.page.margins.left;
  const padTop = 9;
  const padBottom = 7;
  const innerX = 14;
  const total = blocks.reduce((s, b) => s + b.h, 0) + padTop + padBottom;
  const maxCard = doc.page.height - doc.page.margins.top - doc.page.margins.bottom;
  if (total <= maxCard) {
    ensureSpace(doc, total);
    const y = doc.y;
    doc.roundedRect(x, y, W, total, 5).fill('#f9fbfd');
    doc.roundedRect(x, y, 3.5, total, 2).fill(accent);
    let cy = y + padTop;
    for (const b of blocks) {
      b.draw(x + innerX, cy);
      cy += b.h;
    }
    doc.y = y + total + 8;
  } else {
    for (const b of blocks) {
      ensureSpace(doc, Math.min(b.h, maxCard));
      const cy = doc.y;
      b.draw(x + innerX, cy);
      doc.y = cy + b.h;
    }
    doc.y += 8;
  }
  doc.x = x;
}

function sectionHeading(doc, title, desc) {
  ensureSpace(doc, 64);
  const x = doc.page.margins.left;
  const W = pdfContentWidth(doc);
  doc.y += 8;
  doc.font('Helvetica-Bold').fontSize(13).fillColor(PDF_COLORS.dark)
    .text(title, x, doc.y, { width: W });
  const ruleY = doc.y + 3;
  doc.moveTo(x, ruleY).lineTo(x + W, ruleY).lineWidth(1.5).strokeColor('#d6eaf8').stroke();
  doc.y = ruleY + 6;
  if (desc) {
    doc.font('Helvetica-Oblique').fontSize(8).fillColor(PDF_COLORS.mute)
      .text(desc, x, doc.y, { width: W });
    doc.y += 5;
  }
  doc.x = x;
}

function drawEmptyBox(doc, text) {
  const W = pdfContentWidth(doc);
  const x = doc.page.margins.left;
  doc.font('Helvetica-Oblique').fontSize(8.5);
  const th = doc.heightOfString(text, { width: W - 24 });
  const boxH = th + 16;
  ensureSpace(doc, boxH);
  const y = doc.y;
  doc.dash(3, { space: 3 }).roundedRect(x, y, W, boxH, 4).lineWidth(1).strokeColor('#ced4da').stroke().undash();
  doc.font('Helvetica-Oblique').fontSize(8.5).fillColor('#777777')
    .text(text, x + 12, y + 8, { width: W - 24 });
  doc.y = y + boxH + 10;
  doc.x = x;
}

function formatPdf(run) {
  let PDFDocument;
  try {
    PDFDocument = require('pdfkit');
  } catch (_) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 50, bottom: 60, left: 50, right: 50 },
        bufferPages: true,
      });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', () => resolve(null));

      const W = pdfContentWidth(doc);
      const X = doc.page.margins.left;
      const date = new Date(run.startedAt).toLocaleString();
      const toolsList = (run.toolsCalled || []).join(', ') || '(none)';
      const verticalLabel = run.vertical || 'banking';
      const tokenEvents = run.tokenEvents || [];
      const mcpChain = run.mcpToolCallsChain || [];

      // ── Header band ──
      doc.rect(0, 0, doc.page.width, 114).fill(PDF_COLORS.dark);
      doc.rect(0, 114, doc.page.width, 4).fill(PDF_COLORS.accent);
      doc.font('Helvetica-Bold').fontSize(21).fillColor('white')
        .text('Agent Run Report', X, 24, { lineBreak: false });
      doc.font('Helvetica').fontSize(9).fillColor('#cfe3f0')
        .text('OAuth Token Chain & MCP Delegation Audit', X, 52, { lineBreak: false });
      doc.font('Helvetica').fontSize(8).fillColor('#9fc4da')
        .text(verticalLabel.charAt(0).toUpperCase() + verticalLabel.slice(1) + ' vertical   ·   ' + date, X, 68, { lineBreak: false });
      doc.font('Courier').fontSize(7).fillColor('#8ab4cc')
        .text('Run ID: ' + run.runId, X, 86, { lineBreak: false });
      const pillText = run.success ? 'SUCCESS' : 'FAILED';
      doc.font('Helvetica-Bold').fontSize(9);
      const pillW = doc.widthOfString(pillText) + 20;
      doc.roundedRect(doc.page.width - X - pillW, 28, pillW, 20, 10)
        .fill(run.success ? PDF_COLORS.green : PDF_COLORS.red);
      doc.fillColor('white')
        .text(pillText, doc.page.width - X - pillW + 10, 34, { lineBreak: false });
      doc.x = X;
      doc.y = 134;

      // ── Demo highlights ──
      const exchangeLegs = tokenEvents.filter(
        (e) => e.eventType === 'exchange' || e.status === 'exchanged' || /8693/.test(String(e.rfc || ''))
      ).length;
      let deepestDel = null;
      for (const e of tokenEvents) {
        const d = delegationChain(e.claims);
        if (d && (!deepestDel || d.depth > deepestDel.depth)) deepestDel = d;
      }
      const narrowing = scopeNarrowing(tokenEvents);
      const hadCiba = !!run.hasCibaStepUp || tokenEvents.some((e) => e.grantedVia === 'ciba');

      const highlights = [];
      if (exchangeLegs > 0) {
        highlights.push({
          color: PDF_COLORS.accent,
          label: 'RFC 8693 Token Exchange',
          text: exchangeLegs + ' exchange leg' + (exchangeLegs === 1 ? '' : 's')
            + ' — the user\'s token was exchanged for narrowed, delegated agent tokens.',
        });
      }
      if (deepestDel) {
        highlights.push({
          color: PDF_COLORS.purple,
          label: 'Delegation Chain',
          text: deepestDel.chain.replace(/ → /g, ' -> ')
            + (deepestDel.depth >= 2 ? '  (A2A specialist delegation, depth ' + deepestDel.depth + ')' : ''),
        });
      }
      if (narrowing) {
        highlights.push({
          color: PDF_COLORS.green,
          label: 'Least-Privilege Narrowing',
          text: 'Scopes narrowed ' + narrowing.from + ' -> ' + narrowing.to + ' across the token chain.',
        });
      }
      if (hadCiba) {
        highlights.push({
          color: PDF_COLORS.amber,
          label: 'CIBA / HITL Step-Up',
          text: 'A human approval (CIBA) was required before a sensitive action was authorized.',
        });
      }
      if (highlights.length > 0) {
        doc.font('Helvetica-Bold').fontSize(8);
        const measured = highlights.map((l) => {
          doc.font('Helvetica-Bold').fontSize(8);
          const labelW = doc.widthOfString(l.label + ':  ');
          doc.font('Helvetica').fontSize(8);
          const th = doc.heightOfString(l.text, { width: W - 36 - labelW });
          return { color: l.color, label: l.label, text: l.text, labelW, h: Math.max(th, 10) + 5 };
        });
        const boxH = 8 + 14 + measured.reduce((s, m) => s + m.h, 0) + 4;
        const y = doc.y;
        doc.roundedRect(X, y, W, boxH, 6).fillAndStroke('#fbfdff', '#d6eaf8');
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#888888')
          .text('DEMO HIGHLIGHTS', X + 12, y + 8, { characterSpacing: 0.8, lineBreak: false });
        let cy = y + 22;
        for (const m of measured) {
          doc.rect(X + 12, cy + 1.5, 6, 6).fill(m.color);
          doc.font('Helvetica-Bold').fontSize(8).fillColor(PDF_COLORS.dark)
            .text(m.label + ':', X + 24, cy, { lineBreak: false });
          doc.font('Helvetica').fontSize(8).fillColor('#444444')
            .text(m.text, X + 24 + m.labelW, cy, { width: W - 36 - m.labelW });
          cy += m.h;
        }
        doc.x = X;
        doc.y = y + boxH + 12;
      }

      // ── Summary grid ──
      sectionHeading(doc, 'Summary',
        'High-level outcome of this agent run, including the detected intent and how it was fulfilled.');
      const cells = [
        { label: 'Status', value: run.success ? 'Success' : 'Failed', color: run.success ? PDF_COLORS.green : PDF_COLORS.red },
        { label: 'Intent', value: (run.intent || 'unknown').replace(/_/g, ' ') },
        { label: 'Agent Path', value: run.agentPath || 'unknown' },
        { label: 'Confidence', value: (run.confidence || 0).toFixed(2) },
        { label: 'Tools Called', value: toolsList },
        { label: 'Vertical', value: verticalLabel },
        { label: 'Token Events', value: String(run.tokenCount || tokenEvents.length) },
        { label: 'MCP Tool Calls', value: String(mcpChain.length) },
      ];
      const gap = 8;
      const cellW = (W - gap) / 2;
      for (let i = 0; i < cells.length; i += 2) {
        const row = cells.slice(i, i + 2);
        const heights = row.map((c) => {
          doc.font('Helvetica').fontSize(9);
          return 16 + Math.max(doc.heightOfString(String(c.value), { width: cellW - 22 }), 10) + 7;
        });
        const rowH = Math.max(...heights);
        ensureSpace(doc, rowH + 6);
        const y = doc.y;
        row.forEach((c, j) => {
          const cx = X + j * (cellW + gap);
          doc.roundedRect(cx, y, cellW, rowH, 4).fill(PDF_COLORS.cardBg);
          doc.rect(cx, y, 3, rowH).fill(c.color || PDF_COLORS.accent);
          doc.font('Helvetica-Bold').fontSize(6.5).fillColor(PDF_COLORS.dark)
            .text(c.label.toUpperCase(), cx + 12, y + 6, { characterSpacing: 0.5, lineBreak: false });
          doc.font('Helvetica').fontSize(9).fillColor(PDF_COLORS.text)
            .text(String(c.value), cx + 12, y + 16, { width: cellW - 22 });
        });
        doc.y = y + rowH + 6;
      }
      doc.x = X;
      doc.y += 2;

      // ── Prompt ──
      sectionHeading(doc, 'Prompt', 'The original natural-language prompt submitted by the user.');
      const promptText = run.prompt || '(none)';
      doc.font('Courier').fontSize(8.5);
      const promptH = doc.heightOfString(promptText, { width: W - 24 }) + 16;
      ensureSpace(doc, promptH);
      const py = doc.y;
      doc.roundedRect(X, py, W, promptH, 4).fill('#f0f4f8');
      doc.font('Courier').fontSize(8.5).fillColor(PDF_COLORS.dark)
        .text(promptText, X + 12, py + 8, { width: W - 24 });
      doc.x = X;
      doc.y = py + promptH + 10;

      // ── OAuth token chain ──
      if (tokenEvents.length > 0) {
        sectionHeading(doc, 'OAuth Token Chain (' + tokenEvents.length + ' events)',
          'Each card is a token lifecycle event: user authentication (RFC 6749), introspection (RFC 7662), '
          + 'token exchange (RFC 8693), and intent binding. Colored diff boxes show what changed at each leg.');
        let prevClaims = null;
        tokenEvents.forEach((evt, i) => {
          const tone = eventTone(evt);
          const accent = PDF_TONE_COLOR[tone];
          const innerW = W - 26;
          const blocks = [];
          blocks.push(cardHeaderBlock(doc, innerW, i + 1, evt.label || evt.id || 'Event', accent));

          const pills = [{ text: (evt.status || 'unknown').toUpperCase(), bg: PDF_PILL[tone].bg, fg: PDF_PILL[tone].fg }];
          if (evt.timestamp) pills.push({ text: new Date(evt.timestamp).toLocaleTimeString(), bg: PDF_PILL.blue.bg, fg: PDF_PILL.blue.fg });
          if (evt.eventType) pills.push({ text: 'type: ' + evt.eventType, bg: PDF_PILL.blue.bg, fg: PDF_PILL.blue.fg });
          if (evt.alg) pills.push({ text: 'alg: ' + evt.alg, bg: PDF_PILL.purple.bg, fg: PDF_PILL.purple.fg });
          if (evt.clientAuthMethod) pills.push({ text: 'client auth: ' + evt.clientAuthMethod, bg: PDF_PILL.blue.bg, fg: PDF_PILL.blue.fg });
          if (evt.rfc) pills.push({ text: String(evt.rfc), bg: PDF_PILL.green.bg, fg: PDF_PILL.green.fg });
          if (evt.grantedVia === 'ciba') pills.push({ text: 'CIBA STEP-UP', bg: PDF_PILL.amber.bg, fg: PDF_PILL.amber.fg });
          blocks.push(pillRowBlock(doc, innerW, pills));

          if (evt.explanation) {
            blocks.push(textBlock(doc, innerW, evt.explanation, {
              font: 'Helvetica-Oblique', size: 8, color: '#555555', gapAfter: 6,
            }));
          }

          const authPairs = [];
          if (evt.tokenType) authPairs.push(['tokenType', evt.tokenType]);
          if (evt.tokenSub) authPairs.push(['subject', evt.tokenSub]);
          if (evt.audience) authPairs.push(['audience', Array.isArray(evt.audience) ? evt.audience.join(', ') : evt.audience]);
          if (evt.issuer) authPairs.push(['issuer', evt.issuer]);
          if (evt.expiry) authPairs.push(['expiry', new Date(evt.expiry).toLocaleString()]);
          if (authPairs.length) blocks.push(kvTableBlock(doc, innerW, 'Authorization detail', authPairs));

          const claimPairs = (evt.claims && typeof evt.claims === 'object')
            ? INTERESTING_CLAIMS.filter((k) => evt.claims[k] != null)
              .map((k) => [k, typeof evt.claims[k] === 'object' ? JSON.stringify(evt.claims[k]) : String(evt.claims[k])])
            : [];
          if (claimPairs.length) blocks.push(kvTableBlock(doc, innerW, 'Token claims', claimPairs));

          const del = delegationChain(evt.claims);
          if (del) {
            blocks.push(textBlock(doc, innerW,
              'Delegation: ' + del.chain.replace(/ → /g, ' -> ')
              + (del.depth >= 2 ? '   ·   A2A specialist delegation (depth ' + del.depth + ')' : ''),
              { font: 'Helvetica-Bold', size: 8, color: PDF_COLORS.purple, gapAfter: 6 }));
          }

          if (evt.claims && typeof evt.claims === 'object') {
            const diff = computeClaimDiff(prevClaims, evt.claims);
            if (diff) blocks.push(diffBlock(doc, innerW, diff));
            prevClaims = evt.claims;
          }

          if (evt.exchangeSteps && evt.exchangeSteps.length > 0) {
            blocks.push(stepsBlock(doc, innerW, evt.exchangeSteps));
          }

          drawCard(doc, blocks, accent);
        });
      } else {
        sectionHeading(doc, 'OAuth Token Chain', 'Token lifecycle events from the authorization pipeline.');
        drawEmptyBox(doc, 'No token events were recorded for this run. NL-routed runs that resolve via '
          + 'heuristics only do not invoke the full agent pipeline and produce no token events.');
      }

      // ── MCP delegation trail ──
      if (mcpChain.length > 0) {
        sectionHeading(doc, 'MCP Delegation Trail (' + mcpChain.length + ' tool calls)',
          'Model Context Protocol tool invocations made by the agent. Each call was authorized via the '
          + 'token exchange chain above; delegated calls carry an actor token (act claim, RFC 8693 §4.4).');
        mcpChain.forEach((call, i) => {
          const ok = call.status === 'success';
          const accent = ok ? PDF_COLORS.purple : PDF_COLORS.red;
          const tone = ok ? 'green' : 'red';
          const innerW = W - 26;
          const blocks = [];
          blocks.push(cardHeaderBlock(doc, innerW, i + 1, call.toolName || 'unknown', accent, 'Courier-Bold'));

          const pills = [{ text: String(call.status || 'unknown').toUpperCase(), bg: PDF_PILL[tone].bg, fg: PDF_PILL[tone].fg }];
          if (call.timestamp) pills.push({ text: new Date(call.timestamp).toLocaleTimeString(), bg: PDF_PILL.blue.bg, fg: PDF_PILL.blue.fg });
          if (call.duration) pills.push({ text: call.duration + 'ms', bg: PDF_PILL.blue.bg, fg: PDF_PILL.blue.fg });
          if (call.isDelegated) pills.push({ text: 'DELEGATED', bg: PDF_PILL.purple.bg, fg: PDF_PILL.purple.fg });
          if (call.chainIndex != null) pills.push({ text: 'step ' + call.chainIndex, bg: PDF_PILL.blue.bg, fg: PDF_PILL.blue.fg });
          if (call.scopes && call.scopes.length) {
            pills.push({
              text: 'scopes: ' + (Array.isArray(call.scopes) ? call.scopes.join(' ') : call.scopes),
              bg: PDF_PILL.green.bg, fg: PDF_PILL.green.fg,
            });
          }
          blocks.push(pillRowBlock(doc, innerW, pills));

          if (call.resultSummary) {
            blocks.push(textBlock(doc, innerW, call.resultSummary, {
              font: 'Helvetica-Oblique', size: 8, color: '#555555', gapAfter: 6,
            }));
          }
          if (call.requestJson) blocks.push(codeBlock(doc, innerW, 'Request', call.requestJson));
          if (call.resultJson) blocks.push(codeBlock(doc, innerW, 'Response', call.resultJson));

          drawCard(doc, blocks, accent);
        });
      } else {
        sectionHeading(doc, 'MCP Delegation Trail', 'MCP tool invocations made by the agent during this session.');
        drawEmptyBox(doc, 'No MCP tool call events found for this session. Tool calls are recorded by the '
          + 'MCP audit server and matched to the current user session.');
      }

      // ── Metadata ──
      sectionHeading(doc, 'Metadata', 'Run timing and identity information.');
      const metaPairs = [
        ['Started', run.startedAt],
        ['Completed', run.completedAt],
      ];
      if (run.savedAt) metaPairs.push(['Saved', run.savedAt]);
      if (run.userId) metaPairs.push(['User ID', run.userId]);
      const metaTable = kvTableBlock(doc, W - 8, null, metaPairs);
      ensureSpace(doc, metaTable.h);
      metaTable.draw(X + 4, doc.y);
      doc.y += metaTable.h;

      // ── Footer on every page ──
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        const savedBottom = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;
        doc.font('Helvetica').fontSize(7).fillColor('#999999');
        doc.text('AI Demo Authorization Audit System', X, doc.page.height - 34, { lineBreak: false });
        doc.text('Page ' + (i - range.start + 1) + ' of ' + range.count,
          X, doc.page.height - 34, { width: W, align: 'right' });
        doc.page.margins.bottom = savedBottom;
      }

      doc.end();
    } catch (_) {
      resolve(null);
    }
  });
}

module.exports = { formatMarkdown, formatHtml, formatPdf, computeClaimDiff, scopeNarrowing };
