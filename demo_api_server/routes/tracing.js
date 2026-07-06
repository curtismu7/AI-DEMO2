/**
 * tracing.js — Jaeger query API proxy for the /tracing UI page.
 *
 * The BFF resolves Jaeger's query base (docker: jaeger:16686, native: localhost:16686)
 * and forwards read-only calls so the browser never hits Jaeger cross-origin.
 */

'use strict';

const express = require('express');
const axios = require('axios');

const router = express.Router();

const DEFAULT_SERVICE = process.env.OTEL_SERVICE_NAME || 'demo-api-server';
const JAEGER_UI_URL = (process.env.JAEGER_UI_URL || 'http://localhost:16686').replace(/\/$/, '');

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

/** Return the first reachable Jaeger query base, or null. */
async function resolveJaegerBase() {
  for (const base of jaegerCandidates()) {
    try {
      const resp = await axios.get(`${base}/api/services`, { timeout: 2500 });
      if (resp.status === 200) return base;
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
    jaegerUiUrl: JAEGER_UI_URL,
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
    return res.json({ services, jaegerUiUrl: JAEGER_UI_URL });
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
      jaegerUiUrl: JAEGER_UI_URL,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(502).json({
      error: 'jaeger_query_failed',
      message: err.message || 'Jaeger traces query failed',
    });
  }
});

module.exports = router;
