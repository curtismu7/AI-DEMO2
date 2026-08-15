'use strict';
/**
 * agentLifecycleEventStore.lmdb.js — durable joiner/mover/leaver agent lifecycle events.
 *
 * Persists to LMDB (data/persistent/lmdb/, db 'agentLifecycleEvents').
 * Events are appended by agentLifecycleEvents.emit() at the kill-switch,
 * re-enable, and demo-roster register/reset call sites, and queried by the
 * GET /api/control-plane/lifecycle-events export route.
 *
 * Keys are zero-padded-millis + counter so getRange() is chronological and a
 * reverse scan yields newest-first. Capped at MAX_EVENTS (oldest evicted).
 */
const { getDb } = require('./openEnv');

const DB_NAME = 'agentLifecycleEvents';
const MAX_EVENTS = 2000;

function _db() {
  return getDb(DB_NAME); // cached handle (see openEnv._dbs)
}

// Monotonic suffix so two events in the same millisecond don't collide and
// preserve insertion order. Process-local; combined with the millis prefix it
// is unique enough for a single-writer demo store.
let _seq = 0;

function _makeKey(ms) {
  _seq = (_seq + 1) % 0x10000;
  return `${String(ms).padStart(16, '0')}:${String(_seq).padStart(5, '0')}`;
}

/**
 * Append a lifecycle event. Adds eventId/timestamp when absent. Best-effort
 * prune of the oldest entries beyond MAX_EVENTS.
 * @param {object} event
 * @returns {object} the stored event
 */
function append(event) {
  const db = _db();
  const ms = Date.now();
  const stored = {
    ...event,
    // Spread first so these always win — a caller passing eventId/timestamp as
    // an explicit `undefined` must not clobber the generated fallback.
    eventId: event.eventId || `ale-${ms}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: event.timestamp || new Date(ms).toISOString(),
  };
  db.putSync(_makeKey(ms), stored);
  _prune(db);
  return stored;
}

function _prune(db) {
  let count;
  try {
    count = db.getStats().entryCount;
  } catch {
    return; // getStats unavailable — skip prune rather than scan every write
  }
  if (count <= MAX_EVENTS) return;
  const excess = count - MAX_EVENTS;
  let removed = 0;
  for (const key of db.getKeys({ limit: excess })) {
    db.removeSync(key);
    if (++removed >= excess) break;
  }
}

/**
 * Query events newest-first with optional filters.
 * @param {object} [filters]
 * @param {string} [filters.eventType]  exact match ('joiner'|'mover'|'leaver')
 * @param {string} [filters.agentId]    exact match
 * @param {string} [filters.source]     exact match
 * @param {number} [filters.limit=200]
 * @returns {object[]}
 */
function query(filters = {}) {
  const db = _db();
  const limit = Number.isFinite(filters.limit) ? filters.limit : 200;
  const out = [];
  for (const { value } of db.getRange({ reverse: true })) {
    if (filters.eventType && value.eventType !== filters.eventType) continue;
    if (filters.agentId && value.agentId !== filters.agentId) continue;
    if (filters.source && value.source !== filters.source) continue;
    out.push(value);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Aggregate counts for the summary header.
 * @returns {{ totalEvents: number, byEventType: object }}
 */
function summary() {
  const db = _db();
  const byEventType = {};
  let totalEvents = 0;
  for (const { value } of db.getRange()) {
    totalEvents++;
    const t = value.eventType || 'unknown';
    byEventType[t] = (byEventType[t] || 0) + 1;
  }
  return { totalEvents, byEventType };
}

function clear() {
  const db = _db();
  for (const key of db.getKeys()) db.removeSync(key);
}

module.exports = { append, query, summary, clear, DB_NAME, MAX_EVENTS };
