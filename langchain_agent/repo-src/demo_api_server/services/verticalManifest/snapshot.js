'use strict';

function createSnapshot(store, overlay, hooks) {
  const { getActiveId, setActiveId, onRestoredId, onRestoredActive } = hooks;

  function save(userId) {
    const overlays = {};
    for (const id of store.listOverlayIds()) {
      overlays[id] = overlay.get(id);
    }
    const savedAt = Date.now();
    store.setSnapshot(userId, { activeId: getActiveId(), overlays, savedAt });
    return savedAt;
  }

  function restore(userId) {
    const snap = store.getSnapshot(userId);
    if (!snap) return { restored: false };

    // Clear current overlays for any id present in the snapshot OR currently
    // overlaid. This wipes ids that were added since the snapshot was taken.
    const allIds = new Set([
      ...Object.keys(snap.overlays || {}),
      ...store.listOverlayIds(),
    ]);
    for (const id of allIds) overlay.clearAll(id);

    // CR-04: write each snapshot overlay through the validated overlay path
    // (replaceRaw runs _validateMerged + bumps the resolver cache version via
    // the wrapped overlay). If a snapshot pre-dates a seed or schema change
    // and produces an invalid merged manifest, skip that id rather than
    // throwing mid-restore. Partial restore beats a 500.
    const skipped = [];
    for (const [id, ov] of Object.entries(snap.overlays || {})) {
      try {
        overlay.replaceRaw(id, ov);
        onRestoredId(id);
      } catch (err) {
        skipped.push({ id, error: err?.message });
      }
    }

    if (snap.activeId) {
      setActiveId(snap.activeId);
      onRestoredActive(snap.activeId);
    }
    return { restored: true, savedAt: snap.savedAt, skipped };
  }

  function peek(userId) {
    const s = store.getSnapshot(userId);
    return s ? { savedAt: s.savedAt } : null;
  }

  function clear(userId) { store.clearSnapshot(userId); }

  return { save, restore, peek, clear };
}

module.exports = { createSnapshot };
