/**
 * tracing.js — Jaeger query API proxy for the /tracing UI page.
 *
 * The BFF resolves Jaeger's query base (docker: jaeger:16686, native: localhost:16686)
 * and forwards read-only calls so the browser never hits Jaeger cross-origin.
 */

'use strict';

const express = require('express');
const axios = require('axios');
const configStore = require('../services/configStore');
const { buildTraceGraph, buildOverviewGraph } = require('../services/tracingGraph');

const router = express.Router();

const DEFAULT_SERVICE = process.env.OTEL_SERVICE_NAME || 'demo-api-server';

/**
 * Browser-facing Jaeger UI base URL. Explicit JAEGER_UI_URL wins; otherwise
 * derive from the app's public origin (configStore.getEffective('public_app_url')
 * — resolves .env PUBLIC_APP_URL first, then LMDB) so deep links resolve at the
 * demo base URL (e.g. https://ai-demo.ping-devops.com/jaeger). Falls back to localhost
 * for local docker/native, where PUBLIC_APP_URL is unset.
 */
function jaegerUiBase() {
  const publicAppUrl = String(configStore.getEffective('public_app_url') || '').trim();
  const derived = publicAppUrl ? `${publicAppUrl}/jaeger` : 'http://localhost:16686';
  return (process.env.JAEGER_UI_URL || derived).replace(/\/$/, '');
}

/** Candidate Jaeger query bases — same env-first → compose → localhost pattern as inventory. */
function jaegerCandidates() {
  const raw = [
    process.env.JAEGER_QUERY_URL,
    'http://jaeger:16686',
    'http://host.docker.internal:16686',
    'http://localhost:16686',
  ].filter(Boolean);
  return [...new Set(raw.map((u) => u.replace(/\/$/, '')))];
}

/**
 * True when /api/services looks like Jaeger's JSON query API.
 * Fresh all-in-one often returns `{ data: null }` (no services yet) — that is
 * still reachable. HTML shells (QUERY_BASE_PATH mismatch) must not pass.
 * @param {unknown} body
 */
function isJaegerServicesPayload(body) {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) return false;
  const data = body.data;
  return data == null || Array.isArray(data);
}

/** Return the first reachable Jaeger query base, or null. */
async function resolveJaegerBase() {
  for (const base of jaegerCandidates()) {
    try {
      const resp = await axios.get(`${base}/api/services`, { timeout: 2500 });
      // Require the JSON query API, not just any 200: when Jaeger runs with
      // QUERY_BASE_PATH set, the root /api/services returns the UI's HTML shell
      // with a 200, which would otherwise be mistaken for a working query base
      // and silently yield empty services/traces.
      if (resp.status === 200 && isJaegerServicesPayload(resp.data)) return base;
    } catch {
      /* try next candidate */
    }
  }
  return null;
}

/** GET /status — collector reachability + UI link for the tracing page header. */
router.get('/status', async (_req, res) => {
  const base = await resolveJaegerBase();
  res.status(200).json({
    ok: Boolean(base),
    jaegerQueryUrl: base,
    jaegerUiUrl: jaegerUiBase(),
    defaultService: DEFAULT_SERVICE,
    otelEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || null,
    timestamp: new Date().toISOString(),
  });
});

/** GET /services — Jaeger service list. */
router.get('/services', async (_req, res) => {
  const base = await resolveJaegerBase();
  if (!base) {
    return res.status(503).json({
      error: 'jaeger_unreachable',
      message: 'Jaeger query API is not reachable. Start Jaeger (docker compose up -d jaeger or ./run.sh).',
    });
  }
  try {
    const resp = await axios.get(`${base}/api/services`, { timeout: 5000 });
    const services = Array.isArray(resp.data?.data) ? resp.data.data : [];
    return res.json({ services, jaegerUiUrl: jaegerUiBase() });
  } catch (err) {
    return res.status(502).json({
      error: 'jaeger_query_failed',
      message: err.message || 'Jaeger services query failed',
    });
  }
});

/**
 * Summarise a Jaeger trace payload for the list view.
 * @param {object} trace
 */
