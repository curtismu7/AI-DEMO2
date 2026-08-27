/**
 * gatewayMetrics.js — PingGateway's own MCP counters, read from its admin port.
 *
 * PingGateway publishes per-route MCP metrics on the ADMIN connector (8085),
 * a different port from the one that serves routes (8080/8443). The endpoint
 * was already listening; nothing reached it because the Service exposed only
 * the route port. These are the product's own numbers — the gateway counts
 * what it validated and what it rejected, so nothing here is derived from
 * demo code.
 *
 * Read-only, and the browser never talks to :8085 directly: that connector is
 * unauthenticated by design and stays cluster-internal.
 *
 * Two metric families are surfaced:
 *   ig_mcp_method_time_seconds{_count,_sum}  per MCP method (and tool, on tools/call)
 *   ig_mcp_error_total                       per JSON-RPC error code
 *
 * Known gap, verified live 2026-08-25: ig_mcp_error_total does NOT count a
 * request whose JSON-RPC envelope fails schema validation ("required property
 * 'jsonrpc' not found"). The gateway rejects it with a 400/-32600 but the
 * counter stays flat, so these numbers are a floor on errors, not a total.
 * See TECH_DEBT.md.
 */

'use strict';

const express = require('express');
const axios = require('axios');

const router = express.Router();

/** Candidate admin bases — env-first → compose/k8s DNS → localhost, like tracing.js. */
function gatewayCandidates() {
  const raw = [
    process.env.PING_GATEWAY_ADMIN_URL,
    'http://ping-gateway:8085',
    'http://host.docker.internal:8085',
    'http://localhost:8085',
  ].filter(Boolean);
  return [...new Set(raw.map((u) => u.replace(/\/$/, '')))];
}

const METRICS_PATH = '/metrics/prometheus/0.0.4';

/** Parse `name{k="v",k2="v2",} 1.0` into {name, labels, value}; null when not a sample line. */
function parseSample(line) {
  const m = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{.*?\})?\s+(-?[\d.eE+]+)$/.exec(line.trim());
  if (!m) return null;
  const [, name, rawLabels, rawValue] = m;
  const value = Number(rawValue);
  if (!Number.isFinite(value)) return null;
  const labels = {};
  if (rawLabels) {
    for (const pair of rawLabels.slice(1, -1).split(',')) {
      const eq = pair.indexOf('=');
      if (eq === -1) continue;
      labels[pair.slice(0, eq).trim()] = pair
        .slice(eq + 1)
        .trim()
        .replace(/^"|"$/g, '');
    }
  }
  return { name, labels, value };
}

/**
 * Reduce the Prometheus exposition text to just the MCP story.
 * Quantile series are skipped — the panel shows count and mean, not percentiles.
 */
function parseMcpMetrics(text) {
  const methods = new Map();
  const errors = [];
  for (const line of String(text).split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const sample = parseSample(line);
    if (!sample || !sample.name.startsWith('ig_mcp_')) continue;
    const { name, labels, value } = sample;

    if (name === 'ig_mcp_error_total') {
      errors.push({
        code: labels.mcp_error || 'unknown',
        method: labels.mcp_method || null,
        route: labels.route || null,
        count: value,
      });
      continue;
    }
    // Summary quantile rows carry a `quantile` label; only _count/_sum are useful here.
    const isCount = name === 'ig_mcp_method_time_seconds_count';
    const isSum = name === 'ig_mcp_method_time_seconds_sum';
    if (!isCount && !isSum) continue;
    const key = `${labels.route || ''}|${labels.mcp_method || ''}|${labels.mcp_method_param_tool || ''}`;
    const entry = methods.get(key) || {
      method: labels.mcp_method || 'unknown',
      tool: labels.mcp_method_param_tool || null,
      route: labels.route || null,
      count: 0,
      totalSeconds: 0,
    };
    if (isCount) entry.count = value;
    else entry.totalSeconds = value;
    methods.set(key, entry);
  }

  return {
    methods: [...methods.values()]
      .map((m) => ({ ...m, meanSeconds: m.count > 0 ? m.totalSeconds / m.count : null }))
      .sort((a, b) => b.count - a.count),
    errors: errors.sort((a, b) => b.count - a.count),
  };
}

/**
 * GET /api/health/gateway-metrics
 * → { available, source, methods[], errors[] }
 * `available: false` with a reason when the admin port is unreachable — a
 * demo stack without PingGateway is a normal state, not an error.
 */
router.get('/', async (_req, res) => {
  for (const base of gatewayCandidates()) {
    try {
      const resp = await axios.get(`${base}${METRICS_PATH}`, {
        timeout: 2500,
        responseType: 'text',
        // Prometheus text, not JSON — stop axios from trying to parse it.
        transformResponse: [(d) => d],
      });
      if (resp.status !== 200 || typeof resp.data !== 'string') continue;
      if (!resp.data.includes('ig_')) continue; // reachable, but not PingGateway's exposition
      const parsed = parseMcpMetrics(resp.data);
      return res.json({ available: true, source: base, ...parsed });
    } catch {
      /* try next candidate */
    }
  }
  return res.json({
    available: false,
    reason: 'PingGateway admin connector not reachable',
    methods: [],
    errors: [],
  });
});

module.exports = router;
module.exports.parseMcpMetrics = parseMcpMetrics;
