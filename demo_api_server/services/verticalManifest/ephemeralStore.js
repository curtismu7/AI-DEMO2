'use strict';

// Verification-only store. Offline topology checks need the manifest resolver,
// but must not open a developer's persistent LMDB environment from a worktree.
// The production path continues to use verticalStore.lmdb.js.
const overlays = new Map();
const snapshots = new Map();
let activeId = null;

const clone = (value) => (value == null ? value : structuredClone(value));

module.exports = {
  getOverlay(id) { return clone(overlays.get(id) || {}); },
  setOverlay(id, value) { overlays.set(id, clone(value)); },
  clearOverlay(id) { overlays.delete(id); },
  listOverlayIds() { return [...overlays.entries()].filter(([, value]) => Object.keys(value || {}).length > 0).map(([id]) => id); },
  getActiveId() { return activeId; },
  setActiveId(id) { activeId = id; },
  getSnapshot(userId) { return clone(snapshots.get(userId) || null); },
  setSnapshot(userId, value) { snapshots.set(userId, clone(value)); },
  clearSnapshot(userId) { snapshots.delete(userId); },
  clearAll() { overlays.clear(); snapshots.clear(); activeId = null; },
};
