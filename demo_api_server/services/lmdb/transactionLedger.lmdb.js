'use strict';
/**
 * transactionLedger.lmdb.js — durable per-transaction chain of custody.
 *
 * One record per correlationId, holding every hop a request took across the
 * six instrumentable services. This is the PRIMARY witness: the invariant
 * engine (services/transactionInvariants.js) evaluates it, and the reconciler
 * (services/transactionReconciler.js) corroborates it against independently
 * written audit sinks.
 *
 * Keyed by correlationId — NOT by the time-prefixed key mcpAuditStore uses —
 * because hops for one transaction arrive out of order from six services and
 * must merge into a single record. Ordering and eviction therefore do a full
 * range scan, which is why MAX_TRANSACTIONS is deliberately small.
 *
 * Claims only. Never store raw tokens here: this record is presented as an
 * audit trail, unlike teachLogger where token visibility is a teaching feature.
 */
const { getDb } = require('./openEnv');

const DB_NAME = 'transactionLedger';
const MAX_TRANSACTIONS = 500;

function _db() {
  return getDb(DB_NAME); // cached handle, mirrors mcpAuditStore.lmdb.js
}

/**
 * Append a hop to its transaction, creating the record on first hop.
 * @param {string} correlationId
 * @param {object} hop
 * @returns {object} the updated record
 */
function appendHop(correlationId, hop) {
  const db = _db();
  const now = new Date().toISOString();
  const hopTs = hop.ts || now;
  const existing = db.get(correlationId) || null;
  const record = existing || { correlationId, startedAt: hopTs, endedAt: now, hops: [] };

  record.hops.push({ ...hop, seq: record.hops.length + 1, ts: hopTs });
  record.endedAt = now;
  db.putSync(correlationId, record);

  // Only a NEW transaction can push the store over the cap — appending to an
  // existing record leaves the count unchanged, so skip the scan.
  if (!existing) _evict(db);
  return record;
}

function _evict(db) {
  let count;
  try {
    count = db.getStats().entryCount;
  } catch {
    return; // getStats unavailable — skip eviction rather than scan every write
  }
  if (count <= MAX_TRANSACTIONS) return;

  const entries = [];
  for (const { key, value } of db.getRange()) {
    entries.push({ key, startedAt: (value && value.startedAt) || '' });
  }
  entries.sort((a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0));
  for (const e of entries.slice(0, entries.length - MAX_TRANSACTIONS)) db.removeSync(e.key);
}

/**
 * @param {string} correlationId
 * @returns {object|null}
 */
function getRecord(correlationId) {
  const rec = _db().get(correlationId);
  return rec || null;
}

/**
 * Newest-first transaction summaries.
 * @param {object} [opts]
 * @param {number} [opts.limit=100]
 * @returns {object[]} [{ correlationId, startedAt, endedAt, hopCount }]
 */
function listRecords(opts = {}) {
  const limit = Number.isFinite(opts.limit) ? opts.limit : 100;
  const out = [];
  for (const { value } of _db().getRange()) {
    if (!value) continue;
    out.push({
      correlationId: value.correlationId,
      startedAt: value.startedAt,
      endedAt: value.endedAt,
      hopCount: Array.isArray(value.hops) ? value.hops.length : 0,
    });
  }
  out.sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0));
  return out.slice(0, limit);
}

function clear() {
  const db = _db();
  for (const key of db.getKeys()) db.removeSync(key);
}

module.exports = { appendHop, getRecord, listRecords, clear, DB_NAME, MAX_TRANSACTIONS };
