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
//
// 2026-09-22 measured (post-incident): ~24MB live across all 29 named DBs
// (reports 8.7MB, sessions 6.5MB, pingoneEvents 3.5MB, conversations 2.5MB,
// rest <1MB each). 128MB ≈ 5x live data with per-store caps already in place
// (mcpAudit 5000, pingoneEvents 2000, conversations 500/thread, session TTL
// 24h + hourly prune). Freelist churn from expired sessions can inflate the
// file 10x beyond live bytes, but never beyond the map — 128MB is adequate;
// compaction (scripts/compact-lmdb.sh) reclaims it. Only raise if per-DB
// measurement shows live data actually approaching 100MB.
//
// 2026-09-23: raised 128MB → 512MB after a second ceiling hit killed logins
// mid-session (185MB file / 24MB live — pure freelist churn). The map is
// virtual address space, not allocated RAM; a bigger map only trades disk
// headroom for demo safety. Live data stays ~25MB with the per-store caps,
// so 512MB is ~20x headroom.
const MAP_SIZE = 512 * 1024 * 1024;
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
