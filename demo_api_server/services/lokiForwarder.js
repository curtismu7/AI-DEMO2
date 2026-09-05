'use strict';
const axios = require('axios');

/**
 * Push appEventService events to Loki so Grafana can show them beside the
 * PingGateway metrics and Jaeger traces it already has.
 *
 * A second sink alongside newRelicForwarder, not a replacement — both run from
 * the same call site, and either being unconfigured is a no-op. The shape
 * mirrors sailpointForwarder: env-gated, fire-and-forget, never throws.
 *
 * One hook covers PingOne events too: routes/webhookPingOne.js already calls
 * logEvent('pingone', ...) for every delivered event, so they arrive here as
 * app events with category 'pingone'. There is deliberately no second
 * PingOne-specific function — it would duplicate every line.
 */

/**
 * True when this process is a test runner.
 *
 * Mirrors newRelicForwarder's guard: env vars live in demo_api_server/.env,
 * which jest loads, so without this guard every `npm test` run would ship
 * fixture events into whatever LOKI_URL is configured — the same way test
 * fixtures once polluted the real New Relic account badly enough to make a
 * dashboard built on that data lie. Set LOKI_ALLOW_TEST_FORWARD=true to
 * override, for the rare case of deliberately exercising the real forwarder.
 */
function _isTestRun() {
  if (process.env.LOKI_ALLOW_TEST_FORWARD === 'true') return false;
  return process.env.NODE_ENV === 'test' || !!process.env.JEST_WORKER_ID;
}

/**
 * Forward an appEventService event. No-op when LOKI_URL is absent. Never throws.
 *
 * Loki indexes every label VALUE as its own stream, so a high-cardinality label
 * (eventId, actorId, correlationId, username) creates one stream per event and
 * degrades the store until queries time out. Labels are therefore a fixed, tiny
 * set — `category` and `severity` are closed enumerations (EVENT_CATEGORIES and
 * a fixed severity set), so their cardinality is bounded — and the whole event
 * goes in the log LINE as JSON. Loki parses that at query time with `| json`,
 * which is the documented way round and costs nothing until someone filters.
 *
 * @param {object} event — event object from appEventService.logEvent
 */
async function forwardAppEvent(event) {
  if (_isTestRun()) return Promise.resolve();
  const url = process.env.LOKI_URL;
  if (!url) return Promise.resolve();
  // Loki wants nanoseconds since epoch, as a STRING. A JSON number loses
  // precision past 2^53 and Loki rejects the entry outright.
  const ms = event.timestamp ? new Date(event.timestamp).getTime() : Date.now();
  return axios
    .post(
      `${url.replace(/\/$/, '')}/loki/api/v1/push`,
      {
        streams: [
          {
            stream: {
              service: 'ai-demo-bff',
              logtype: 'app_event',
              category: event.category || 'unknown',
              severity: event.severity || 'info',
            },
            values: [[`${ms * 1e6}`, JSON.stringify(event)]],
          },
        ],
      },
      { headers: { 'Content-Type': 'application/json' }, timeout: 5000 }
    )
    .catch((err) => {
      console.warn('[lokiForwarder] push failed:', err?.message);
    });
}

module.exports = { forwardAppEvent };
