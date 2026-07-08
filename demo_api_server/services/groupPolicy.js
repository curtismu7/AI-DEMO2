'use strict';

/**
 * groupPolicy.js — vertical-scoped group authorization (UC9 + UC21).
 *
 * Source of truth: each vertical manifest's `groups` block (category → PingOne
 * group name, restrictedTools, userMemberships). Legacy config/group-policy.json
 * is a deprecated fallback for banking-only when manifest data is absent.
 *
 * Enforcement gated by ff_authorize_group_policy (default OFF).
 */

const fs = require('fs');
const path = require('path');

const LEGACY_DATA_PATH = path.join(__dirname, '..', 'config', 'group-policy.json');
const GROUP_POLICY_FLAG = 'ff_authorize_group_policy';

let _legacyData = null;

function _loadLegacy() {
  if (_legacyData) return _legacyData;
  try {
    const raw = fs.readFileSync(LEGACY_DATA_PATH, 'utf8');
    const m = JSON.parse(raw);
    _legacyData = {
      restrictedTools: (m && m.restrictedTools) || {},
      userGroups: (m && m.userGroups) || {},
    };
  } catch (err) {
    console.warn('[groupPolicy] could not load config/group-policy.json:', err && err.message);
    _legacyData = { restrictedTools: {}, userGroups: {} };
  }
  return _legacyData;
}

function _normalizeVerticalId(verticalId) {
  const id = (verticalId || 'banking').trim();
  return id || 'banking';
}

function _getVerticalManifest(verticalId) {
  try {
    const { verticalManifest } = require('./verticalManifest');
    if (typeof verticalManifest.init === 'function') {
      verticalManifest.init();
    }
    return verticalManifest.resolver.resolve(_normalizeVerticalId(verticalId));
  } catch (err) {
    console.warn('[groupPolicy] could not load vertical manifest:', err && err.message);
    return null;
  }
}

function _groupsConfig(verticalId) {
  const manifest = _getVerticalManifest(verticalId);
  return manifest && manifest.groups ? manifest.groups : null;
}

/** Resolve a category key to its PingOne group name for a vertical. */
function groupNameForCategory(verticalId, categoryKey) {
  if (!categoryKey) return null;
  const cfg = _groupsConfig(verticalId);
  const name = cfg && cfg.categories && cfg.categories[categoryKey]
    ? cfg.categories[categoryKey].name
    : null;
  return name || null;
}

/** All PingOne group names declared for a vertical (for live lookup filtering). */
function listGroupNamesForVertical(verticalId) {
  const cfg = _groupsConfig(verticalId);
  if (!cfg || !cfg.categories) return [];
  return Object.values(cfg.categories)
    .map((c) => c && c.name)
    .filter(Boolean);
}

/** Collect group definitions across all vertical manifests (provisioning / wipe). */
function listAllVerticalGroupDefinitions() {
  try {
    const { verticalManifest } = require('./verticalManifest');
    if (typeof verticalManifest.init === 'function') {
      verticalManifest.init();
    }
    const root = verticalManifest.resolver.loader;
    const ids = (root.list && root.list()) || [];
    const out = [];
    for (const entry of ids) {
      const id = entry.id || entry;
      const manifest = verticalManifest.resolver.resolve(id);
      if (!manifest || !manifest.groups || !manifest.groups.categories) continue;
      out.push({
        verticalId: id,
        categories: manifest.groups.categories,
        restrictedTools: manifest.groups.restrictedTools || {},
        userMemberships: manifest.groups.userMemberships || {},
      });
    }
    return out;
  } catch (err) {
    console.warn('[groupPolicy] listAllVerticalGroupDefinitions failed:', err && err.message);
    return [];
  }
}

/**
 * Is group-policy enforcement enabled? Gated by ff_authorize_group_policy
 * (default 'false').
 */
function isEnabled(configStore) {
  const v = configStore && configStore.getEffective
    ? configStore.getEffective(GROUP_POLICY_FLAG)
    : configStore && configStore.get
      ? configStore.get(GROUP_POLICY_FLAG)
      : 'false';
  return v === true || v === 'true';
}

