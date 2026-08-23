/**
 * traceProjector.js — Projects a raw Jaeger trace into curated business steps
 * for the /tracing page Steps tab.
 *
 * Ported from acp-workforce-portal/lib/traceProjector.js. Helper core kept
 * verbatim; anchor builders rewritten for this demo's span topology:
 *   Agent Reasoning   agent-service                / reasoning-step-N   (custom tracer)
 *   Tool Call         agent-service                / tool-execution     (custom tracer)
 *   Token Exchange    demo-api-server | mcp-gateway / HTTP POST …/as/token
 *   Authorization     authz-server                 / HTTP server spans
 *   MCP Backend       mcp-server|mcp-resource-server        / HTTP server spans
 *   Human Approval    hitl-service                 / HTTP server spans
 * A builder whose anchor is absent from the trace is omitted.
 *
 * Anchor adjustment from Task 1 fixture capture (trace-chip-run.json, 77
 * spans / 4 services): /as/token client spans appear on BOTH demo-api-server
 * AND mcp-gateway (mcp-gateway performs its own token exchange en route to
 * the MCP backend), so projectTokenExchange anchors on both services rather
 * than demo-api-server alone. URL tag keys observed in the fixtures are
 * http.url / http.target (client spans) — httpUrl() below already checks
 * http.url as a fallback to url.full, so no further change was needed there.
 */

'use strict';

function tagsToObject(tags) {
  const obj = {};
  for (const tag of tags || []) obj[tag.key] = tag.value;
  return obj;
}

function processName(traceData, span) {
  const proc = traceData.processes?.[span.processID];
  return proc?.serviceName || '?';
}

function durationMs(span) {
  return Math.max(0, Math.round((span.duration || 0) / 1000));
}

function _isErrorCode(code) {
  if (code === undefined) return false;
  const n = typeof code === 'number' ? code : parseInt(code, 10);
  return Number.isFinite(n) && n >= 400;
}

function httpStatusCode(tagMap) {
  return tagMap['http.response.status_code'] ?? tagMap['http.status_code'];
}

function statusFromHttp(tagMap) {
  return _isErrorCode(httpStatusCode(tagMap)) ? 'error' : 'ok';
}

function httpUrl(tagMap) {
  return String(tagMap['url.full'] ?? tagMap['http.url'] ?? '');
}

function isServerSpan(tagMap) {
  return String(tagMap['span.kind'] || '').toLowerCase() === 'server';
}

function buildProjectedSpan({ id, title, icon, span, traceData, summary, status }) {
  return {
    id,
    title,
    icon,
    status: status || 'ok',
    summary,
    source: `${processName(traceData, span)} / ${span.operationName}`,
    durationMs: durationMs(span),
    startTime: span.startTime,
    details: tagsToObject(span.tags),
    ids: [span.spanID],
    traceID: null,
  };
}

// Facet factories (verbatim from ACP) — locals named `outcome` inside a
// builder shadow the helper; use `outcomeValue` for locals.
const outcome = (v) => ({ facet: 'outcome', value: String(v) });
const target = (v) => ({ facet: 'target', value: String(v) });
const protocol = (v) => ({ facet: 'protocol', value: String(v) });
const metadata = (k, v) => ({ facet: 'additionalMetadata', key: k, value: String(v) });

// ── Builders ─────────────────────────────────────────────────────────────────

function projectAgentReasoning(traceData) {
  const steps = (traceData.spans || [])
    .filter((s) => processName(traceData, s) === 'agent-service' && /^reasoning-step-\d+$/.test(s.operationName))
    .sort((a, b) => (a.startTime || 0) - (b.startTime || 0));
  if (!steps.length) return null;

  const firstTags = tagsToObject(steps[0].tags);
  const totalMs = steps.reduce((sum, s) => sum + durationMs(s), 0);
  const sumTag = (key) => steps.reduce((sum, s) => sum + (parseInt(tagsToObject(s.tags)[key], 10) || 0), 0);
  const inTok = sumTag('input_tokens');
  const outTok = sumTag('output_tokens');

  const summary = [outcome(`${steps.length} reasoning step${steps.length === 1 ? '' : 's'}`)];
  if (firstTags.provider) summary.push(metadata('provider', firstTags.provider));
  if (inTok || outTok) summary.push(metadata('tokens', `${inTok} in / ${outTok} out`));

  return {
    ...buildProjectedSpan({
      id: 'agent_reasoning',
      title: 'Agent Reasoning',
      icon: 'brain',
      span: steps[0],
      traceData,
      summary,
    }),
    durationMs: totalMs,
    ids: steps.map((s) => s.spanID),
  };
}

function projectToolCalls(traceData) {
  const calls = (traceData.spans || [])
    .filter((s) => processName(traceData, s) === 'agent-service' && s.operationName === 'tool-execution')
    .sort((a, b) => (a.startTime || 0) - (b.startTime || 0));
  if (!calls.length) return null;

  return calls.map((span, i) => {
    const tags = tagsToObject(span.tags);
    const summary = [];
    if (tags.tool_name) summary.push(target(tags.tool_name));
    if (tags.tool_call_id) summary.push(metadata('call id', tags.tool_call_id));
    summary.push(protocol('MCP'));
    return buildProjectedSpan({
      id: calls.length === 1 ? 'tool_call' : `tool_call_${i}`,
      title: 'Tool Call',
      icon: 'bolt',
      span,
      traceData,
      summary,
    });
  });
}

