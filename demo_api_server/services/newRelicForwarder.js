'use strict';
const axios = require('axios');
const { get: getNrCtx } = require('./nrContext');

const NR_ENDPOINT =
  process.env.NR_LOGS_ENDPOINT || 'https://log-api.newrelic.com/log/v1';

/**
 * True when this process is a test runner.
 *
 * NR_LICENSE_KEY lives in demo_api_server/.env, which jest loads, so without
 * this guard every `npm test` run shipped fixture telemetry to the production
 * New Relic account. It did: an audit found all 50 `authorize` records in the
 * account came from the fixtures `test-user-id` and `user-a-id`, and none from
 * real traffic — enough noise to make a dashboard built on that data lie.
 *
 * Set NR_ALLOW_TEST_FORWARD=true to override, for the rare case of deliberately
 * exercising the real forwarder.
 */
function _isTestRun() {
  if (process.env.NR_ALLOW_TEST_FORWARD === 'true') return false;
  return process.env.NODE_ENV === 'test' || !!process.env.JEST_WORKER_ID;
}

function _post(payload) {
  if (_isTestRun()) return Promise.resolve();
  const key = process.env.NR_LICENSE_KEY;
  if (!key) return Promise.resolve();
  return axios
    .post(NR_ENDPOINT, payload, {
      headers: { 'Api-Key': key, 'Content-Type': 'application/json' },
      timeout: 5000,
    })
    .catch((err) => {
      console.warn('[newRelicForwarder] forward failed:', err?.message);
    });
}

/**
 * Forward a PingOne webhook event to NR Logs.
 * No-op when NR_LICENSE_KEY is absent. Never throws.
 * @param {object} event — storedEvent from pingoneEventStore
 */
async function forward(event) {
  return _post([
    {
      common: { attributes: { source: 'pingone-webhook', logtype: 'pingone_event' } },
      logs: [
        {
          timestamp: event.timestamp ? new Date(event.timestamp).getTime() : Date.now(),
          message: `PingOne ${event.eventType || 'event'}: ${event.status || 'unknown'}`,
          attributes: {
            eventId: event.eventId,
            eventType: event.eventType,
            actorId: event.actorId,
            actorType: event.actorType,
            status: event.status,
            resource: event.resource,
            environmentId: event.environmentId,
          },
        },
      ],
    },
  ]);
}

/**
 * Forward an appEventService event to NR Logs.
 * No-op when NR_LICENSE_KEY is absent. Never throws.
 * @param {object} event — event object from appEventService.logEvent
 */
async function forwardAppEvent(event) {
  return _post([
    {
      common: {
        attributes: {
          source: 'ai-demo-bff',
          logtype: 'app_event',
          category: event.category,
          severity: event.severity,
          ...(getNrCtx().correlationId ? { correlationId: getNrCtx().correlationId } : {}),
          ...(getNrCtx().useCaseId ? { useCaseId: getNrCtx().useCaseId } : {}),
          ...(getNrCtx().useCaseName ? { useCaseName: getNrCtx().useCaseName } : {}),
        },
      },
      logs: [
        {
          timestamp: event.timestamp ? new Date(event.timestamp).getTime() : Date.now(),
          message: event.message,
          attributes: {
            id: event.id,
            category: event.category,
            severity: event.severity,
            tag: event.tag,
            useCaseId: event.useCaseId || getNrCtx().useCaseId || undefined,
            correlationId: event.correlationId || getNrCtx().correlationId || undefined,
            requestId: event.requestId,
            sessionId: event.sessionId,
            username: event.username,
            ...(event.metadata || {}),
          },
        },
      ],
    },
  ]);
}

/**
 * Forward a UI-originated log entry to NR Logs.
 * No-op when NR_LICENSE_KEY is absent. Never throws.
 * @param {string} message
 * @param {object} attributes
 */
async function forwardUIEvent(message, attributes = {}) {
  return _post([
    {
      common: { attributes: { source: 'ai-demo-ui', logtype: 'ui_event' } },
      logs: [
        {
          timestamp: Date.now(),
          message,
          attributes,
        },
      ],
    },
  ]);
}

module.exports = { forward, forwardAppEvent, forwardUIEvent };
