'use strict';

// Verification-only store. Offline topology checks need the manifest resolver,
// but must not open a developer's persistent LMDB environment from a worktree.
// The production path continues to use verticalStore.lmdb.js.
const overlays = new Map();
const snapshots = new Map();
const themes = new Map();
const logos = new Map();
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
  getTheme(id) { return clone(themes.get(id) || null); },
  setTheme(id, value) { themes.set(id, { ...clone(value), savedAt: Date.now() }); },
  clearTheme(id) { themes.delete(id); },
  listThemeIds() { return [...themes.keys()]; },
  getLogo(id) { return clone(logos.get(id) || null); },
  setLogo(id, value) { logos.set(id, { ...clone(value), savedAt: Date.now() }); },
  clearLogo(id) { logos.delete(id); },
  listLogoIds() { return [...logos.keys()]; },
  clearAll() { overlays.clear(); snapshots.clear(); themes.clear(); logos.clear(); activeId = null; },
};
