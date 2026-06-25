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
