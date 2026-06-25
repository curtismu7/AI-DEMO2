'use strict';

const fs = require('fs');
const path = require('path');
const { validatePlugin } = require('./pluginContract');

const DEFAULT_ROOT = path.join(__dirname, '..', '..', 'config', 'verticals');

/**
 * Discovery factory: turns a vertical id into a validated plugin object,
 * or null when the vertical has no index.js (manifest-only / legacy mode).
 * Caches by id. Throws if an index.js exists but violates the contract —
 * a malformed plugin is a hard error, never a silent banking fallback.
 */
function createPlugins(rootDir = DEFAULT_ROOT) {
  const cache = new Map(); // id -> plugin | null

  function load(id) {
    const file = path.join(rootDir, id, 'index.js');
    if (!fs.existsSync(file)) {
      cache.set(id, null);
      return null;
    }
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const mod = require(file);
    const plugin = mod && mod.default ? mod.default : mod;
    const { ok, errors } = validatePlugin(id, plugin);
    if (!ok) {
      throw new Error(`Invalid vertical plugin "${id}": ${errors.join('; ')}`);
    }
    cache.set(id, plugin);
    return plugin;
  }

  function get(id) {
    if (cache.has(id)) return cache.get(id);
    return load(id);
  }

  function has(id) {
    return get(id) !== null;
  }

  function reload(id) {
    const file = path.join(rootDir, id, 'index.js');
    try { delete require.cache[require.resolve(file)]; } catch (_) { /* not loaded */ }
    cache.delete(id);
    return get(id);
  }

  return { get, has, reload };
}

module.exports = { createPlugins };
