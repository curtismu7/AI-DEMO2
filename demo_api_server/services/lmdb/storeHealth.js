'use strict';
/**
 * storeHealth.js — process-wide LMDB store health, surfaced to operators.
 *
 * 2026-09-22 incident: data.mdb hit its 128MB mapSize ceiling from freelist
 * churn (24MB live / 237MB file) and session writes were silently lost —
 * the login loop was traced hours later. Protections added here:
 *
 * 1. setWriteError(err) — called by store write paths on LMDB failure.
 *    Marks the store unhealthy and logs at ERROR so it cannot scroll by
 *    unnoticed (the startup-only mapSize watcher wasn't enough).
 * 2. clearWriteError() — successful write resets the flag (auto-recovery).
 * 3. snapshot() — { healthy, lastError, lastErrorAt, dataMdbBytes,
 *    dataMdbPctOfMap } consumed by GET /api/health/demo-status.
 */

const fs = require('fs');
const path = require('path');
const { LMDB_PATH } = require('./openEnv');

let lastError = null; // { message, at }
const _startedAt = Date.now();

/** @param {Error | string} err */
function setWriteError(err) {
  const message = err && err.message ? err.message : String(err);
  const now = new Date().toISOString();
  // Log every transition, but don't spam identical errors more than once a minute.
  const isDuplicateWithinWindow =
    lastError && lastError.message === message &&
    (Date.now() - new Date(lastError.at).getTime()) < 60000;
  lastError = { message, at: new Date().toISOString() };
  if (!isDuplicateWithinWindow) {
    console.error(
      '[lmdb] Session/LMDB WRITE FAILED — sessions may be silently lost until fixed:',
      message,
      '| Run scripts/compact-lmdb.sh or raise mapSize (services/lmdb/openEnv.js).',
    );
  }
}

function clearWriteError() {
  if (lastError) lastError = null;
}

/** True when a write has failed since the last successful write. */
function isUnhealthy() {
  return lastError != null;
}

function snapshot() {
  let dataMdbBytes = null;
  try {
    dataMdbBytes = fs.statSync(path.join(LMDB_PATH, 'data.mdb')).size;
  } catch { /* fresh env — no file yet */ }
  return {
    healthy: lastError == null,
    lastError: lastError ? lastError.message : null,
    lastErrorAt: lastError ? lastError.at : null,
    dataMdbBytes,
  };
}

module.exports = { setWriteError, clearWriteError, isUnhealthy, snapshot };
