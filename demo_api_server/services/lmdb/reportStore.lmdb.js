'use strict';
/**
 * reportStore.lmdb.js — LMDB-backed report history persistence.
 *
 * Stores run metadata for agent invocations:
 *   - Key: `${userId}:${runId}` (enables prefix scan per user)
 *   - Value: { runId, userId, vertical, prompt, startedAt, completedAt,
 *              toolsCalled[], tokenEvents[], tokenCount, files[], ... }
 *
 * Pattern mirrors configStore.lmdb.js.
 */

const { getDb } = require('./openEnv');

const DB_NAME = 'reports';

// A single chat turn can reach more than one recorder (the dashboard NL route
// records every vertical's run, and non-banking turns also flow through
// /agent/invoke). Collapse those into one entry by reusing a very-recent run's
// id for the same user+vertical. Field-independent on purpose: the two routes
// populate prompt/intent differently, so we key on user+vertical+time only.
const DEDUP_WINDOW_MS = 5000;

// Reports were the largest live consumer of the shared 128MB LMDB env and the
// only store with NO prune (measured 2026-08-18: 966 runs = 14.9MB of ~21MB
// total live data). Same pattern as conversationStore's per-thread cap: on each
// genuinely-new run, drop the oldest runs past the ceiling. ~16KB average per
// run keeps the steady state near 8MB.
const MAX_REPORT_RUNS = 500;

function _db() {
  return getDb(DB_NAME);
}

function _pruneIfNeeded(db) {
  const all = [];
  for (const { key, value } of db.getRange()) {
    all.push({ key, at: (value && (value.startedAt || value.savedAt)) || '' });
  }
  if (all.length <= MAX_REPORT_RUNS) return;
  // Oldest first; ISO timestamps sort lexicographically.
  all.sort((a, b) => a.at.localeCompare(b.at));
  for (const { key } of all.slice(0, all.length - MAX_REPORT_RUNS)) {
    db.removeSync(key);
  }
}

function saveRun(record) {
  const db = _db();
  let runId = record.runId;
  // Only de-dupe genuinely new runs — never a re-save (appendFile), which must
  // write back to its own existing key.
  const isNew = db.get(`${record.userId}:${runId}`) === undefined;
  if (isNew && record.userId && record.vertical && record.startedAt) {
    const startMs = Date.parse(record.startedAt);
    for (const { value } of db.getRange({
      start: `${record.userId}:`,
      end: `${record.userId}:￿`,
    })) {
      if (!value || value.runId === record.runId) continue;
      if (value.vertical !== record.vertical) continue;
      const t = Date.parse(value.startedAt || value.savedAt || '');
      if (!t || Math.abs(startMs - t) > DEDUP_WINDOW_MS) continue;
      runId = value.runId; // last-writer-wins: richer record overwrites the lighter one
      break;
    }
  }
  db.putSync(`${record.userId}:${runId}`, {
    ...record,
    runId,
    savedAt: new Date().toISOString(),
  });
  // Only a NEW run can grow the store past the cap; a re-save (appendFile)
  // overwrites in place and must never trigger deletions mid-append.
  if (isNew) _pruneIfNeeded(db);
}

function getRun(userId, runId) {
  const key = `${userId}:${runId}`;
  return _db().get(key) || null;
}

function listRuns(userId, { since, until, limit = 50 } = {}) {
  const results = [];
  const db = _db();

  // Prefix scan: `userId:` ... `userId:￿` (highest unicode). runId is a random
  // UUID, so key order is unrelated to time — collect every match, sort by
  // startedAt, THEN cap. Capping mid-scan would drop the newest runs whenever a
  // user has more than `limit` of them.
  for (const { key, value } of db.getRange({
    start: `${userId}:`,
    end: `${userId}:￿`,
  })) {
    if (since && value.startedAt < since) continue;
    if (until && value.startedAt > until) continue;
    results.push(value);
  }

  // Sort descending by startedAt (newest first), then take the newest `limit`.
  return results
    .sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''))
    .slice(0, limit);
}

function listAllRuns({ since, until, vertical, limit = 500 } = {}) {
  const results = [];
  const db = _db();

  // Full scan (admin only). Collect every match, sort by startedAt, THEN cap —
  // keys order by random runId, so a mid-scan cap would drop the newest runs.
  for (const { key, value } of db.getRange()) {
    if (since && value.startedAt < since) continue;
    if (until && value.startedAt > until) continue;
    if (vertical && value.vertical !== vertical) continue;
    results.push(value);
  }

  return results
    .sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''))
    .slice(0, limit);
}

// Resolve a run by runId regardless of which user owns it. Reports are a
// shared demo artifact list, so the page lists and downloads them across the
// identity churn (reseeds, different demo logins, vertical switching) that
// would otherwise strand a report under a no-longer-active sub.
function findRun(runId) {
  const db = _db();
  for (const { value } of db.getRange()) {
    if (value && value.runId === runId) return value;
  }
  return null;
}

function appendFile(userId, runId, fileEntry) {
  const run = getRun(userId, runId);
  if (!run) return null;

  run.files = run.files || [];
  run.files.push(fileEntry);
  saveRun(run);

  return run;
}

module.exports = { saveRun, getRun, findRun, listRuns, listAllRuns, appendFile };
