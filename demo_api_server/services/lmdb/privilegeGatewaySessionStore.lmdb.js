'use strict';
/**
 * privilegeGatewaySessionStore.lmdb.js — the façade's Privilege AI Gateway
 * sessions, persisted so a BFF container recreate does not throw them away.
 *
 * One key per Agentic App (e.g. `opensearch22`); the value is the record
 * services/privilegeGatewaySession.js keeps in memory. See that module for why
 * a gateway token is stored at all.
 */
const { getDb } = require('./openEnv');

const DB_NAME = 'privilegeGatewaySessions';

function _db() { return getDb(DB_NAME); }

/** Every stored session, keyed by app. */
function loadAll() {
  const out = {};
  for (const { key, value } of _db().getRange()) out[key] = value;
  return out;
}

function save(app, record) {
  _db().putSync(app, record);
}

function remove(app) {
  _db().removeSync(app);
}

module.exports = { loadAll, save, remove, DB_NAME };
