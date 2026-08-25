'use strict';
/**
 * reelSvg.js — server-rendered "movie reel" snapshot of one transaction.
 *
 * LM Studio renders Markdown + images in chat but has no HTML/iframe hook
 * (docs/superpowers/specs/2026-08-24-lmstudio-mcp-client-design.md §4), so the
 * façade points a Markdown image at this. Pure function: record in, SVG out.
 * Rendered at view time by routes/mcpFacade.js, so hops that land after the
 * tool result (the gateway's own gateway.authorize) are included.
 */
const W = 880;
const ROW = 44;
const TOP = 64;
const BOTTOM = 40;

function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function decisionBadge(d, x, y) {
  if (!d || d.outcome === 'n/a') return '';
  const deny = d.outcome === 'deny';
  const label = deny ? '❌ DENY' : '✓ PERMIT';
  const extra = [d.source === 'inferred' ? 'inferred' : '', d.reason || ''].filter(Boolean).join(' · ');
  return `<text x="${x}" y="${y}" font-size="12" fill="${deny ? '#b42318' : '#067647'}" font-weight="600">${esc(label)}</text>`
    + (extra ? `<text x="${x + 76}" y="${y}" font-size="11" fill="#6b7280">${esc(extra)}</text>` : '');
}

function frame(height, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}" `
    + `font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Arial, sans-serif">`
    + `<rect x="0.5" y="0.5" width="${W - 1}" height="${height - 1}" rx="10" fill="#ffffff" stroke="#e5e7eb"/>`
    + body + '</svg>';
}

function renderReelSvg(record, opts = {}) {
  if (!record) {
    return frame(96,
      `<text x="24" y="40" font-size="16" font-weight="600" fill="#111827">${esc(opts.title || 'Transaction trace')}</text>`
      + `<text x="24" y="68" font-size="13" fill="#6b7280">${esc(opts.subtitle || 'Waiting for the first hop…')}</text>`);
  }
  const hops = Array.isArray(record.hops) ? record.hops : [];
  const shown = hops.slice(-40);
  const hidden = hops.length - shown.length;
  const requests = hops.filter((h) => h.phase === 'ui.request');
  const req = requests[requests.length - 1] || null;
  const init = hops.find((h) => h.phase === 'mcp.step' && h.op === 'initialize') || null;
  const door = req?.details?.doorLabel || init?.details?.doorLabel || '';
  const title = opts.title
    || `Transaction trace — ${req?.op || (init?.details?.client?.name ? `${init.details.client.name} MCP session` : 'MCP session')}${door ? ` (${door})` : ''}`;
  const height = TOP + shown.length * ROW + BOTTOM;
  const spineX = 36;
  let body = `<text x="24" y="34" font-size="16" font-weight="600" fill="#111827">${esc(title)}</text>`;
  if (hidden > 0) {
    body += `<text x="24" y="50" font-size="11" fill="#9ca3af">${esc(`… ${hidden} earlier hops not shown`)}</text>`;
  }
  if (shown.length > 1) {
    body += `<line x1="${spineX}" y1="${TOP}" x2="${spineX}" y2="${TOP + (shown.length - 1) * ROW}" stroke="#d1d5db" stroke-width="2"/>`;
  }
  shown.forEach((h, i) => {
    const y = TOP + i * ROW;
    const err = h.status === 'error' || h.decision?.outcome === 'deny';
    body += `<circle cx="${spineX}" cy="${y}" r="12" fill="${err ? '#fee4e2' : '#eef2ff'}" stroke="${err ? '#b42318' : '#4f46e5'}"/>`
      + `<text x="${spineX}" y="${y + 4}" font-size="11" text-anchor="middle" fill="#111827">${h.seq ?? i + 1}</text>`
      + `<text x="60" y="${y - 2}" font-size="13" fill="#111827"><tspan font-weight="600">${esc(h.service)}</tspan>`
      + `<tspan fill="#4f46e5" dx="8" font-family="ui-monospace, Menlo, monospace" font-size="12">${esc(h.phase)}</tspan>`
      + (h.op ? `<tspan dx="8" font-family="ui-monospace, Menlo, monospace" font-size="12" fill="#374151">${esc(h.op)}</tspan>` : '')
      + '</text>'
      + decisionBadge(h.decision, 60, y + 16)
      + (Number.isFinite(h.durationMs)
        ? `<text x="${W - 24}" y="${y + 4}" font-size="12" text-anchor="end" fill="#6b7280">${h.durationMs}ms</text>` : '');
  });
  body += `<text x="24" y="${height - 14}" font-size="11" fill="#9ca3af">${esc(record.correlationId)}</text>`;
  return frame(height, body);
}

renderReelSvg.CONTENT_TYPE = 'image/svg+xml';
module.exports = { renderReelSvg };
