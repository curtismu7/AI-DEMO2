// scripts/otel-instrument.js — OpenTelemetry bootstrap (load with node -r before app entry).
// No-op when OTEL_EXPORTER_OTLP_ENDPOINT is unset. Requires @opentelemetry/* in the
// service's node_modules (see demo_api_server/package.json for pinned versions).
'use strict';

const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
if (!otlpEndpoint) {
  return;
}

try {
  const { NodeSDK } = require('@opentelemetry/sdk-node');
  const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-grpc');
  const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
  const { Resource } = require('@opentelemetry/resources');
  const { ATTR_SERVICE_NAME } = require('@opentelemetry/semantic-conventions');

  const serviceName = process.env.OTEL_SERVICE_NAME || 'unknown-service';

  const sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter({ url: otlpEndpoint }),
    instrumentations: [getNodeAutoInstrumentations()],
    resource: new Resource({
      [ATTR_SERVICE_NAME]: serviceName,
    }),
  });
  sdk.start();
  console.log(`[otel] tracing to ${otlpEndpoint} as ${serviceName}`);
} catch (err) {
  console.warn(`[otel] tracing disabled — ${err.message}`);
}
