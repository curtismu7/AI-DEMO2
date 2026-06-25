'use strict';

const mergeWith = require('lodash.mergewith');
const { ManifestSchema } = require('./schema');

// Safe dot-notation path setter. Rejects __proto__ / constructor / prototype
// segments to prevent prototype pollution.
function safeSet(obj, path, value) {
  const parts = String(path).split('.');
  for (const p of parts) {
    if (p === '__proto__' || p === 'constructor' || p === 'prototype') {
      throw new Error(`Unsafe path segment rejected: ${p}`);
    }
  }
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') {
      cur[parts[i]] = {};
    }
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

function arrayCustomizer(_, src) {
  if (Array.isArray(src)) return src;
}

// Walk a nested object and return all leaf paths (dot notation).
function leafPaths(obj, prefix) {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      out.push(...leafPaths(v, p));
    } else {
      out.push(p);
    }
  }
  return out;
}

// Remove `path` from obj; returns true if removed; cleans up empty parent objects.
function deletePath(obj, path) {
  const parts = path.split('.');
  let cur = obj;
  const stack = [obj];
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') return false;
    cur = cur[parts[i]];
    stack.push(cur);
  }
  const last = parts[parts.length - 1];
  if (!(last in cur)) return false;
  delete cur[last];
  for (let i = stack.length - 1; i > 0; i--) {
    if (Object.keys(stack[i]).length === 0) {
      delete stack[i - 1][parts[i - 1]];
    } else break;
  }
  return true;
}

function createOverlay(store, loader) {
  function get(id) { return store.getOverlay(id); }

  function _validateMerged(id, overlay) {
    const seed = loader.get(id);
    if (!seed) throw new Error(`No seed for id ${id}`);
    const merged = mergeWith({}, seed.manifest, overlay, arrayCustomizer);
    // Force id and schemaVersion to the seed values; overlay can't change them.
    merged.id = seed.manifest.id;
    merged.schemaVersion = 3;
    const res = ManifestSchema.safeParse(merged);
    if (!res.success) {
      throw new Error(`Overlay produces invalid manifest: ${JSON.stringify(res.error.issues)}`);
    }
  }

  function setField(id, path, value) {
    const current = get(id);
    safeSet(current, path, value);
    _validateMerged(id, current);
    store.setOverlay(id, current);
  }

  function setBatch(id, entries) {
    const current = get(id);
    for (const { path, value } of entries) {
      safeSet(current, path, value);
    }
    _validateMerged(id, current);
    store.setOverlay(id, current);
  }

  // Replace semantics: the overlay becomes EXACTLY `entries` (built fresh), so a
  // field present before but absent from `entries` is dropped. The editor sends
  // the full diff(seed, edited) here, so editing a field back to its seed value
  // (no longer in the diff) clears that override. Empty entries clears the row.
  function replaceBatch(id, entries) {
    const next = {};
    for (const { path, value } of entries) {
      safeSet(next, path, value);
    }
    _validateMerged(id, next);
    if (Object.keys(next).length === 0) store.clearOverlay(id);
    else store.setOverlay(id, next);
  }

  function clearField(id, path) {
    const current = get(id);
    if (!deletePath(current, path)) return;
    // WR-08: when the overlay becomes empty after deletion, remove the LMDB
    // row entirely instead of storing {} (which listOverlayIds would skip
    // anyway and which would leak rows over time).
    if (Object.keys(current).length === 0) store.clearOverlay(id);
    else store.setOverlay(id, current);
  }

  function clearAll(id) { store.clearOverlay(id); }

  function list(id) { return leafPaths(get(id)); }

  // CR-04 support: write an arbitrary overlay blob (e.g. from a snapshot)
  // with full validation. Throws if the merged result would be invalid.
  // Used by snapshot.restore — the snapshot may pre-date a schema change
  // and the resulting merge may now be invalid; the caller can catch and skip.
  function replaceRaw(id, overlayBlob) {
    const next = overlayBlob && typeof overlayBlob === 'object' ? overlayBlob : {};
    _validateMerged(id, next);
    if (Object.keys(next).length === 0) store.clearOverlay(id);
    else store.setOverlay(id, next);
  }

  return { get, setField, setBatch, replaceBatch, clearField, clearAll, list, replaceRaw };
}

module.exports = { createOverlay };
