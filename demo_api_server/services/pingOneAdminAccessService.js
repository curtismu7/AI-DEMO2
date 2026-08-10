'use strict';

const groupPolicy = require('./groupPolicy');
const membershipService = require('./pingOneGroupMembershipService');

const VERTICAL_ID = 'pingone-admin';
const GROUP_CATEGORY = 'privileged';

async function checkAccess({ username, pingOneUserId }) {
  const requiredGroup = groupPolicy.groupNameForCategory(VERTICAL_ID, GROUP_CATEGORY);
  if (!requiredGroup) {
    return {
      allowed: false,
      error: 'pingone_admin_group_not_configured',
      status: 500,
      requiredGroup: null,
    };
  }
  if (!pingOneUserId || !membershipService.isReady()) {
    return {
      allowed: false,
      error: 'pingone_admin_group_lookup_unavailable',
      status: 503,
      requiredGroup,
    };
  }

  const groups = await membershipService.listUserGroupNamesForVertical(
    pingOneUserId,
    VERTICAL_ID,
  );
  if (!Array.isArray(groups)) {
    return {
      allowed: false,
      error: 'pingone_admin_group_lookup_unavailable',
      status: 503,
      requiredGroup,
    };
  }

  // Decided in JS, not via PingOne Authorize. A live-verify pass (2026-08-10)
  // found evaluateMcpToolDelegation's deployed "McpFirstTool" policy runs an
  // unconditional TokenAudience/actor-chain check BEFORE its group rule — a
  // real group member was DENIED with "Token audience 'none' or actor chain
  // validation failed", the group rule never reached. This call site has no
  // MCP bearer token (it gates a plain session-based dashboard route), so it
  // has no TokenAudience to legitimately supply, and fabricating one would
  // violate this codebase's own C1 rule 1 ("never hardcode this to the
  // expected URI"). Routing this vertical's gate through PingOne Authorize
  // needs either a dedicated decision endpoint/policy with no audience gate,
  // or a real token-audience source — both out of scope here. See
  // docs/superpowers/specs/2026-08-10-pingone-admin-p1az-group-gate-design.md
  // for the design that was reverted, and REGRESSION_PLAN.md §4 for this fix.
  const allowed = groups.includes(requiredGroup);
  return {
    allowed,
    error: allowed ? null : 'pingone_admin_group_required',
    status: allowed ? 200 : 403,
    requiredGroup,
    username,
    groups,
  };
}

module.exports = { checkAccess, VERTICAL_ID, GROUP_CATEGORY };
