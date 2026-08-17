// davinciEventStore.lmdb.js — durable event stream from the DaVinci showcase flows.
// Same shape/pattern as pingoneEventStore.lmdb.js; separate DB so DaVinci demo
// traffic never mixes with real PingOne console webhook events.
'use strict';
const { getDb } = require('./openEnv');

const DB_NAME = 'davinciEvents';
const MAX_EVENTS = 2000;

function _db() { return getDb(DB_NAME); }

let _seq = 0;
function _makeKey(ms) {
  _seq = (_seq + 1) % 0x10000;
  return `${String(ms).padStart(16, '0')}:${String(_seq).padStart(5, '0')}`;
}

function append(event) {
  const db = _db();
  const ms = Date.now();
  const stored = {
    ...event,
    eventId: event.eventId || `dv-${ms}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: event.timestamp || new Date(ms).toISOString(),
  };
  db.putSync(_makeKey(ms), stored);
  _prune(db);
  return stored;
}

function _prune(db) {
  let count;
  try { count = db.getStats().entryCount; } catch { return; }
  if (count <= MAX_EVENTS) return;
  const excess = count - MAX_EVENTS;
  let removed = 0;
  for (const key of db.getKeys({ limit: excess })) {
    db.removeSync(key);
    if (++removed >= excess) break;
  }
}

function query(filters = {}) {
  const db = _db();
  const limit = Number.isFinite(filters.limit) ? filters.limit : 200;
  const out = [];
  for (const { value } of db.getRange({ reverse: true })) {
    if (filters.eventType && value.eventType !== filters.eventType) continue;
    out.push(value);
    if (out.length >= limit) break;
  }
  return out;
}

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
