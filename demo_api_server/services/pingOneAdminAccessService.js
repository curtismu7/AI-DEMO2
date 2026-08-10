'use strict';

const groupPolicy = require('./groupPolicy');
const membershipService = require('./pingOneGroupMembershipService');
const pingOneAuthorizeService = require('./pingOneAuthorizeService');

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

  const inRequiredGroup = groups.includes(requiredGroup);

  // Decision is made by PingOne Authorize (Scenario 1 group-policy rule),
  // not in JS. inRequiredGroup is a pre-resolved input (the snapshot DSL has
  // no array-contains) — the PDP still decides PERMIT/DENY/INDETERMINATE.
  // Calling evaluateMcpToolDelegation directly (rather than flipping
  // ff_authorize_group_policy) keeps this scoped to this vertical only —
  // see docs/superpowers/specs/2026-08-10-pingone-admin-p1az-group-gate-design.md.
  let decision;
  try {
    ({ decision } = await pingOneAuthorizeService.evaluateMcpToolDelegation({
      userId: pingOneUserId,
      toolName: 'pingone_admin_access',
      verticalId: VERTICAL_ID,
      requiredGroup,
      inRequiredGroup,
    }));
  } catch (err) {
    return {
      allowed: false,
      error: 'pingone_admin_group_lookup_unavailable',
      status: 503,
      requiredGroup,
    };
  }

  const allowed = decision === 'PERMIT';
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
