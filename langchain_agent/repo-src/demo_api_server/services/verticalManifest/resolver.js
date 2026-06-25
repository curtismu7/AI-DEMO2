'use strict';

const mergeWith = require('lodash.mergewith');
const { ManifestSchema } = require('./schema');

// CR-01 bridge: the legacy `active_vertical` configStore key is still read by
// routes/accounts.js, routes/oauthUser.js, and data/store.js for account
// reseeding. We mirror the new LMDB active id into configStore on every
// setActive() so those legacy reads see the same value, and fall back to
// configStore on read when LMDB is empty (fresh installs / first boot).
let _configStore = null;
function _getConfigStore() {
  if (_configStore !== null) return _configStore;
  try { _configStore = require('../configStore'); }
  catch (_) { _configStore = false; }
  return _configStore;
}

function arrayCustomizer(_, src) {
  if (Array.isArray(src)) return src;
}

/**
 * createResolver — deep-merges seed + overlay into a fully validated manifest,
 * caches per (id, overlayVersion), owns the active-id getter/setter, and wraps
 * the overlay so every mutation also bumps the cache version and fires onEvent.
 *
 * @param {object} loader  — has .get(id) => { manifest, mockData } | null
 * @param {object} overlay — raw overlay created by createOverlay(store, loader)
 * @param {object} store   — verticalStore.lmdb module (for activeId)
 * @param {object} opts
 * @param {function} opts.onEvent  — (type: string, payload: object) => void
 */
function createResolver(loader, overlay, store, { onEvent } = { onEvent: () => {} }) {
  // Cache key: id; value: { version, merged }
  const cache = new Map();
  // Per-id version counter; bumped on every overlay write or loader reload.
  const versions = new Map();

  function _bump(id) {
    versions.set(id, (versions.get(id) || 0) + 1);
    cache.delete(id);
  }

  // Wrap overlay mutators so the resolver cache invalidates and events fire.
  // Consumers should use resolver.overlay.* — NOT the bare overlay passed in.
  const wrappedOverlay = {
    get(id) { return overlay.get(id); },
    list(id) { return overlay.list(id); },
    setField(id, path, value) {
      overlay.setField(id, path, value);
      _bump(id);
      onEvent('vertical-edited', { id });
    },
    setBatch(id, entries) {
      overlay.setBatch(id, entries);
      _bump(id);
      onEvent('vertical-edited', { id });
    },
    replaceBatch(id, entries) {
      overlay.replaceBatch(id, entries);
      _bump(id);
      onEvent('vertical-edited', { id });
    },
    replaceRaw(id, overlayBlob) {
      overlay.replaceRaw(id, overlayBlob);
      _bump(id);
      onEvent('vertical-edited', { id });
    },
    clearField(id, path) {
      overlay.clearField(id, path);
      _bump(id);
      onEvent('vertical-edited', { id });
    },
    clearAll(id) {
      overlay.clearAll(id);
      _bump(id);
      onEvent('vertical-edited', { id });
    },
  };

  function resolve(id) {
    const seed = loader.get(id);
    if (!seed) return null;

    const ver = versions.get(id) || 0;
    const cached = cache.get(id);
    if (cached && cached.version === ver) {
      // Clone so caller mutations don't poison the cache. structuredClone is
      // faster than JSON round-trip and the manifest is plain JSON data.
      return structuredClone(cached.merged);
    }

    const overlayValue = overlay.get(id);
    const merged = mergeWith({}, seed.manifest, overlayValue, arrayCustomizer);
    // Force id and schemaVersion — overlay cannot change them.
    merged.id = seed.manifest.id;
    merged.schemaVersion = 3;
    // Ensure scopes is at least {} so Zod parses inner field defaults (read/write/transfer).
    // When scopes is absent, Zod's outer .default({}) returns {} without running
    // inner field defaults; passing {} explicitly triggers them.
    if (merged.scopes === undefined || merged.scopes === null) merged.scopes = {};
    const parsed = ManifestSchema.parse(merged); // applies defaults (e.g. scopes)

    cache.set(id, { version: ver, merged: parsed });
    return structuredClone(parsed);
  }

  function reload(id) {
    loader.reload(id);
    _bump(id);
  }

  function removeFromCache(id) {
    cache.delete(id);
    versions.delete(id);
    if (typeof loader.removeFromCache === 'function') loader.removeFromCache(id);
  }

  function activeId() {
    const lmdbValue = store.getActiveId();
    if (lmdbValue) return lmdbValue;
    // Bridge: read configStore as fallback so fresh installs (where LMDB is
    // empty but configStore has 'banking' as the implicit default) don't
    // disagree with routes/accounts.js / data/store.js / routes/oauthUser.js.
    const cs = _getConfigStore();
    if (cs && typeof cs.getEffective === 'function') {
      const csValue = cs.getEffective('active_vertical');
      if (csValue) return csValue;
    }
    return null;
  }

  /**
   * Session-scoped active vertical. A per-session preference
   * (req.session.active_vertical) takes precedence over the process-global
   * activeId(), so one session switching its vertical can't change another
   * session's — the "a banking screen stays banking regardless of what another
   * session set" invariant. Falls back to the global for sessions that never
   * switched. Pass the Express req; non-request contexts (SSE init, startup)
   * keep using the bare global activeId().
   */
  function activeIdFor(req) {
    const sessVal = req && req.session && req.session.active_vertical;
    if (sessVal) return sessVal;
    return activeId();
  }

  function setActive(id) {
    store.setActiveId(id);
    // Mirror to configStore so the 3 legacy reads stay in sync.
    const cs = _getConfigStore();
    if (cs && typeof cs.setConfig === 'function') {
      try { cs.setConfig({ active_vertical: id }); } catch (_) { /* ignore */ }
    }
    onEvent('vertical-switched', { activeId: id });
  }

  return { resolve, reload, removeFromCache, activeId, activeIdFor, setActive, overlay: wrappedOverlay, loader };
}

module.exports = { createResolver };
