const fs = require('fs');
const path = require('path');
const { ManifestSchema, MockDataSchema } = require('./schema');

const DEFAULT_ROOT = path.join(__dirname, '..', '..', 'config', 'verticals');

function createLoader(rootDir = DEFAULT_ROOT) {
  const cache = new Map();   // id → { manifest, mockData }

  function loadOne(id) {
    const dir = path.join(rootDir, id);
    const manifestPath = path.join(dir, 'manifest.json');
    const mockPath = path.join(dir, 'mock-data.json');

    if (!fs.existsSync(manifestPath)) {
      // Skip directories without manifest.json (e.g., admin overlay)
      return;
    }

    const manifestRaw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const manifestRes = ManifestSchema.safeParse(manifestRaw);
    if (!manifestRes.success) {
      const err = new Error(`Invalid manifest at ${manifestPath}: ${JSON.stringify(manifestRes.error.issues)}`);
      err.id = id;
      throw err;
    }

    let mockData = {};
    if (fs.existsSync(mockPath)) {
      mockData = MockDataSchema.parse(JSON.parse(fs.readFileSync(mockPath, 'utf8')));
    }

    cache.set(id, { manifest: manifestRes.data, mockData });
  }

  function loadAll() {
    cache.clear();
    if (!fs.existsSync(rootDir)) return;
    const entries = fs.readdirSync(rootDir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      loadOne(e.name);
    }
  }

  function get(id) { return cache.get(id) || null; }
  function list() {
    return [...cache.entries()].map(([id, v]) => ({
      id,
      displayName: v.manifest.identity.displayName,
      tagline: v.manifest.identity.tagline,
      theme: v.manifest.theme,
    }));
  }
  function reload(id) { loadOne(id); }
  function removeFromCache(id) { cache.delete(id); }

  return { loadAll, get, list, reload, removeFromCache };
}

// index.js builds the loader via createLoader(root) so VERTICAL_SEED_ROOT is
// honored; there is no module-level singleton.
module.exports = { createLoader };
