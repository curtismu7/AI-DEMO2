// banking_api_server/services/demoScenarioStore.js
/**
 * Per-user demo scenario: MFA step-up threshold, bankingAgentUiMode, etc.
 * Backed by LMDB (services/lmdb/demoScenarioStore.lmdb.js) so a user's scenario
 * survives a restart; the in-memory Map is just a read-through cache.
 */
'use strict';

const lmdb = require('./lmdb/demoScenarioStore.lmdb');

const memory = new Map();
const MAX_CACHE_SIZE = 500; // Prevent unbounded growth

function key(userId) {
  return `demo-scenario:${userId}`;
}

function _evictOldest() {
  if (memory.size <= MAX_CACHE_SIZE) return;
  // Evict the first (oldest-inserted) entry
  const firstKey = memory.keys().next().value;
  if (firstKey !== undefined) memory.delete(firstKey);
}

function isPersistenceConfigured() {
  return true;
}

/**
 * Load demo scenario for a user. Cache miss falls back to LMDB (lazy hydrate),
 * so scenarios saved before a restart are restored on first access.
 */
async function load(userId) {
  if (!userId) return { stepUpAmountThreshold: null };
  const cached = memory.get(userId);
  if (cached) return cached;

  const persisted = lmdb.get(key(userId));
  const value = persisted || { stepUpAmountThreshold: null };
  _evictOldest();
  memory.set(userId, value);
  return value;
}

/**
 * Merge patch and persist (memory + LMDB).
 */
async function save(userId, patch) {
  const prev = await load(userId);
  const next = { ...prev, ...patch, updatedAt: new Date().toISOString() };
  _evictOldest();
  memory.set(userId, next);
  if (userId) lmdb.put(key(userId), next);
  return next;
}

/**
 * Effective step-up threshold for transfers/withdrawals (USD). Falls back to runtime default.
 */
async function getStepUpThreshold(userId, runtimeDefault) {
  const s = await load(userId);
  const v = s.stepUpAmountThreshold;
  if (v == null || v === '') return runtimeDefault;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : runtimeDefault;
}

module.exports = {
  load,
  save,
  getStepUpThreshold,
  isPersistenceConfigured,
};
