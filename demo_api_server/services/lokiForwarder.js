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

const MUTE_AFTER = 3; // consecutive failures before muting warns
// While muted, probe with a real push every N calls (env-overridable, read
// lazily so tests can set it after require).
function probeEvery() { return Number(process.env.LOKI_PROBE_EVERY) || 100; }

let _consecutiveFailures = 0;
let _muted = false;
let _muteSkips = 0;

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
 * Self-muting: with the observability profile off, LOKI_URL's default
 * (http://loki:3100) fails DNS on EVERY push — 86 warns in 3 minutes during the
 * 2026-09-26 session. After 3 consecutive failures the forwarder stops warning
 * (and stops pushing) until a push succeeds again, so a Loki that comes back
 * online is picked up on the next event without a BFF restart.
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
  if (_muted) {
    // Muted: skip the push, but probe with ONE real attempt every PROBE_EVERY
    // muted calls so a Loki that comes back online is detected without a
    // restart and without per-event DNS churn.
    _muteSkips += 1;
    if (_muteSkips % probeEvery() !== 0) return Promise.resolve();
  }
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
    .then(() => {
      if (_muted) {
        console.log('[lokiForwarder] recovered — Loki push OK again');
        _muted = false;
        _consecutiveFailures = 0;
        _muteSkips = 0;
      }
    })
    .catch((err) => {
      _consecutiveFailures += 1;
      if (!_muted && _consecutiveFailures >= MUTE_AFTER) {
        _muted = true;
        _muteSkips = 0;
        console.warn(
          `[lokiForwarder] ${_consecutiveFailures} consecutive push failures (${err?.message}) — muting further warns until a push succeeds`,
        );
        return;
      }
      if (!_muted) console.warn('[lokiForwarder] push failed:', err?.message);
    });
}

module.exports = { forwardAppEvent, __resetMuteStateForTests: () => { _consecutiveFailures = 0; _muted = false; _muteSkips = 0; } };
