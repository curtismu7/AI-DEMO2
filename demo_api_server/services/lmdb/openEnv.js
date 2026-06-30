'use strict';
const path = require('path');
const fs   = require('fs');
const { open } = require('lmdb');

// Runtime default is the operator's persistent store (credentials/config that
// must survive restarts). Tests override LMDB_PATH to an isolated throwaway dir
// so they never read or write that store — see src/__tests__/setup.js.
const LMDB_PATH = process.env.LMDB_PATH || path.join(__dirname, '../../data/persistent/lmdb');

let _env = null;
const _dbs = {};

function openEnv() {
  if (_env) return _env;
  fs.mkdirSync(LMDB_PATH, { recursive: true });
  _env = open({
    path: LMDB_PATH,
    maxDbs: 32, // 14 named DBs in use today; banking_accounts/_transactions add 2 when wired in — headroom prevents MDB_DBS_FULL
    mapSize: 128 * 1024 * 1024,
    noSync: false,
  });
  // Initialize named DBs upfront to reserve them in the environment
  getDb('conversations');
  return _env;
}

function getDb(name) {
  if (_dbs[name]) return _dbs[name];
  _dbs[name] = openEnv().openDB(name, { encoding: 'json' });
  return _dbs[name];
}

function closeEnv() {
  if (_env) {
    _env.close();
    _env = null;
    for (const k of Object.keys(_dbs)) { delete _dbs[k]; }
  }
}

module.exports = { openEnv, getDb, closeEnv, LMDB_PATH };
