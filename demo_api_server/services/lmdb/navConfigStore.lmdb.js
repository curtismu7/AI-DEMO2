'use strict';
/**
 * navConfigStore.lmdb.js — LMDB-backed persistence for sidebar nav
 * customization. Sibling to verticalStore.lmdb.js (same prefixed-key,
 * single-DB convention).
 *
 * Key layout (single LMDB DB named 'navConfigs'):
 *   config:<id>        -> { id, name, isBuiltin, hiddenLabels, flagSnapshot, createdAt, updatedAt }
 *   userPrefs:<userId>  -> { hiddenLabels, activeConfigId, updatedAt }
 */
const { getDb } = require('./openEnv');
const crypto = require('crypto');

const DB_NAME = 'navConfigs';

function _db() { return getDb(DB_NAME); }

// Hidden-item labels here match the top-level `allNavItems` labels in
// demo_api_ui/src/components/AdminSideNav.jsx exactly (see
// demo_api_ui/src/config/navItemsCatalog.js, the shared source list).
const BUILTIN_CONFIGS = [
  {
    id: 'full-mode',
    name: 'Full mode',
    isBuiltin: true,
    hiddenLabels: [],
    flagSnapshot: {},
  },
  {
    id: 'demo-mode',
    name: 'Demo mode',
    isBuiltin: true,
    hiddenLabels: [
      'Themes', 'Agent Demo Guide', 'PingOne MCP', 'MCP & Gateways',
      'PingOne Demo Apps', 'Delegation & Consent', 'OAuth & Identity',
      'Users & Accounts', 'AI Attack Demos', 'Monitoring', 'Telemetry',
      'Diagrams', 'Agent Studio (Preview)', 'Developer Tools', 'System Tools',
      'Integration Tests',
    ],
    flagSnapshot: {},
  },
  {
    id: 'learning',
    name: 'Learning',
    isBuiltin: true,
    hiddenLabels: [
      'Themes', 'Agent Demo Guide', 'Family Delegation', 'AI Agents',
      'PingOne MCP', 'MCP & Gateways', 'Delegation & Consent',
      'Industry Verticals', 'Users & Accounts', 'AI Attack Demos',
      'Monitoring', 'Telemetry', 'Agent Studio (Preview)', 'Developer Tools',
      'System Tools', 'Integration Tests',
    ],
    flagSnapshot: {},
  },
];

function seedBuiltins() {
  const db = _db();
  for (const cfg of BUILTIN_CONFIGS) {
    if (db.get(`config:${cfg.id}`) === undefined) {
      const now = Date.now();
      db.putSync(`config:${cfg.id}`, { ...cfg, createdAt: now, updatedAt: now });
    }
  }
}

function listConfigs() {
  seedBuiltins();
  const db = _db();
  const configs = [];
  for (const { value } of db.getRange({ start: 'config:', end: 'config;' })) {
    if (value) configs.push(value);
  }
  return configs.sort((a, b) => Number(b.isBuiltin) - Number(a.isBuiltin) || a.name.localeCompare(b.name));
}

function getConfig(id) {
  seedBuiltins();
  return _db().get(`config:${id}`) || null;
}

function createConfig(name, hiddenLabels, flagSnapshot) {
  const id = 'cfg_' + crypto.randomBytes(4).toString('hex');
  const now = Date.now();
  const config = { id, name, isBuiltin: false, hiddenLabels, flagSnapshot, createdAt: now, updatedAt: now };
  _db().putSync(`config:${id}`, config);
  return config;
}

function deleteConfig(id) {
  const config = _db().get(`config:${id}`);
  if (!config) return { ok: false, reason: 'not_found' };
  if (config.isBuiltin) return { ok: false, reason: 'builtin' };
  _db().removeSync(`config:${id}`);
  return { ok: true };
}

// New/unconfigured users start with "Use Cases" hidden (the catalog page is
// superseded by "Use Cases (Live)" as the primary entry point) — they can
// re-enable it themselves from Demo Config.
const DEFAULT_HIDDEN_LABELS = ['Use Cases'];

function getUserPrefs(userId) {
  const v = _db().get(`userPrefs:${userId}`);
  return v || { hiddenLabels: DEFAULT_HIDDEN_LABELS, activeConfigId: null, navOrder: null, childOrder: null, updatedAt: null };
}

// navOrder / childOrder: explicit null clears the stored value (Reset order),
// undefined leaves it untouched (callers that only update hiddenLabels).
function setUserPrefs(userId, hiddenLabels, activeConfigId, navOrder, childOrder) {
  const existing = getUserPrefs(userId);
  const prefs = {
    hiddenLabels,
    activeConfigId: activeConfigId || null,
    navOrder: navOrder === null ? null : (Array.isArray(navOrder) ? navOrder : (existing.navOrder || null)),
    childOrder: childOrder === null ? null : (isChildOrder(childOrder) ? childOrder : (existing.childOrder || null)),
    updatedAt: Date.now(),
  };
  _db().putSync(`userPrefs:${userId}`, prefs);
  return prefs;
}

// { [groupLabel]: [childLabel, ...] } — plain object of string arrays.
function isChildOrder(v) {
  return (
    !!v && typeof v === 'object' && !Array.isArray(v) &&
    Object.values(v).every((arr) => Array.isArray(arr) && arr.every((l) => typeof l === 'string'))
  );
}

module.exports = {
  listConfigs, getConfig, createConfig, deleteConfig,
  getUserPrefs, setUserPrefs, isChildOrder,
  seedBuiltins, BUILTIN_CONFIGS, DEFAULT_HIDDEN_LABELS, DB_NAME,
};
