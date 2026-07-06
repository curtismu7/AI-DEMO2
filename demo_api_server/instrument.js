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

// OpenTelemetry — loaded via NODE_OPTIONS=-r …/scripts/otel-instrument.js (compose
// and run.sh) so it runs before this file. Kept here as a dev fallback when NODE_OPTIONS
// is not set but OTEL_EXPORTER_OTLP_ENDPOINT is (e.g. plain `npm start` in demo_api_server).
if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT && !(process.env.NODE_OPTIONS || '').includes('otel-instrument')) {
    require(path.join(__dirname, '..', 'scripts', 'otel-instrument.js'));
}
