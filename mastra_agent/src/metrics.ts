import { MeterProvider } from '@opentelemetry/sdk-metrics';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

/**
 * OpenTelemetry metrics for the Mastra agent (this service, mastra_agent).
 *
 * Prefixed `mastra_`, matching demo_mcp_gateway's `mcpgw_` convention
 * (prom-client there, OTel Metrics API here — both still end up scraped by
 * Prometheus the same way, see monitoring/prometheus.yml).
 *
 * Deliberately does NOT touch handleRun's control flow, error handling, or
 * return values — index.ts wraps the existing function with pure observation
 * (record on settle, re-throw unchanged). Note: runHandler's own try/catch
 * swallows agent/tool/LLM errors into an AG-UI RUN_ERROR SSE event rather
 * than rejecting, so mastra_run_errors_total only counts something escaping
 * that catch entirely (Express/middleware-level failures) — not agent-level
 * failures, which the run always reports as a "successful" HTTP response.
 */

// preventServerStart: this service already listens on cfg.port (see index.ts) —
// metrics are served from that SAME port via exporter.getMetricsRequestHandler,
// not a second exporter-owned server.
const exporter = new PrometheusExporter({ preventServerStart: true });
const resource = resourceFromAttributes({
  [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'mastra-agent',
});
const meterProvider = new MeterProvider({ readers: [exporter], resource });
const meter = meterProvider.getMeter('mastra-agent');

export const runDuration = meter.createHistogram('mastra_run_duration_seconds', {
  description: 'Duration of /run agent invocations',
  unit: 's',
});

export const runErrors = meter.createCounter('mastra_run_errors_total', {
  description: 'Agent runs that threw before runHandler\'s own error handling could respond',
});

export { exporter };
