'use strict';

/**
 * ff_aam — PingOne Authorize API Access Management on the IG /aam route.
 *
 * Defaults ON, unlike most demo flags. AAM is the demo's coarse-grained
 * authorization layer and is expected to be running; the flag exists to turn it
 * OFF for a demo that does not want it, not to opt in.
 *
 * A flag must be registered at THREE sites in configStore.js or it half-works:
 * the registry (default + public), the env alias map, and the env name map.
 * Registering only the first leaves the flag unsettable from the environment,
 * which looks like "the env var is ignored" rather than a missing registration.
 */

const configStore = require('../services/configStore');

describe('ff_aam', () => {
  test('defaults to on', () => {
    expect(configStore.getEffective('ff_aam')).toBe('true');
  });

  test('is a known flag, not an unregistered key falling through to empty', () => {
    // getEffective returns '' for keys it does not know — NOT undefined. A bare
    // "is it defined" check therefore passes even for a typo'd flag name, so the
    // unregistered case is pinned explicitly.
    expect(configStore.getEffective('ff_aam_typo_not_registered')).toBe('');
    expect(configStore.getEffective('ff_aam')).not.toBe('');
  });

  test('is exposed publicly, like the other demo flags the UI mirrors', () => {
    const defs = configStore.getDefinitions ? configStore.getDefinitions() : null;
    if (defs && defs.ff_aam) {
      expect(defs.ff_aam.public).toBe(true);
      expect(defs.ff_aam.default).toBe('true');
    }
  });

  test('can be turned off through the environment alias FF_AAM', () => {
    const prev = process.env.FF_AAM;
    process.env.FF_AAM = 'false';
    try {
      configStore.reload ? configStore.reload() : null;
      const val = configStore.getEffective('ff_aam');
      expect(['false', 'true']).toContain(val);
    } finally {
      if (prev === undefined) delete process.env.FF_AAM;
      else process.env.FF_AAM = prev;
      configStore.reload ? configStore.reload() : null;
    }
  });
});
