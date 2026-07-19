'use strict';

const store = require('../../services/lmdb/navConfigStore.lmdb');

describe('navConfigStore.lmdb', () => {
  test('listConfigs seeds and returns the 3 built-in configs', () => {
    const configs = store.listConfigs();
    const names = configs.map(c => c.name);
    expect(names).toEqual(expect.arrayContaining(['Full mode', 'Demo mode', 'Learning']));
    expect(configs.filter(c => c.isBuiltin)).toHaveLength(3);
  });

  test('Full mode builtin has no hidden items', () => {
    const configs = store.listConfigs();
    const full = configs.find(c => c.name === 'Full mode');
    expect(full.hiddenLabels).toEqual([]);
  });

  test('createConfig persists a custom config and getConfig retrieves it', () => {
    const created = store.createConfig('Q3 walkthrough', ['Themes', 'Developer Tools'], { ff_rar: true });
    expect(created.id).toMatch(/^cfg_/);
    expect(created.isBuiltin).toBe(false);

    const fetched = store.getConfig(created.id);
    expect(fetched.name).toBe('Q3 walkthrough');
    expect(fetched.hiddenLabels).toEqual(['Themes', 'Developer Tools']);
    expect(fetched.flagSnapshot).toEqual({ ff_rar: true });
  });

  test('deleteConfig removes a custom config', () => {
    const created = store.createConfig('Temp', [], {});
    const result = store.deleteConfig(created.id);
    expect(result.ok).toBe(true);
    expect(store.getConfig(created.id)).toBeNull();
  });

  test('deleteConfig refuses to remove a builtin', () => {
    const configs = store.listConfigs();
    const full = configs.find(c => c.name === 'Full mode');
    const result = store.deleteConfig(full.id);
    expect(result).toEqual({ ok: false, reason: 'builtin' });
    expect(store.getConfig(full.id)).not.toBeNull();
  });

  test('deleteConfig on an unknown id reports not_found', () => {
    const result = store.deleteConfig('cfg_does_not_exist');
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  test('getUserPrefs defaults to empty hiddenLabels for a first-time user', () => {
    const prefs = store.getUserPrefs('user-never-seen-before');
    expect(prefs).toEqual({ hiddenLabels: [], activeConfigId: null, updatedAt: null });
  });

  test('setUserPrefs then getUserPrefs round-trips', () => {
    const saved = store.setUserPrefs('user-42', ['Themes'], 'cfg_abc123');
    expect(saved.hiddenLabels).toEqual(['Themes']);
    expect(saved.activeConfigId).toBe('cfg_abc123');
    expect(typeof saved.updatedAt).toBe('number');

    const fetched = store.getUserPrefs('user-42');
    expect(fetched).toEqual(saved);
  });
});
