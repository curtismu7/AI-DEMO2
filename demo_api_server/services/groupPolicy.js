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

// Distinct from `null` (legitimate "no groups block for this vertical") so
// requiredGroupForTool can fail closed when manifest resolution itself broke,
// instead of silently treating the vertical as unrestricted (finding #48).
const MANIFEST_RESOLUTION_ERROR = Symbol('groupPolicy.manifestResolutionError');

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
    return MANIFEST_RESOLUTION_ERROR;
  }
}

function _groupsConfig(verticalId) {
  const manifest = _getVerticalManifest(verticalId);
  if (manifest === MANIFEST_RESOLUTION_ERROR) return MANIFEST_RESOLUTION_ERROR;
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
  const isBanking = _normalizeVerticalId(verticalId) === 'banking';

  if (cfg === MANIFEST_RESOLUTION_ERROR) {
    if (isBanking) {
      // Legacy config/group-policy.json is a deprecated fallback for banking-only.
      return _loadLegacy().restrictedTools[toolName] || null;
    }
    // No legacy fallback exists for non-banking verticals, and we cannot
    // tell whether this tool is restricted — fail closed (require a group
    // name no user actually holds) instead of treating it as unrestricted.
    return '__manifest_resolution_error__';
  }

  if (cfg && cfg.restrictedTools && cfg.restrictedTools[toolName]) {
    return groupNameForCategory(verticalId, cfg.restrictedTools[toolName]);
  }

  // Legacy banking fallback
  if (isBanking) {
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
 *
 * Returns `{ groups, source }`, never a bare array: `source: 'pingone'` is a real
 * directory read, `source: 'manifest'` is what the vertical manifest says users
 * like this one have. Those are not interchangeable — the manifest answered
 * `["AI_Demo_Privileged","Banking_PremiumTier"]` for a user the live directory
 * reported as being in ZERO groups, and that manifest answer was reported as
 * verified live membership before `ff_authorize_group_policy` was enabled. A bare
 * array cannot carry that distinction, so the caller cannot accidentally drop it.
 *
 * @returns {Promise<{ groups: string[], source: 'pingone'|'manifest' }>}
 */
async function groupsForUser(username, verticalId = 'banking', { pingOneUserId = null } = {}) {
  if (!username) return { groups: [], source: 'manifest' };

  if (pingOneUserId) {
    try {
      const live = require('./pingOneGroupMembershipService');
      const names = await live.listUserGroupNamesForVertical(pingOneUserId, verticalId);
      // An empty array from a SUCCESSFUL call is the live answer and wins; only
      // a non-array (lookup failed) falls through to the manifest.
      if (Array.isArray(names)) return { groups: names, source: 'pingone' };
    } catch {
      /* fall through to manifest */
    }
  }

  return { groups: _manifestGroupsForUser(username, verticalId), source: 'manifest' };
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

/**
 * Group-parameter suppression after a live PingOne 400 on parameters.UserGroups.
 *
 * This REPLACES the old behavior of writing ff_authorize_group_policy=false.
 * That write was persistent and far wider than the fault it responded to: the
 * flag also gates whether userTier is resolved at all (see
 * mcpToolAuthorizationService's resolution gate), so one malformed-UserGroups
 * 400 silently disarmed every tier ceiling for every later request, and stayed
 * that way until someone noticed and flipped the flag back by hand.
 *
 * Suppression instead is:
 *   - in-memory, so it never edits operator-owned config;
 *   - time-boxed, so a transient upstream fault heals itself;
 *   - narrow — only the three group parameters are dropped. UserTier is a
 *     separate attribute PingOne did not complain about, so it keeps flowing
 *     and tier ceilings keep enforcing.
 */
const GROUP_PARAM_SUPPRESS_MS = 10 * 60 * 1000;
let _groupParamsSuppressedUntil = 0;

function suppressGroupParams(now = Date.now()) {
  _groupParamsSuppressedUntil = now + GROUP_PARAM_SUPPRESS_MS;
  console.warn(
    '[groupPolicy] PingOne rejected parameters.UserGroups — suppressing group parameters for ' +
      `${GROUP_PARAM_SUPPRESS_MS / 60000} min. ff_authorize_group_policy is UNCHANGED and tier ` +
      'ceilings stay in force.',
  );
  return true;
}

function areGroupParamsSuppressed(now = Date.now()) {
  return _groupParamsSuppressedUntil > now;
}

function _resetGroupParamSuppression() {
  _groupParamsSuppressedUntil = 0;
}

function _reset() {
  _legacyData = null;
  _resetGroupParamSuppression();
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
  suppressGroupParams,
  areGroupParamsSuppressed,
  _resetGroupParamSuppression,
  _reset,
};
