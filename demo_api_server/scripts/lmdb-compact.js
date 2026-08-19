#!/usr/bin/env node
'use strict';
/**
 * lmdb-compact.js — copy-compact an LMDB env into a fresh directory.
 *
 * Usage:
 *   node scripts/lmdb-compact.js <source-lmdb-dir> <target-dir>
 *
 * The target directory is created (must not already contain a data.mdb).
 * Compaction is COPY-based: the source is opened read-only and never touched,
 * so this is safe against a copy or a stopped store. To compact the Docker
 * stack's live store (volume ai-demo_ai-demo-bff-data):
 *
 *   1. docker compose stop demo-api-server
 *   2. docker cp ai-demo-api-server:/app/data/persistent/lmdb /tmp/lmdb-live
 *   3. node scripts/lmdb-compact.js /tmp/lmdb-live /tmp/lmdb-compacted
 *   4. docker cp /tmp/lmdb-compacted/data.mdb ai-demo-api-server:/app/data/persistent/lmdb/data.mdb
 *   5. docker compose start demo-api-server  — the startup watcher (openEnv)
 *      logs the new size; verify it dropped before calling this done.
 *
 * Measured 2026-08-18: 84.4MB -> 29.5MB (65% reclaimed); only ~21MB was live.
 */

const fs = require('fs');
const path = require('path');
const { open } = require('lmdb');

const [src, out] = process.argv.slice(2);
if (!src || !out) {
  console.error('usage: node scripts/lmdb-compact.js <source-lmdb-dir> <target-dir>');
  process.exit(1);
}
if (fs.existsSync(path.join(out, 'data.mdb'))) {
  console.error(`refusing: ${out}/data.mdb already exists — pick an empty target`);
  process.exit(1);
}
fs.mkdirSync(out, { recursive: true });

const env = open({ path: src, maxDbs: 32, readOnly: true, encoding: 'binary' });
env.backup(out, true).then(() => {
  const before = fs.statSync(path.join(src, 'data.mdb')).size;
  const after = fs.statSync(path.join(out, 'data.mdb')).size;
  console.log(
    `compacted ${src} -> ${out}: ` +
    `${(before / 1048576).toFixed(1)}MB -> ${(after / 1048576).toFixed(1)}MB ` +
    `(${Math.round((1 - after / before) * 100)}% reclaimed)`,
  );
  env.close();
}).catch((e) => {
  console.error('compaction failed:', e.message);
  process.exit(1);
});
