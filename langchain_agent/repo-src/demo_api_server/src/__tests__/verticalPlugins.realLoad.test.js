'use strict';

// Regression guard for the class of bug that crashed the api-server at startup
// (oauth-teaching: shared EDUCATION_HEURISTICS actions api_key_demo/dual_token_demo
// were not declared as tools → pluginContract validation threw; and a manifest
// render type 'token-pair' was not in the schema enum). The existing
// verticalPlugins.contract.test.js only exercises SYNTHETIC plugins in a temp dir,
// so the real config/verticals/* plugins were never loaded by any test. These tests
// load every real vertical through the actual loader and validate every manifest.

const fs = require('fs');
const path = require('path');
const { createPlugins } = require('../../services/verticalManifest/plugins');
const { ManifestSchema } = require('../../services/verticalManifest/schema');

const VERTICALS_DIR = path.join(__dirname, '..', '..', 'config', 'verticals');

const pluginIds = fs.readdirSync(VERTICALS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && fs.existsSync(path.join(VERTICALS_DIR, d.name, 'index.js')))
  .map((d) => d.name);

const manifestIds = fs.readdirSync(VERTICALS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && fs.existsSync(path.join(VERTICALS_DIR, d.name, 'manifest.json')))
  .map((d) => d.name);

describe('real vertical plugins load through the actual loader', () => {
  const plugins = createPlugins();

  it('discovers at least the core verticals', () => {
    expect(pluginIds).toEqual(expect.arrayContaining(['banking', 'oauth-teaching']));
  });

  it.each(pluginIds)('loads "%s" without a contract violation (every heuristic action is a declared tool)', (id) => {
    expect(() => plugins.get(id)).not.toThrow();
    expect(plugins.get(id)).not.toBeNull();
  });
});

describe('real vertical manifests validate against the schema', () => {
  it.each(manifestIds)('manifest for "%s" is schema-valid', (id) => {
    const mf = require(path.join(VERTICALS_DIR, id, 'manifest.json'));
    const res = ManifestSchema.safeParse(mf);
    if (!res.success) {
      throw new Error(`manifest ${id} invalid: ${JSON.stringify(res.error.issues)}`);
    }
    expect(res.success).toBe(true);
  });
});
