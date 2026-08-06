'use strict';
const axios = require('axios');

const NR_ENDPOINT =
  process.env.NR_LOGS_ENDPOINT || 'https://log-api.newrelic.com/log/v1';

/**
 * Forward a PingOne event to New Relic Logs API.
 * No-op when NR_LICENSE_KEY is absent. Never throws.
 * @param {object} event — storedEvent from pingoneEventStore
 * @returns {Promise<void>}
 */
async function forward(event) {
  const key = process.env.NR_LICENSE_KEY;
  if (!key) return;

  const payload = [
    {
      common: {
        attributes: {
          source: 'pingone-webhook',
          logtype: 'pingone_event',
        },
      },
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
  ];

  try {
    await axios.post(NR_ENDPOINT, payload, {
      headers: {
        'Api-Key': key,
        'Content-Type': 'application/json',
      },
      timeout: 5000,
    });
  } catch (err) {
    console.warn('[newRelicForwarder] failed to forward event:', err?.message);
  }
}

module.exports = { forward };