// Token exchange anchors on demo-api-server AND mcp-gateway: both services
// perform an RFC 8693 /as/token exchange against PingOne (see file-top
// comment for the fixture evidence).
const TOKEN_EXCHANGE_SERVICES = ['demo-api-server', 'mcp-gateway'];

function projectTokenExchange(traceData) {
  const candidates = (traceData.spans || []).filter((s) => {
    if (!TOKEN_EXCHANGE_SERVICES.includes(processName(traceData, s))) return false;
    return httpUrl(tagsToObject(s.tags)).includes('/as/token');
  });
  if (!candidates.length) return null;

  return candidates.map((span, i) => {
    const tags = tagsToObject(span.tags);
    const code = httpStatusCode(tags);
    const url = httpUrl(tags);
    let host = '';
    try { host = new URL(url).host; } catch { /* keep '' */ }
    const summary = [outcome(code !== undefined ? `HTTP ${code}` : 'sent')];
    if (host) summary.push(target(host));
    summary.push(protocol('HTTP'));
    summary.push(metadata('spec', 'RFC 8693 (token exchange)'));
    return buildProjectedSpan({
      id: candidates.length === 1 ? 'token_exchange' : `token_exchange_${i}`,
      title: 'Token Exchange',
      icon: 'key',
      span,
      traceData,
      summary,
      status: statusFromHttp(tags),
    });
  });
}

// Generic HTTP-server-span builder for services whose auto-instrumented
// spans are the anchor (authz-server, mcp backends, hitl-service).
function projectServiceCards(traceData, { services, id, title, icon, protocolLabel }) {
  const spans = traceData.spans || [];
  // Precomputed once per call instead of re-scanning the full span array for
  // every candidate span (was O(matching-spans x total-spans) per call, and
  // this runs 3x per project() invocation).
  const serverKindServices = new Set();
  for (const s of spans) {
    if (isServerSpan(tagsToObject(s.tags))) serverKindServices.add(processName(traceData, s));
  }
  const candidates = spans.filter((s) => {
    if (!services.includes(processName(traceData, s))) return false;
    const tags = tagsToObject(s.tags);
    // Prefer server spans; a service with no span.kind tags still anchors.
    const anyKind = serverKindServices.has(processName(traceData, s));
    return anyKind ? isServerSpan(tags) : true;
  });
  if (!candidates.length) return null;

  return candidates.map((span, i) => {
    const tags = tagsToObject(span.tags);
    const code = httpStatusCode(tags);
    const summary = [outcome(code !== undefined ? `HTTP ${code}` : 'ok')];
    summary.push(target(processName(traceData, span)));
    summary.push(metadata('endpoint', span.operationName));
    if (protocolLabel) summary.push(protocol(protocolLabel));
    return buildProjectedSpan({
      id: candidates.length === 1 ? id : `${id}_${i}`,
      title,
      icon,
      span,
      traceData,
      summary,
      status: statusFromHttp(tags),
    });
  });
}

const projectAuthorization = (t) =>
  projectServiceCards(t, { services: ['authz-server'], id: 'authorization', title: 'Authorization', icon: 'shield', protocolLabel: 'HTTP' });
const projectBackendApi = (t) =>
  projectServiceCards(t, { services: ['mcp-server', 'mcp-resource-server'], id: 'backend_api', title: 'MCP Backend', icon: 'database', protocolLabel: 'HTTP' });
const projectHitlApproval = (t) =>
  projectServiceCards(t, { services: ['hitl-service'], id: 'hitl_approval', title: 'Human Approval', icon: 'bell', protocolLabel: 'HTTP' });

const PROJECTED_SPAN_BUILDERS = [
  projectAgentReasoning,
  projectTokenExchange,
  projectAuthorization,
  projectToolCalls,
  projectBackendApi,
  projectHitlApproval,
];

// ── Trace-level metadata (verbatim from ACP) ────────────────────────────────

function computeTimings(spans) {
  if (!spans || spans.length === 0) {
    return { traceStartedAt: new Date().toISOString(), traceDurationMs: 0 };
  }
  let minStart = Infinity;
  let maxEnd = -Infinity;
  for (const s of spans) {
    const start = s.startTime;
    const end = start + s.duration;
    if (start < minStart) minStart = start;
    if (end > maxEnd) maxEnd = end;
  }
  return {
    traceStartedAt: new Date(minStart / 1000).toISOString(),
    traceDurationMs: Math.round((maxEnd - minStart) / 1000),
  };
}

// ── Public entry point ──────────────────────────────────────────────────────

function project(jaegerResponse) {
  const traceData = jaegerResponse?.data?.[0];
  if (!traceData) {
    return { traceId: '', traceStartedAt: new Date().toISOString(), traceDurationMs: 0, outcome: 'ok', spans: [] };
  }

  const { traceID } = traceData;
  const { traceStartedAt, traceDurationMs } = computeTimings(traceData.spans);

  const projectedSpans = [];
  for (const build of PROJECTED_SPAN_BUILDERS) {
    const result = build(traceData);
    if (!result) continue;
    const cards = Array.isArray(result) ? result : [result];
    for (const s of cards) s.traceID = traceID;
    projectedSpans.push(...cards);
  }

  projectedSpans.sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0));
  for (const s of projectedSpans) delete s.startTime;

  const outcomeValue = projectedSpans.some((s) => s.status === 'error') ? 'error' : 'ok';
  return { traceId: traceID, traceStartedAt, traceDurationMs, outcome: outcomeValue, spans: projectedSpans };
}

module.exports = { project };
