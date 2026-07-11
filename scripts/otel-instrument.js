// scripts/otel-instrument.js — OpenTelemetry bootstrap (load with node -r before app entry).
// No-op when OTEL_EXPORTER_OTLP_ENDPOINT is unset. Requires @opentelemetry/* in the
// service's node_modules (see demo_api_server/package.json for pinned versions).
'use strict';

const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
if (!otlpEndpoint) {
  return;
}

// In Docker this file is bind-mounted at /otel, outside the service tree, so a
// plain require() never searches the service's /app/node_modules. Resolve from
// the service's working directory instead, falling back to normal resolution
// for native mode (where this file sits inside the repo and hoisting applies).
let req = require;
try {
  req.resolve('@opentelemetry/sdk-node');
} catch (_) {
  req = require('module').createRequire(
    require('path').join(process.cwd(), 'package.json')
  );
}

try {
  const { NodeSDK } = req('@opentelemetry/sdk-node');
  const { OTLPTraceExporter } = req('@opentelemetry/exporter-trace-otlp-grpc');
  const { getNodeAutoInstrumentations } = req('@opentelemetry/auto-instrumentations-node');
  const { Resource } = req('@opentelemetry/resources');
  const { ATTR_SERVICE_NAME } = req('@opentelemetry/semantic-conventions');

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