function summariseTrace(trace) {
  const spans = Array.isArray(trace?.spans) ? trace.spans : [];
  if (!spans.length) {
    return {
      traceId: trace?.traceID || '',
      operation: '—',
      spanCount: 0,
      durationMs: 0,
      startTime: null,
    };
  }
  let minStart = Infinity;
  let maxEnd = 0;
  let rootOp = spans[0].operationName || '—';
  for (const span of spans) {
    const start = Number(span.startTime) || 0;
    const duration = Number(span.duration) || 0;
    const end = start + duration;
    if (start < minStart) {
      minStart = start;
      if (!span.references?.length) rootOp = span.operationName || rootOp;
    }
    if (end > maxEnd) maxEnd = end;
  }
  const durationUs = maxEnd > minStart ? maxEnd - minStart : 0;
  return {
    traceId: trace.traceID,
    operation: rootOp,
    spanCount: spans.length,
    durationMs: Math.round(durationUs / 1000),
    startTime: minStart !== Infinity ? new Date(minStart / 1000).toISOString() : null,
  };
}

/**
 * Flatten one Jaeger trace into a render-ready span tree for the in-app waterfall.
 * @param {object} trace  a single Jaeger trace object ({ traceID, spans, processes })
 */
function normaliseTrace(trace) {
  const spans = Array.isArray(trace?.spans) ? trace.spans : [];
  const processes = trace?.processes || {};
  if (!spans.length) {
    return { traceId: trace?.traceID || '', spans: [], serviceColors: {}, durationMs: 0, startTime: null };
  }

  let minStart = Infinity;
  let maxEnd = 0;
  for (const s of spans) {
    const start = Number(s.startTime) || 0;
    const end = start + (Number(s.duration) || 0);
    if (start < minStart) minStart = start;
    if (end > maxEnd) maxEnd = end;
  }
  const totalUs = maxEnd > minStart ? maxEnd - minStart : 0;

  const spanIds = new Set(spans.map((s) => s.spanID));
  const parentOf = (s) => {
    const ref = (s.references || []).find(
      (r) => (r.refType === 'CHILD_OF' || r.refType === 'FOLLOWS_FROM') && spanIds.has(r.spanID),
    );
    return ref ? ref.spanID : null;
  };

  const byParent = new Map();
  for (const s of spans) {
    const p = parentOf(s);
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p).push(s);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => (Number(a.startTime) || 0) - (Number(b.startTime) || 0));
  }

  const serviceOf = (s) => processes[s.processID]?.serviceName || 'unknown';
  const services = [...new Set(spans.map(serviceOf))];
  const serviceColors = Object.fromEntries(services.map((name, i) => [name, i % 8]));

  const ordered = [];
  const walk = (parentId, depth) => {
    for (const s of byParent.get(parentId) || []) {
      const start = Number(s.startTime) || 0;
      ordered.push({
        spanID: s.spanID,
        parentSpanID: parentOf(s),
        serviceName: serviceOf(s),
        operationName: s.operationName || '—',
        relativeStartMs: Math.round((start - minStart) / 1000),
        durationMs: Math.round((Number(s.duration) || 0) / 1000),
        depth,
      });
      walk(s.spanID, depth + 1);
    }
  };
  walk(null, 0);

  return {
    traceId: trace.traceID,
    spans: ordered,
    serviceColors,
    durationMs: Math.round(totalUs / 1000),
    startTime: minStart !== Infinity ? new Date(minStart / 1000).toISOString() : null,
  };
}

