'use strict';

/**
 * Timestamped backups + atomic writes for Agent Gateway JSON files.
 *
 * Mirrors the rotation used by demo_api_server/data/store.js: copy the current
 * file into a sibling `.backups/` dir before overwriting, keep the newest N,
 * and write via a temp file + rename so a crash can never leave a half-written
 * config that IG would then fail to load.
 */

const fs = require('fs');
const path = require('path');

const MAX_BACKUPS = Number(process.env.AGENT_GW_MAX_BACKUPS || 5);

function backupsDirFor(absPath) {
  return path.join(path.dirname(absPath), '.backups');
}

/** ISO timestamp safe for filenames: 2026-07-01T11-05-28-884Z. */
function fsTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/**
 * Copy the existing file to `.backups/<id>-<ts>.json`, pruning old backups for
 * this id. No-op if the file doesn't exist yet. Returns the backup path or null.
 */
function createBackup(entry) {
  const { absPath, id } = entry;
  if (!fs.existsSync(absPath)) return null;

  const dir = backupsDirFor(absPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const safeId = id.replace(/[^a-zA-Z0-9._-]/g, '_');
  const backupPath = path.join(dir, `${safeId}-${fsTimestamp()}.json`);
  fs.copyFileSync(absPath, backupPath);

  // Rotate: keep the newest MAX_BACKUPS for this id.
  const prefix = `${safeId}-`;
  const mine = fs.readdirSync(dir)
    .filter((f) => f.startsWith(prefix))
    .sort(); // ISO timestamps sort chronologically
  while (mine.length > MAX_BACKUPS) {
    const oldest = mine.shift();
    try { fs.unlinkSync(path.join(dir, oldest)); } catch { /* best-effort */ }
  }
  return backupPath;
}

/** Atomically write `content` to the entry's file (temp + rename). */
function writeAtomic(entry, content) {
  const { absPath } = entry;
  const tmpPath = `${absPath}.tmp-${process.pid}`;
  fs.writeFileSync(tmpPath, content, 'utf8');
  fs.renameSync(tmpPath, absPath);
}

module.exports = { createBackup, writeAtomic };
