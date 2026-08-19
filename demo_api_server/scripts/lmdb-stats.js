#!/usr/bin/env node
'use strict';
/**
 * lmdb-stats.js — per-named-DB size analysis of the BFF's LMDB env.
 *
 * Usage:
 *   node scripts/lmdb-stats.js [path-to-lmdb-dir]
 *
 * Defaults to data/persistent/lmdb. READ-ONLY — safe against a live store, but
 * for the Docker stack the live store is inside the ai-demo_ai-demo-bff-data
 * volume; copy it out first:
 *   docker cp ai-demo-api-server:/app/data/persistent/lmdb/data.mdb /tmp/lmdb-copy/
 *
 * Written for TECH_DEBT "The LMDB store is at 66% of a hard 128MB ceiling":
 * measured 2026-08-18, the 84.4MB file held only ~21MB of live data — 75% was
 * free/fragmented pages (legacy of the pre-#1976 broken delete). The largest
 * live consumer was `reports` (966 entries, 14.9MB) — now capped in
 * services/lmdb/reportStore.lmdb.js. Compaction: scripts/lmdb-compact.js.
 */

const path = require('path');
const { open } = require('lmdb');

const target = process.argv[2] || path.join(__dirname, '..', 'data', 'persistent', 'lmdb');
const env = open({ path: target, maxDbs: 32, readOnly: true, encoding: 'binary' });

const names = [];
for (const { key } of env.getRange({})) names.push(String(key));
console.log(`store: ${target}`);
console.log(`named DBs (${names.length}): ${names.join(', ') || '(none)'}`);

let grand = 0;
for (const name of names) {
  let count = 0;
  let bytes = 0;
  let largest = 0;
  let largestKey = null;
  try {
    const db = env.openDB(name, { encoding: 'binary' });
    for (const { key, value } of db.getRange({})) {
      count += 1;
      const sz = (value ? value.length : 0) + String(key).length;
      bytes += sz;
      if (sz > largest) { largest = sz; largestKey = String(key).slice(0, 80); }
    }
  } catch (e) {
    console.log(`${name}: scan failed — ${e.message}`);
    continue;
  }
  grand += bytes;
  console.log(
    `${name.padEnd(32)} entries=${String(count).padStart(7)}  ` +
    `${(bytes / 1048576).toFixed(2).padStart(8)}MB  largest=${largest}B  (${largestKey || '-'})`,
  );
}
const fileSize = require('fs').statSync(path.join(target, 'data.mdb')).size;
console.log(`live data ~${(grand / 1048576).toFixed(1)}MB of ${(fileSize / 1048576).toFixed(1)}MB file — ` +
  `the difference is free/fragmented pages (reclaim with scripts/lmdb-compact.js)`);
env.close();
