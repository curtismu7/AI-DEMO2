'use strict';
/**
 * autonomousRunStore.lmdb.js — durable record of runs that happened with nobody watching.
 *
 * Persists to LMDB (data/persistent/lmdb/, db 'autonomousRuns'). Written by the
 * scheduled jobs in autonomousAgentScheduler.js, read by
 * GET /api/autonomous-runs so the Token Chain rail can replay a run the browser
 * was never present for.
 *
 * Why a store of its own rather than the transaction ledger: the ledger records
 * chain-of-custody hops for a *transaction*, and a read-only scan moves no
 * money. Writing fake hops there to get replay would misrepresent the ledger.
 * A run is its own thing — what ran, when, on whose identity, what it found,
 * and the token events that prove how it authenticated.
 *
 * Keys are zero-padded-millis + counter so getRange() is chronological and a
 * reverse scan yields newest-first. Capped at MAX_RUNS (oldest evicted).
 */
const { getDb } = require('./openEnv');

const DB_NAME = 'autonomousRuns';
const MAX_RUNS = 200;

function _db() {
  return getDb(DB_NAME); // cached handle (see openEnv._dbs)
}

// Monotonic suffix so two runs in the same millisecond don't collide and
// preserve insertion order. Process-local; combined with the millis prefix it
// is unique enough for a single-writer demo store.
let _seq = 0;

function _makeKey(ms) {
  _seq = (_seq + 1) % 0x10000;
  return `${String(ms).padStart(16, '0')}:${String(_seq).padStart(5, '0')}`;
}

/**
 * Record a completed (or failed) unattended run.
 * @param {object} run
 *   - job {string}          job id, e.g. 'fraud-watch'
 *   - agent {string}        the agent identity the run authenticated as
 *   - status {string}       'completed' | 'failed'
 *   - trigger {string}      what fired it, e.g. 'cron 0 2 * * *'
 *   - findings {Array}      what the job found (may be empty)
 *   - tokenEvents {Array}   rail-shaped token events proving the identity path
 *   - error {string=}       message when status is 'failed'
 * @returns {object} the stored run, including its generated runId
 */
function append(run) {
  const db = _db();
  const ms = Date.now();
  const stored = {
    ...run,
    // Spread first so these always win — a caller passing runId/startedAt as an
    // explicit `undefined` must not clobber the generated fallback.
    runId: run.runId || `aur-${ms}-${Math.random().toString(36).slice(2, 8)}`,
    startedAt: run.startedAt || new Date(ms).toISOString(),
  };
  db.putSync(_makeKey(ms), stored);
  _evict(db);
  return stored;
}

function _evict(db) {
  let count;
  try {
    count = db.getStats().entryCount;
  } catch {
    return; // getStats unavailable — skip eviction rather than scan every write
  }
  if (count <= MAX_RUNS) return;
  let over = count - MAX_RUNS;
  for (const { key } of db.getRange()) {
    if (over-- <= 0) break;
    db.removeSync(key);
  }
}

/**
 * Newest-first list of stored runs.
 * @param {number} limit
 * @returns {Array<object>}
 */
function list(limit = 50) {
  const db = _db();
  const out = [];
  for (const { value } of db.getRange({ reverse: true })) {
    out.push(value);
    if (out.length >= limit) break;
  }
  return out;
}

/** One run by its runId, or null. */
function get(runId) {
  if (!runId) return null;
  for (const { value } of _db().getRange({ reverse: true })) {
    if (value && value.runId === runId) return value;
  }
  return null;
}

/**
 * Patch a stored run in place, keeping its key (and so its position in the
 * chronological range). A parked run is resumed, denied or expired long after
 * it was written, and re-appending would make one run look like two.
 *
 * @param {string} runId
 * @param {object} patch shallow-merged over the stored run
 * @returns {object|null} the updated run, or null if there is no such run
 */
function update(runId, patch) {
  if (!runId) return null;
  const db = _db();
  for (const { key, value } of db.getRange({ reverse: true })) {
    if (value && value.runId === runId) {
      const next = { ...value, ...patch };
      db.putSync(key, next);
      return next;
    }
  }
  return null;
}

/** Test/reset helper — drops every stored run. */
function clear() {
  const db = _db();
  for (const { key } of db.getRange()) db.removeSync(key);
}

module.exports = { append, list, get, update, clear, DB_NAME, MAX_RUNS };
