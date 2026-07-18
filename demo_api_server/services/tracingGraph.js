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
  const edgeMap = new Map(); // "src-->tgt" -> label

  for (const trace of Array.isArray(traces) ? traces : []) {
    const spans = Array.isArray(trace?.spans) ? trace.spans : [];
    const processes = trace?.processes || {};
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
    }
  }

  const nodes = [...byService.entries()].map(([name, agg]) => ({
    id: name,
    label: name,
    latency: formatLatencyUs(p50(agg.durations)),
    status: agg.error ? 'error' : 'ok',
  }));
  const edges = [...edgeMap.entries()].map(([key, label]) => {
    const [source, target] = key.split('-->');
    return { source, target, label };
  });
  return { nodes, edges };
}

module.exports = { buildTraceGraph, buildOverviewGraph, formatLatencyUs, spanHasError };
