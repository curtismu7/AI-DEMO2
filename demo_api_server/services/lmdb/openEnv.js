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

// Hard wall, not a hint: every write past it throws MDB_MAP_FULL at once across
// all named DBs, and data.mdb never shrinks back on its own — so hitting it
// looks like "the whole BFF broke", permanently. Raise only deliberately, after
// measuring per-DB sizes (a compaction may be the actual fix).
const MAP_SIZE = 128 * 1024 * 1024;
const MAP_SIZE_WARN_FRACTION = 0.8;

// Pure so the threshold logic is testable without an 84MB fixture file.
function mapSizeReport(sizeBytes, mapSize = MAP_SIZE) {
  const pct = Math.round((sizeBytes / mapSize) * 100);
  const line = `[lmdb] data.mdb ${(sizeBytes / 1048576).toFixed(1)}MB of ${mapSize / 1048576}MB mapSize (${pct}%)`;
  if (sizeBytes >= mapSize * MAP_SIZE_WARN_FRACTION) {
    return {
      warn: true,
      message: `${line} — approaching MDB_MAP_FULL: at the ceiling every LMDB write path 500s and the file never shrinks. Measure per-DB sizes and prune/compact before raising mapSize.`,
    };
  }
  return { warn: false, message: line };
}

function openEnv() {
  if (_env) return _env;
  fs.mkdirSync(LMDB_PATH, { recursive: true });
  _env = open({
    path: LMDB_PATH,
    maxDbs: 32, // 14 named DBs in use today; banking_accounts/_transactions add 2 when wired in — headroom prevents MDB_DBS_FULL
    mapSize: MAP_SIZE,
    noSync: false,
  });
  try {
    const { size } = fs.statSync(path.join(LMDB_PATH, 'data.mdb'));
    const report = mapSizeReport(size);
    (report.warn ? console.error : console.log)(report.message);
  } catch { /* fresh env — no data.mdb yet */ }
  // Initialize named DBs upfront to reserve them in the environment
  getDb('conversations');
  getDb('navConfigs');
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

module.exports = { openEnv, getDb, closeEnv, LMDB_PATH, mapSizeReport, MAP_SIZE };
