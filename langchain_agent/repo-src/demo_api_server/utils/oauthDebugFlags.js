'use strict';

/**
 * Verbose OAuth / token debug logging (JWT decode to console, scope traces, etc.).
 *
 * Enabled when any of:
 *   - DEBUG_TOKENS=true  (env, common in dev)
 *   - DEBUG_OAUTH=true   (env alias; matches Config → env fallback)
 *   - Config UI "Debug OAuth logging" = On → persisted `debug_oauth` in SQLite/KV
 *
 * Output: Node `console.log` / stderr → **local**: terminal or `./logs` if ENABLE_FILE_LOGGING.
 * **Vercel**: function stdout/stderr → **Runtime Logs** (Dashboard → project → Logs); use Log Drains
 * for Datadog / Axiom / etc. There is no log file on serverless workers.
 */
const configStore = require('../services/configStore');

function isOAuthVerboseDebug() {
  if (process.env.DEBUG_TOKENS === 'true') return true;
  if (process.env.DEBUG_OAUTH === 'true') return true;
  const v = String(configStore.getEffective('debug_oauth') || '').toLowerCase().trim();
  return v === 'true' || v === '1' || v === 'on';
}

module.exports = { isOAuthVerboseDebug };
