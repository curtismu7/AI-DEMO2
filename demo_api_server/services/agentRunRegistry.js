'use strict';

const crypto = require('crypto');
const { getDb } = require('./lmdb/openEnv');

const DB_NAME = 'agentRuns';
// Safety net for a crashed process that never reaches endRun — matches the
// TTL approach killSwitchService already uses for the revoked flag.
const RUN_TTL_MS = 30 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

let _cleanupStarted = false;
function _startCleanup() {
  if (_cleanupStarted) return;
  _cleanupStarted = true;
  const interval = setInterval(() => {
    const db = getDb(DB_NAME);
    const now = Date.now();
    for (const { key, value } of db.getRange()) {
      if (value.expiresAt <= now) db.removeSync(key);
    }
  }, CLEANUP_INTERVAL_MS);
  if (interval.unref) interval.unref();
}

/**
 * Record that a tool call started, for the kill-switch confirm modal's
 * active-run list. Best-effort: an LMDB write failure here must never block
 * the tool call itself (see error-handling note in the design spec), so
 * this never throws — it returns null on failure, which endRun treats as a
 * safe no-op.
 * @param {string} agentKey - from sessionKeyService.deriveAgentKey
 * @param {{tool: string, userId: string|null}} info
 * @returns {string|null} runId, or null if the write failed
 */
function startRun(agentKey, { tool, userId }) {
  try {
    _startCleanup();
    const runId = crypto.randomUUID();
    const startedAt = Date.now();
    getDb(DB_NAME).putSync(runId, { agentKey, tool, userId: userId || null, startedAt, expiresAt: startedAt + RUN_TTL_MS });
    return runId;
  } catch (_e) {
    return null;
  }
}

/**
 * @param {string|null} runId
 */
function endRun(runId) {
  if (!runId) return;
  try {
    getDb(DB_NAME).removeSync(runId);
  } catch (_e) {
    // Unknown/already-removed runId, or a store error — safe no-op, never throws into a tool call.
  }
}

/**
 * @param {string} agentKey
 * @returns {Array<{runId: string, tool: string, userId: string|null, startedAt: number}>}
 */
function listActiveRuns(agentKey) {
  const db = getDb(DB_NAME);
  const now = Date.now();
  const out = [];
  for (const { key, value } of db.getRange()) {
    if (value.expiresAt <= now) continue;
    if (value.agentKey !== agentKey) continue;
    out.push({ runId: key, tool: value.tool, userId: value.userId, startedAt: value.startedAt });
  }
  out.sort((a, b) => b.startedAt - a.startedAt);
  return out;
}

module.exports = { startRun, endRun, listActiveRuns };
