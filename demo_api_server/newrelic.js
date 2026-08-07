'use strict';
/**
 * New Relic APM configuration.
 * Required as the FIRST require() in server.js — before dotenv, before Sentry.
 * No-op at runtime when NR_LICENSE_KEY is absent (agent stays dormant).
 */
exports.config = {
  app_name: [process.env.NR_APP_NAME || 'ai-demo-bff'],
  license_key: process.env.NR_LICENSE_KEY || '',
  logging: {
    level: 'info',
    // Direct NR logs to a file so they don't pollute demo console output.
    filepath: 'stdout',
  },
  allow_all_headers: true,
  distributed_tracing: {
    enabled: true,
  },
  // Suppress agent when no key provided (dev/test default).
  agent_enabled: !!process.env.NR_LICENSE_KEY,
};
