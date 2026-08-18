'use strict';
/**
 * New Relic APM configuration.
 * Required in server.js before Sentry and all app modules. The ONLY require
 * allowed above it is the dotenvx bootstrap (services/dotenvxBootstrap.js):
 * this file reads NR_LICENSE_KEY at require time, so an encrypted .env must
 * already be decrypted into process.env — 2026-08-18 incident: with ciphertext
 * in env the agent resolved `collector.encrypted:....nr-data.net`.
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
