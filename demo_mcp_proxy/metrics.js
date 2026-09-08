'use strict';

/**
 * OpenTelemetry metrics for the MCP proxy sidecar (this service, demo_mcp_proxy).
 *
 * Prefixed `mcpproxy_`, matching demo_mcp_gateway's `mcpgw_` convention
 * (prom-client there, OTel Metrics API here — both still end up scraped by
 * Prometheus the same way, see monitoring/prometheus.yml), so both live in
 * one Prometheus without colliding.
 *
 * Deliberately does NOT touch mcpRpc's control flow, error handling, or
 * return values — server.js wraps the existing function with pure
 * observation (record on settle, re-throw/re-return unchanged).
 */

const { MeterProvider } = require('@opentelemetry/sdk-metrics');
const { PrometheusExporter } = require('@opentelemetry/exporter-prometheus');
const { resourceFromAttributes } = require('@opentelemetry/resources');
const { ATTR_SERVICE_NAME } = require('@opentelemetry/semantic-conventions');

// preventServerStart: this service already listens on PORT (see server.js) —
// metrics are served from that SAME port via exporter.getMetricsRequestHandler,
// not a second exporter-owned server.
const exporter = new PrometheusExporter({ preventServerStart: true });
const resource = resourceFromAttributes({
  [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'mcp-proxy',
});
const meterProvider = new MeterProvider({ readers: [exporter], resource });
const meter = meterProvider.getMeter('mcp-proxy');

const mcpCallDuration = meter.createHistogram('mcpproxy_mcp_call_duration_seconds', {
  description: 'Duration of MCP JSON-RPC calls proxied to the backend MCP gateway',
  unit: 's',
});

const mcpCallErrors = meter.createCounter('mcpproxy_mcp_call_errors_total', {
  description: 'MCP JSON-RPC calls that settled as a JSON-RPC error response or threw',
});

module.exports = { exporter, mcpCallDuration, mcpCallErrors };
