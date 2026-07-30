'use strict';

const store = require('../../services/lmdb/navConfigStore.lmdb');

const KNOWN_NAV_LABELS = [
  "Home", "Dashboard", "Themes", "Use Cases", "Agent Demo Guide",
  "Family Delegation", "AI Agents", "PingOne MCP", "MCP & Gateways",
  "PingOne Demo Apps", "Delegation & Consent", "Authorize", "OAuth & Identity",
  "Industry Verticals", "Users & Accounts", "AI Attack Demos", "Monitoring",
  "Telemetry", "Diagrams", "Agent Studio (Preview)", "Learn & Present",
  "Developer Tools", "System Tools", "Integration Tests",
];

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

  test('getUserPrefs defaults to Use Cases hidden for a first-time user', () => {
    const prefs = store.getUserPrefs('user-never-seen-before');
    expect(prefs).toEqual({ hiddenLabels: ['Use Cases'], activeConfigId: null, navOrder: null, updatedAt: null });
    expect(prefs.hiddenLabels).toEqual(store.DEFAULT_HIDDEN_LABELS);
  });

  test('setUserPrefs then getUserPrefs round-trips', () => {
    const saved = store.setUserPrefs('user-42', ['Themes'], 'cfg_abc123');
    expect(saved.hiddenLabels).toEqual(['Themes']);
    expect(saved.activeConfigId).toBe('cfg_abc123');
    expect(typeof saved.updatedAt).toBe('number');

    const fetched = store.getUserPrefs('user-42');
    expect(fetched).toEqual(saved);
  });

  test('every BUILTIN_CONFIGS hiddenLabels entry is a real, known nav label', () => {
    for (const cfg of store.BUILTIN_CONFIGS) {
      for (const label of cfg.hiddenLabels) {
        expect(KNOWN_NAV_LABELS).toContain(label);
      }
    }
  });
});
