'use strict';

/**
 * groupPolicy.js — Scenario 1 (Denied Access: user not in group).
 *
 * Single source of truth for the demo's group-based authorization data:
 *   - restrictedTools: tool -> the group required to call it
 *   - userGroups:      username -> the groups that user belongs to
 *
 * Both authorization engines (the BFF simulatedAuthorizeService and live
 * PingOne Authorize via pingOneAuthorizeService) and the mock demo_authz_server
 * must agree on the same decision. The BFF resolves RequiredGroup + UserGroups
 * here and passes them as Trust Framework parameters to whichever engine runs,
 * so parity is preserved.
 *
 * Enforcement is gated by the ff_authorize_group_policy feature flag (default
 * OFF) — see isEnabled(). With the flag off this module is a no-op and existing
 * flows are unchanged.
 *
 * Data file: config/group-policy.json. Loaded + memoized at first require.
 */

const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'config', 'group-policy.json');

let _data = null;

function load() {
  if (_data) return _data;
  try {
    const raw = fs.readFileSync(DATA_PATH, 'utf8');
    const m = JSON.parse(raw);
    _data = {
      restrictedTools: (m && m.restrictedTools) || {},
      userGroups: (m && m.userGroups) || {},
    };
  } catch (err) {
    // Missing/invalid data must not crash the authorize path — fail to an empty
    // policy (no tool restricted), which is the same as the feature being off.
    console.warn('[groupPolicy] could not load config/group-policy.json:', err && err.message);
    _data = { restrictedTools: {}, userGroups: {} };
  }
  return _data;
}

/**
 * Is group-policy enforcement enabled? Gated by ff_authorize_group_policy
 * (default 'false'). configStore is passed in to avoid a circular require and
 * to honor a freshly-injected reference (same pattern as
 * simulatedAuthorizeService.isSimulatedModeEnabled).
 */
function isEnabled(configStore) {
  const v = configStore && configStore.getEffective
    ? configStore.getEffective('ff_authorize_group_policy')
    : configStore && configStore.get
      ? configStore.get('ff_authorize_group_policy')
      : 'false';
  return v === true || v === 'true';
}

/** The group required to call a tool, or null if the tool is unrestricted. */
function requiredGroupForTool(toolName) {
  if (!toolName) return null;
  return load().restrictedTools[toolName] || null;
}

/** The groups a username belongs to (empty array if unknown). */
function groupsForUser(username) {
  if (!username) return [];
  const g = load().userGroups[username];
  return Array.isArray(g) ? g.slice() : [];
}

/** Test seam — drop the memoized data so a test can reload after editing. */
function _reset() {
  _data = null;
}

module.exports = {
  isEnabled,
  requiredGroupForTool,
  groupsForUser,
  _reset,
};
