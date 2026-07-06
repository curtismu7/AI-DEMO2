// Sentry instrumentation — required FIRST in server.js, before any other module,
// so the SDK can auto-instrument Express/HTTP. No-op when SENTRY_DSN is unset
// (the common demo/dev case) so startup is never affected.
const path = require('path');

// Mirror server.js env precedence: root .env wins over demo_api_server/.env.
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), override: false });
require('dotenv').config({ override: false });

const dsn = process.env.SENTRY_DSN;

if (dsn) {
    const Sentry = require('@sentry/node');
    Sentry.init({
        dsn,
        environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
        // Performance tracing is opt-in via SENTRY_TRACES_SAMPLE_RATE (0 = errors only).
        tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0),
    });
    console.log('[sentry] error monitoring enabled');
} else {
    console.log('[sentry] SENTRY_DSN not set — error monitoring disabled');
}

// OpenTelemetry → Jaeger (OTLP/gRPC). No-op when OTEL_EXPORTER_OTLP_ENDPOINT is
// unset, so local runs without a collector are unaffected. Must run before any
// instrumented library import (express/http/axios) for auto-instrumentation.
const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
if (otlpEndpoint) {
    const { NodeSDK } = require('@opentelemetry/sdk-node');
    const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-grpc');
    const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
    const { resourceFromAttributes } = require('@opentelemetry/resources');
    const { ATTR_SERVICE_NAME } = require('@opentelemetry/semantic-conventions');

    const sdk = new NodeSDK({
        traceExporter: new OTLPTraceExporter({ url: otlpEndpoint }),
        instrumentations: [getNodeAutoInstrumentations()],
        resource: resourceFromAttributes({
            [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'demo-api-server',
        }),
    });
    sdk.start();
    console.log(`[otel] tracing to ${otlpEndpoint} as ${process.env.OTEL_SERVICE_NAME || 'demo-api-server'}`);
} else {
    console.log('[otel] OTEL_EXPORTER_OTLP_ENDPOINT not set — tracing disabled');
}
