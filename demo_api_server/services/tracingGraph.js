'use strict';

/**
 * tracingGraph.js — pure transforms from Jaeger trace JSON to the Telemetry
 * page graph contract: { nodes: [{id, label, latency, status}], edges:
 * [{source, target, label}] }. No HTTP here; routes/tracing.js owns fetching.
 */

/** Format a microsecond duration for node display. */
function formatLatencyUs(us) {
  const ms = (Number(us) || 0) / 1000;
  if (ms < 1) return '<1ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** True when a span carries an error tag or OTel ERROR status. */
function spanHasError(span) {
  const tags = Array.isArray(span?.tags) ? span.tags : [];
  return tags.some(
    (t) =>
      (t.key === 'error' && (t.value === true || t.value === 'true')) ||
      (t.key === 'otel.status_code' && String(t.value).toUpperCase() === 'ERROR'),
  );
}

function serviceOf(span, processes) {
  return processes?.[span.processID]?.serviceName || 'unknown';
}

/** In-trace parent spanID (CHILD_OF/FOLLOWS_FROM), or null. */
function parentOf(span, spanIds) {
  const ref = (span.references || []).find(
    (r) => (r.refType === 'CHILD_OF' || r.refType === 'FOLLOWS_FROM') && spanIds.has(r.spanID),
  );
  return ref ? ref.spanID : null;
}

function p50(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

// Demo-friendly display names for instrumented services (ids stay raw so
// dragged positions and edges keep working).
const FRIENDLY_SERVICE_LABELS = {
  'demo-api-server': 'BFF / API',
  'agent-service': 'Agent',
  'mcp-server': 'Resource Server (MCP)',
  'mcp-gateway': 'MCP Gateway',
  'hitl-service': 'HITL',
  'authz-server': 'AuthZ Server',
  'mcp-resource-server': 'Invest (MCP)',
};

/**
 * Known un-instrumented peers, detected from an outbound client span's URL
 * tags (http.url / url.full / net.peer.name). Returns { id, label } or null.
 * URL sources: compose wires PingOne SaaS (*.pingone.com), the host LLM proxy
 * (host.docker.internal:8090), and api-resource-server:8082.
 */
function peerOfSpan(span) {
  const tags = Array.isArray(span?.tags) ? span.tags : [];
  const urlish = tags
    .filter((t) => t.key === 'http.url' || t.key === 'url.full' || t.key === 'net.peer.name')
    .map((t) => String(t.value))
    .join(' ');
  if (!urlish) return null;
  if (/pingone\.com/i.test(urlish)) return { id: 'pingone', label: 'PingOne' };
  if (/:809\d\b/.test(urlish)) return { id: 'llm', label: 'LLM' };
  if (/mortgage/i.test(urlish)) return { id: 'mortgage-app', label: 'Mortgage App' };
  return null;
}

/** One Jaeger trace to a span-level graph (detailed view). */
function buildTraceGraph(trace) {
  const spans = Array.isArray(trace?.spans) ? trace.spans : [];
  if (!spans.length) return { nodes: [], edges: [] };
  const processes = trace.processes || {};
  const spanIds = new Set(spans.map((s) => s.spanID));

  const nodes = spans.map((s) => ({
    id: s.spanID,
    label: `${serviceOf(s, processes)}: ${s.operationName || '-'}`,
    latency: formatLatencyUs(s.duration),
    status: spanHasError(s) ? 'error' : 'ok',
  }));

  const edges = [];
  for (const s of spans) {
    const parent = parentOf(s, spanIds);
    if (parent) edges.push({ source: parent, target: s.spanID, label: s.operationName || '-' });
  }
  return { nodes, edges };
}

/** Recent traces (deduped upstream) to a service-level graph (overview). */
function buildOverviewGraph(traces) {
  const byService = new Map(); // name -> { durations: number[], error: boolean }
  const byPeer = new Map(); // synthetic peer id -> { id, label, durations, error }
  const edgeMap = new Map(); // "src-->tgt" -> label

  for (const trace of Array.isArray(traces) ? traces : []) {
    const processes = trace?.processes || {};
    // Jaeger instruments itself; its query-handling spans join BFF traces via
    // context propagation. Drop them entirely so the demo graph never shows a
    // jaeger-all-in-one node or edges to it.
    const spans = (Array.isArray(trace?.spans) ? trace.spans : []).filter(
      (s) => serviceOf(s, processes) !== 'jaeger-all-in-one',
    );
    const spanIds = new Set(spans.map((s) => s.spanID));
    const byId = new Map(spans.map((s) => [s.spanID, s]));

    for (const s of spans) {
      const svc = serviceOf(s, processes);
      if (!byService.has(svc)) byService.set(svc, { durations: [], error: false });
      const agg = byService.get(svc);
      agg.durations.push(Number(s.duration) || 0);
      if (spanHasError(s)) agg.error = true;

      const parentId = parentOf(s, spanIds);
      if (parentId) {
        const parentSvc = serviceOf(byId.get(parentId), processes);
        if (parentSvc !== svc) {
          const key = `${parentSvc}-->${svc}`;
          if (!edgeMap.has(key)) edgeMap.set(key, s.operationName || '-');
        }
      }

      // Un-instrumented peers (PingOne SaaS, host LLM proxy, mortgage app) never
      // export spans, but instrumented services record outbound client spans whose
      // URL identifies them — surface those as synthetic nodes so the demo graph
      // shows the full topology.
      const peer = peerOfSpan(s);
      if (peer) {
        if (!byPeer.has(peer.id)) byPeer.set(peer.id, { ...peer, durations: [], error: false });
        const peerAgg = byPeer.get(peer.id);
        peerAgg.durations.push(Number(s.duration) || 0);
        if (spanHasError(s)) peerAgg.error = true;
        const key = `${svc}-->${peer.id}`;
        if (!edgeMap.has(key)) edgeMap.set(key, s.operationName || '-');
      }
    }
  }

  const nodes = [...byService.entries()].map(([name, agg]) => ({
    id: name,
    label: FRIENDLY_SERVICE_LABELS[name] || name,
    latency: formatLatencyUs(p50(agg.durations)),
    status: agg.error ? 'error' : 'ok',
  }));
  for (const peerAgg of byPeer.values()) {
    nodes.push({
      id: peerAgg.id,
      label: peerAgg.label,
      latency: formatLatencyUs(p50(peerAgg.durations)),
      status: peerAgg.error ? 'error' : 'ok',
    });
  }
  const edges = [...edgeMap.entries()].map(([key, label]) => {
    const [source, target] = key.split('-->');
    return { source, target, label };
  });

  // The browser Chat UI cannot export spans; every trace enters through the
  // BFF (OTEL_SERVICE_NAME=demo-api-server), so root it with a synthetic node.
  if (byService.has('demo-api-server')) {
    nodes.unshift({ id: 'chat-ui', label: 'Chat UI', latency: '', status: 'ok' });
    edges.unshift({ source: 'chat-ui', target: 'demo-api-server', label: 'HTTPS' });
  }

  return { nodes, edges };
}

module.exports = { buildTraceGraph, buildOverviewGraph, formatLatencyUs, spanHasError };
