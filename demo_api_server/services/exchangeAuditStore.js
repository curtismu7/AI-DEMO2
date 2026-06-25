// banking_api_server/services/exchangeAuditStore.js
/**
 * In-memory token-exchange audit log (ring buffer).
 */
'use strict';

const MAX_EVENTS = 200;
const _events = [];

/**
 * Write a token-exchange audit event to the in-memory ring buffer.
 * @param {object} event  Arbitrary object; `timestamp` is added if absent.
 */
async function writeExchangeEvent(event) {
  _events.unshift({
    ...event,
    timestamp: event.timestamp || new Date().toISOString(),
  });
  if (_events.length > MAX_EVENTS) _events.length = MAX_EVENTS;
}

/**
 * Read up to `limit` most-recent exchange events (newest first).
 * @param {number} [limit=200]
 * @returns {Promise<object[]>}
 */
async function readExchangeEvents(limit = MAX_EVENTS) {
  return _events.slice(0, Math.min(limit, _events.length));
}

module.exports = { writeExchangeEvent, readExchangeEvents };