/** GET /traces?service=&limit= — recent traces for a service. */
router.get('/traces', async (req, res) => {
  const base = await resolveJaegerBase();
  if (!base) {
    return res.status(503).json({
      error: 'jaeger_unreachable',
      message: 'Jaeger query API is not reachable.',
    });
  }
  const service = String(req.query.service || DEFAULT_SERVICE).trim();
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
  const lookback = String(req.query.lookback || '1h').trim();

  try {
    const resp = await axios.get(`${base}/api/traces`, {
      timeout: 10000,
      params: { service, limit, lookback },
    });
    const raw = Array.isArray(resp.data?.data) ? resp.data.data : [];
    const traces = raw.map(summariseTrace).filter((t) => t.traceId);
    return res.json({
      service,
      limit,
      lookback,
      traces,
      jaegerUiUrl: jaegerUiBase(),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(502).json({
      error: 'jaeger_query_failed',
      message: err.message || 'Jaeger traces query failed',
    });
  }
});

/** GET /traces/:id — full span tree for one trace, normalised for the in-app waterfall. */
router.get('/traces/:id', async (req, res) => {
  const id = String(req.params.id || '');
  if (!/^[0-9a-f]{16,32}$/i.test(id)) {
    return res.status(400).json({ error: 'invalid_trace_id', message: 'Trace id must be 16-32 hex characters.' });
  }
  const base = await resolveJaegerBase();
  if (!base) {
    return res.status(503).json({ error: 'jaeger_unreachable', message: 'Jaeger query API is not reachable.' });
  }
  try {
    const resp = await axios.get(`${base}/api/traces/${id}`, { timeout: 10000 });
    const trace = Array.isArray(resp.data?.data) ? resp.data.data[0] : null;
    if (!trace) {
      return res.status(404).json({ error: 'trace_not_found', message: 'Trace not found.' });
    }
    return res.json(normaliseTrace(trace));
  } catch (err) {
    if (err.response?.status === 404) {
      return res.status(404).json({ error: 'trace_not_found', message: 'Trace not found.' });
    }
    return res.status(502).json({ error: 'jaeger_query_failed', message: err.message || 'Jaeger trace query failed' });
  }
});

/**
 * GET /graph — Telemetry page graph.
 * ?traceId=<hex>  span-level graph of one trace (detailed view)
 * ?lookback=1h    service-level graph aggregated from recent traces (overview)
 * Fail-soft: Jaeger unreachable or query failure returns 200 with
 * tracingEnabled:false so the page can render an empty state (never 5xx).
 */
router.get('/graph', async (req, res) => {
  const failSoft = () => ({
    tracingEnabled: false,
    nodes: [],
    edges: [],
    fetchedAt: new Date().toISOString(),
  });

  // Spec rule: flag OFF behaves exactly like Jaeger-unreachable (fail-soft).
  // ff_tracing defaults ON; only an explicit 'false' disables.
  if (String(configStore.getEffective('ff_tracing')).trim() === 'false') {
    return res.status(200).json(failSoft());
  }

  const base = await resolveJaegerBase();
  if (!base) return res.status(200).json(failSoft());

  const traceId = String(req.query.traceId || '').trim();
  try {
    if (traceId) {
      if (!((/^[0-9a-f]{16,32}$/i).test(traceId))) {
        return res.status(400).json({ error: 'invalid_trace_id', message: 'Trace id must be 16-32 hex characters.' });
      }
      const resp = await axios.get(`${base}/api/traces/${traceId}`, { timeout: 10000 });
      const trace = Array.isArray(resp.data?.data) ? resp.data.data[0] : null;
      if (!trace) return res.status(404).json({ error: 'trace_not_found', message: 'Trace not found.' });
      return res.json({ ...buildTraceGraph(trace), tracingEnabled: true, fetchedAt: new Date().toISOString() });
    }

    const lookback = String(req.query.lookback || '1h').trim();
    const svcResp = await axios.get(`${base}/api/services`, { timeout: 5000 });
    const services = (Array.isArray(svcResp.data?.data) ? svcResp.data.data : []).filter((s) => s && s !== 'jaeger-all-in-one');
    const perService = await Promise.all(
      services.map((service) =>
        axios
          .get(`${base}/api/traces`, { timeout: 10000, params: { service, limit: 10, lookback } })
          .then((r) => (Array.isArray(r.data?.data) ? r.data.data : []))
          .catch(() => []),
      ),
    );
    const byId = new Map();
    for (const t of perService.flat()) {
      if (t?.traceID && !byId.has(t.traceID)) byId.set(t.traceID, t);
    }
    return res.json({ ...buildOverviewGraph([...byId.values()]), tracingEnabled: true, fetchedAt: new Date().toISOString() });
  } catch (err) {
    if (traceId && err.response?.status === 404) {
      return res.status(404).json({ error: 'trace_not_found', message: 'Trace not found.' });
    }
    return res.status(200).json(failSoft());
  }
});

const { project } = require('../services/traceProjector');

const TRACE_ID_RE = /^[0-9a-f]{16,32}$/i;
const INGEST_RETRY_DELAYS_MS = [500, 1000, 1500];

/** Fetch a trace, retrying 404s and empty responses to absorb Jaeger ingest lag (2–5s typical). */
async function fetchTraceWithRetry(base, id, delays) {
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      const resp = await axios.get(`${base}/api/traces/${id}`, { timeout: 10000 });
      // Jaeger returns 200 with empty data array for not-found traces, not 404.
      if (!Array.isArray(resp.data?.data) || resp.data.data.length === 0) {
        if (attempt < delays.length) {
          await new Promise((r) => setTimeout(r, delays[attempt]));
          continue;
        }
        return { ok: false, status: 404 };
      }
      return { ok: true, data: resp.data };
    } catch (err) {
      if (err.response?.status === 404 && attempt < delays.length) {
        await new Promise((r) => setTimeout(r, delays[attempt]));
        continue;
      }
      if (err.response?.status === 404) return { ok: false, status: 404 };
      return { ok: false, status: 502, message: err.message };
    }
  }
  return { ok: false, status: 404 };
}

