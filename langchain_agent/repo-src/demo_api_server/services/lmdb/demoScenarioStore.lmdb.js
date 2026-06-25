'use strict';
/**
 * demoScenarioStore.lmdb.js — LMDB persistence for per-user demo scenario state
 * (MFA step-up threshold, bankingAgentUiMode, etc.), backing
 * services/demoScenarioStore.js.
 *
 * Key layout (single LMDB DB named 'demo_scenarios'):
 *   demo-scenario:<userId> -> scenario object
 */
const { openEnv } = require('./openEnv');

const DB_NAME = 'demo_scenarios';

function _db() { return openEnv().openDB(DB_NAME, { encoding: 'json' }); }

function get(scenarioKey) { return _db().get(scenarioKey) || null; }
function put(scenarioKey, value) { _db().putSync(scenarioKey, value); }

function clearAll() {
  const db = _db();
  const keys = [];
  for (const { key } of db.getRange()) keys.push(key);
  for (const key of keys) db.removeSync(key);
}

module.exports = { get, put, clearAll };
