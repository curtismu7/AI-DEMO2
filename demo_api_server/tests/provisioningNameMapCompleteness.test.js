'use strict';

/**
 * Every canonical key must have an EXPLICIT provisioning.*Names entry.
 *
 * pingoneProvisionService.js resolves the PingOne display name with
 *
 *   (_PROVISIONING.resourceNames || {})[internalKey] || internalKey
 *
 * so a key with no mapping silently falls back to the canonical key itself. That
 * fallback does not throw — it just starts addressing a DIFFERENT PingOne object,
 * and the next provisioning run creates a duplicate. Renaming a canonical key
 * (e.g. the Super Banking -> AI Demo work) is exactly when a mapping gets missed.
 *
 * Keeping the map total means the fallback is never exercised, so a missed entry
 * is a red test instead of a live duplicate.
 */

const fs = require('fs');
const path = require('path');

const manifest = JSON.parse(
  fs.readFileSync(process.env.SCOPE_TOPOLOGY_PATH
    || path.join(__dirname, '..', '..', 'scope-topology.json'), 'utf8'),
);

const resourceNames = manifest.provisioning?.resourceNames || {};
const appNames = manifest.provisioning?.appNames || {};

describe('provisioning name map is total', () => {
  test('every resources{} key has an explicit resourceNames entry', () => {
    const missing = Object.keys(manifest.resources).filter((k) => !(k in resourceNames));
    expect(missing).toEqual([]);
  });

  test('every apps{} key has an explicit appNames entry', () => {
    const missing = Object.keys(manifest.apps).filter((k) => !(k in appNames));
    expect(missing).toEqual([]);
  });

  test('no mapping is empty', () => {
    const blank = [...Object.entries(resourceNames), ...Object.entries(appNames)]
      .filter(([, v]) => !String(v || '').trim())
      .map(([k]) => k);
    expect(blank).toEqual([]);
  });

  // Not a failure — an identity mapping just means the live object really is
  // named after the canonical key, so renaming the key renames the live object.
  // Surfaced so that consequence is a deliberate choice rather than a surprise.
  test('identity mappings are visible (rename the key = rename the live object)', () => {
    const identity = Object.entries(resourceNames)
      .filter(([k, v]) => k === v)
      .map(([k]) => k);
    // Snapshotted as a count so adding one is a conscious edit. 11 since the
    // Reservations Specialist A2A intermediate joined (airlines UC2).
    expect(identity.length).toBe(11);
  });
});
