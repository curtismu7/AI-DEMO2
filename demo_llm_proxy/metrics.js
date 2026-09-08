'use strict';

/**
 * OpenTelemetry metrics for the LLM router proxy (this service, demo_llm_proxy).
 *
 * Prefixed `llmproxy_`, matching demo_mcp_gateway's `mcpgw_` convention
 * (prom-client there, OTel Metrics API here — both still end up scraped by
 * Prometheus the same way, see monitoring/prometheus.yml).
 *
 * Deliberately does NOT touch the proxy's control flow, error handling, or
 * responses — router.js's existing `proxy.on('proxyRes'/'error', ...)` hooks
 * (already the tee point for PostHog LLM analytics) get one more pure
 * observation call each: record on settle, nothing about the request/response
 * changes.
 */

const { MeterProvider } = require('@opentelemetry/sdk-metrics');
const { PrometheusExporter } = require('@opentelemetry/exporter-prometheus');
const { resourceFromAttributes } = require('@opentelemetry/resources');
const { ATTR_SERVICE_NAME } = require('@opentelemetry/semantic-conventions');

// preventServerStart: this service already listens on LLM_PROXY_PORT (see
// router.js) — metrics are served from that SAME port via
// exporter.getMetricsRequestHandler, not a second exporter-owned server.
const exporter = new PrometheusExporter({ preventServerStart: true });
const resource = resourceFromAttributes({
  [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'llm-proxy',
});
const meterProvider = new MeterProvider({ readers: [exporter], resource });
const meter = meterProvider.getMeter('llm-proxy');

const requestDuration = meter.createHistogram('llmproxy_request_duration_seconds', {
  description: 'Duration of proxied LLM requests, from receipt to upstream response headers',
  unit: 's',
});

const requestErrors = meter.createCounter('llmproxy_request_errors_total', {
  description: 'Proxied LLM requests that failed (http-proxy "error" event — target unreachable/reset)',
});

module.exports = { exporter, requestDuration, requestErrors };