/** The PingOne group required to call a tool, or null if unrestricted. */
function requiredGroupForTool(toolName, verticalId = 'banking') {
  if (!toolName) return null;

  const cfg = _groupsConfig(verticalId);
  if (cfg && cfg.restrictedTools && cfg.restrictedTools[toolName]) {
    return groupNameForCategory(verticalId, cfg.restrictedTools[toolName]);
  }

  // Legacy banking fallback
  if (_normalizeVerticalId(verticalId) === 'banking') {
    return _loadLegacy().restrictedTools[toolName] || null;
  }
  return null;
}

/** Manifest-only membership (category keys → PingOne group names). */
function _manifestGroupsForUser(username, verticalId) {
  const cfg = _groupsConfig(verticalId);
  if (cfg && cfg.userMemberships) {
    const cats = cfg.userMemberships[username];
    if (Array.isArray(cats)) {
      return cats
        .map((c) => groupNameForCategory(verticalId, c))
        .filter(Boolean);
    }
    if (username && cfg.userMemberships[username] === undefined) {
      return [];
    }
  }

  if (_normalizeVerticalId(verticalId) === 'banking') {
    const g = _loadLegacy().userGroups[username];
    return Array.isArray(g) ? g.slice() : [];
  }
  return [];
}

/**
 * The PingOne group names a user belongs to for a vertical.
 * When pingOneUserId is supplied and live lookup succeeds, directory wins over manifest.
 */
async function groupsForUser(username, verticalId = 'banking', { pingOneUserId = null } = {}) {
  if (!username) return [];

  if (pingOneUserId) {
    try {
      const live = require('./pingOneGroupMembershipService');
      const names = await live.listUserGroupNamesForVertical(pingOneUserId, verticalId);
      if (Array.isArray(names)) return names;
    } catch {
      /* fall through to manifest */
    }
  }

  return _manifestGroupsForUser(username, verticalId);
}

/** Synchronous manifest-only accessor (tests / simulated paths without PingOne id). */
function groupsForUserSync(username, verticalId = 'banking') {
  if (!username) return [];
  return _manifestGroupsForUser(username, verticalId);
}

/** Resolve entitlement tier from group names using manifest tiers.groupToTier. */
function resolveUserTier(userGroups, verticalId = 'banking') {
  const manifest = _getVerticalManifest(verticalId);
  const groupToTier = (manifest && manifest.tiers && manifest.tiers.groupToTier) || {};
  const defaultTier = (manifest && manifest.tiers && manifest.tiers.default) || 'Standard';
  if (!Array.isArray(userGroups)) return defaultTier;
  for (const [groupName, tier] of Object.entries(groupToTier)) {
    if (userGroups.includes(groupName)) return tier;
  }
  return defaultTier;
}

/** Tier definitions for authorize engines (from manifest or banking defaults). */
function getTierDefinitions(verticalId = 'banking') {
  const manifest = _getVerticalManifest(verticalId);
  const defs = manifest && manifest.tiers && manifest.tiers.definitions;
  if (defs && Object.keys(defs).length > 0) {
    return defs;
  }
  return {
    Standard: { maxAmountUsd: 2000, restrictedTools: ['create_withdrawal', 'withdraw'] },
    PrivateBanking: { maxAmountUsd: 50000, restrictedTools: [] },
  };
}

function isUserGroupsAttributeError(err) {
  const msg = err && err.message ? err.message : String(err || '');
  return msg.includes('parameters.UserGroups') &&
    (msg.includes('INVALID_VALUE') || msg.includes('Invalid value for attribute'));
}

async function disableGroupPolicy(configStore) {
  if (!configStore || typeof configStore.setRaw !== 'function') return false;
  await configStore.setRaw({ [GROUP_POLICY_FLAG]: 'false' });
  console.warn(
    '[groupPolicy] PingOne rejected parameters.UserGroups — auto-disabled ff_authorize_group_policy',
  );
  return true;
}

function _reset() {
  _legacyData = null;
  try {
    require('./pingOneGroupMembershipService')._resetCache();
  } catch {
    /* optional */
  }
}

module.exports = {
  isEnabled,
  requiredGroupForTool,
  groupsForUser,
  groupsForUserSync,
  resolveUserTier,
  getTierDefinitions,
  groupNameForCategory,
  listGroupNamesForVertical,
  listAllVerticalGroupDefinitions,
  isUserGroupsAttributeError,
  disableGroupPolicy,
  _reset,
};
