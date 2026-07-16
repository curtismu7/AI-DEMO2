// banking_api_server/services/exchangeAuditStore.js
/**
 * In-memory token-exchange audit log (ring buffer).
 * Uses push + slice-from-end for O(1) insertions (avoids unshift's O(n) cost).
 */
'use strict';

const MAX_EVENTS = 200;
const _events = [];

/**
 * Write a token-exchange audit event to the in-memory ring buffer.
 * @param {object} event  Arbitrary object; `timestamp` is added if absent.
 */
async function writeExchangeEvent(event) {
  _events.push({
    ...event,
    timestamp: event.timestamp || new Date().toISOString(),
  });
  // Trim from the front (oldest) when over capacity
  if (_events.length > MAX_EVENTS) _events.splice(0, _events.length - MAX_EVENTS);
}

/**
 * Read up to `limit` most-recent exchange events (newest first).
 * @param {number} [limit=200]
 * @returns {Promise<object[]>}
 */
async function readExchangeEvents(limit = MAX_EVENTS) {
  // Return newest first (reverse of insertion order)
  const start = Math.max(0, _events.length - limit);
  return _events.slice(start).reverse();
}

module.exports = { writeExchangeEvent, readExchangeEvents };
