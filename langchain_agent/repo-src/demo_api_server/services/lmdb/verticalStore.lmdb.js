'use strict';
/**
 * verticalStore.lmdb.js — LMDB-backed persistence for the vertical-manifest
 * system. Sibling to delegationStore.lmdb.js and demoAccountStore.lmdb.js.
 *
 * Key layout (single LMDB DB named 'verticals'):
 *   overlay:<id>       -> DeepPartial<Manifest>
 *   active             -> string (vertical id)
 *   snapshot:<userId>  -> { activeId, overlays: { id -> overlay }, savedAt }
 *
 * Values stored as JS objects (encoding: 'json'); no manual JSON parsing.
 */
const { openEnv } = require('./openEnv');

const DB_NAME = 'verticals';

function _db() { return openEnv().openDB(DB_NAME, { encoding: 'json' }); }

// ---- Overlay ----

function getOverlay(id) {
  const v = _db().get(`overlay:${id}`);
  return v ? v : {};
}

function setOverlay(id, overlay) {
  _db().putSync(`overlay:${id}`, overlay);
}

function clearOverlay(id) {
  _db().removeSync(`overlay:${id}`);
}

function listOverlayIds() {
  const ids = [];
  for (const { key, value } of _db().getRange({ start: 'overlay:', end: 'overlay;' })) {
    // Skip overlays that are empty objects — they don't represent a real override.
    if (value && typeof value === 'object' && Object.keys(value).length > 0) {
      ids.push(key.slice('overlay:'.length));
    }
  }
  return ids;
}

// ---- Active vertical ----

function getActiveId() {
  const v = _db().get('active');
  return v ? v : null;
}

function setActiveId(id) {
  _db().putSync('active', id);
}

// ---- Snapshots ----

function getSnapshot(userId) {
  const v = _db().get(`snapshot:${userId}`);
  return v ? v : null;
}

function setSnapshot(userId, snap) {
  _db().putSync(`snapshot:${userId}`, snap);
}

function clearSnapshot(userId) {
  _db().removeSync(`snapshot:${userId}`);
}

// ---- Wipe (used by tests) ----

function clearAll() {
  const db = _db();
  const keys = [];
  for (const { key } of db.getRange()) keys.push(key);
  for (const key of keys) db.removeSync(key);
}

module.exports = {
  getOverlay, setOverlay, clearOverlay, listOverlayIds,
  getActiveId, setActiveId,
  getSnapshot, setSnapshot, clearSnapshot,
  clearAll,
};
