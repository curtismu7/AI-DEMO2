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
 * Resolve a hop's timestamp: a caller-supplied `ts` is trusted only if it
 * parses to a real date; anything missing or malformed falls back to
 * wall-clock `now` rather than propagating garbage into the record.
 */
function _resolveHopTs(rawTs, now) {
  if (typeof rawTs === 'string' && rawTs && !Number.isNaN(new Date(rawTs).getTime())) {
    return rawTs;
  }
  return now;
}

/** The later of two ISO timestamps, compared as dates (not strings). */
function _laterOf(a, b) {
  return new Date(b) > new Date(a) ? b : a;
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
  const hopTs = _resolveHopTs(hop.ts, now);
  const existing = db.get(correlationId) || null;
  // _insertedAt is internal wall-clock bookkeeping for eviction ordering only
  // — never caller-supplied, never exposed via listRecords/getRecord callers.
  const record = existing || {
    correlationId,
    startedAt: hopTs,
    endedAt: hopTs,
    hops: [],
    principal: null,
    _insertedAt: now,
  };

  record.hops.push({ ...hop, seq: record.hops.length + 1, ts: hopTs });
  // endedAt tracks the latest hop timestamp seen, in the same (logical) clock
  // domain as startedAt, so it can never read earlier than startedAt.
  record.endedAt = _laterOf(record.endedAt, hopTs);
  // principal is the first non-null hop.identity.sub seen for this transaction,
  // set once and never overwritten. Hops arrive out of order from six services;
  // a later hop (possibly a different subject) must not be able to reassign
  // ownership once it has been established.
  if (!record.principal && hop.identity && hop.identity.sub) {
    record.principal = hop.identity.sub;
  }
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
    // _insertedAt (wall-clock, set once at creation) drives eviction order so
    // a caller-supplied startedAt can't make a fresh record look oldest and
    // get evicted before the rest of its hops arrive. Records written before
    // this field existed fall back to startedAt.
    const order = (value && (value._insertedAt || value.startedAt)) || '';
    entries.push({ key, order });
  }
  entries.sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));
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
 * @param {string} [opts.principal] - when supplied, restricts the scan to
 *   records owned by this principal BEFORE `limit` is applied, so `limit`
 *   means "up to N records the caller may see" rather than "up to N records,
 *   then whatever of those happen to be theirs". Omit for an unfiltered
 *   (admin) listing.
 * @returns {object[]} [{ correlationId, startedAt, endedAt, hopCount, principal }]
 */
function listRecords(opts = {}) {
  const limit = Number.isFinite(opts.limit) ? opts.limit : 100;
  const hasPrincipalFilter = Object.prototype.hasOwnProperty.call(opts, 'principal');
  const out = [];
  for (const { value } of _db().getRange()) {
    if (!value) continue;
    if (hasPrincipalFilter && value.principal !== opts.principal) continue;
    out.push({
      correlationId: value.correlationId,
      startedAt: value.startedAt,
      endedAt: value.endedAt,
      hopCount: Array.isArray(value.hops) ? value.hops.length : 0,
      principal: value.principal || null,
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