/** GET /traces/:id/projected — curated business-step projection (Steps tab). */
router.get('/traces/:id/projected', async (req, res) => {
  const id = String(req.params.id || '');
  if (!TRACE_ID_RE.test(id)) {
    return res.status(400).json({ error: 'invalid_trace_id', message: 'Trace id must be 16-32 hex characters.' });
  }
  const base = await resolveJaegerBase();
  if (!base) {
    return res.status(503).json({ error: 'jaeger_unreachable', message: 'Jaeger query API is not reachable.' });
  }
  // retryDelaysMs=0 collapses the retry waits (tests); production callers omit it.
  const delays = req.query.retryDelaysMs === '0'
    ? INGEST_RETRY_DELAYS_MS.map(() => 0)
    : INGEST_RETRY_DELAYS_MS;
  const result = await fetchTraceWithRetry(base, id, delays);
  if (!result.ok) {
    if (result.status === 404) return res.status(404).json({ error: 'trace_not_found', message: 'Trace not found.' });
    return res.status(502).json({ error: 'jaeger_query_failed', message: result.message || 'Jaeger trace query failed' });
  }
  return res.json(project(result.data));
});

/** GET /traces/:id/raw — unmodified Jaeger trace payload (Graph tab). */
router.get('/traces/:id/raw', async (req, res) => {
  const id = String(req.params.id || '');
  if (!TRACE_ID_RE.test(id)) {
    return res.status(400).json({ error: 'invalid_trace_id', message: 'Trace id must be 16-32 hex characters.' });
  }
  const base = await resolveJaegerBase();
  if (!base) {
    return res.status(503).json({ error: 'jaeger_unreachable', message: 'Jaeger query API is not reachable.' });
  }
  try {
    const resp = await axios.get(`${base}/api/traces/${id}`, { timeout: 10000 });
    // Jaeger returns 200 with empty data array for not-found traces, not 404.
    if (!Array.isArray(resp.data?.data) || resp.data.data.length === 0) {
      return res.status(404).json({ error: 'trace_not_found', message: 'Trace not found.' });
    }
    return res.json(resp.data);
  } catch (err) {
    if (err.response?.status === 404) {
      return res.status(404).json({ error: 'trace_not_found', message: 'Trace not found.' });
    }
    return res.status(502).json({ error: 'jaeger_query_failed', message: err.message || 'Jaeger trace query failed' });
  }
});

/**
 * GET /overview/raw?lookback= — raw multi-trace Jaeger payload for the whole
 * system (all instrumented services' recent traces, deduped by traceID). The
 * client-side model (buildGraph/buildCollapsedGraph) aggregates this the same
 * way it aggregates a single trace — this endpoint reuses the /graph route's
 * overview-gathering exactly, just skips server-side aggregation so Overview
 * and Detailed share one rendering path.
 * Fail-soft: Jaeger unreachable, ff_tracing=false, or the gather throwing all
 * return 200 { data: [] } — never 5xx.
 */
router.get('/overview/raw', async (req, res) => {
  if (String(configStore.getEffective('ff_tracing')).trim() === 'false') {
    return res.json({ data: [] });
  }
  const base = await resolveJaegerBase();
  if (!base) return res.json({ data: [] });

  const lookback = String(req.query.lookback || '1h').trim();
  try {
    const svcResp = await axios.get(`${base}/api/services`, { timeout: 5000 });
    const services = (Array.isArray(svcResp.data?.data) ? svcResp.data.data : []).filter((s) => s && s !== 'jaeger-all-in-one');
    const perService = await Promise.all(
      services.map((service) =>
        axios
          .get(`${base}/api/traces`, { timeout: 10000, params: { service, limit: 10, lookback } })
          .then((r) => (Array.isArray(r.data?.data) ? r.data.data : []))
          .catch(() => []),
      ),
    );
    const byId = new Map();
    for (const t of perService.flat()) {
      if (t?.traceID && !byId.has(t.traceID)) byId.set(t.traceID, t);
    }
    return res.json({ data: [...byId.values()] });
  } catch {
    return res.json({ data: [] });
  }
});

module.exports = router;
