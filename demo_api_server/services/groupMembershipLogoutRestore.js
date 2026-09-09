'use strict';

/**
 * groupMembershipLogoutRestore.js — logout-time backstop for the group-gated
 * demo steps.
 *
 * The client restores membership after a UC9 run, but a closed tab or a
 * thrown error between toggle and restore strands the demo user OUTSIDE
 * premiumTier — which breaks UC2/UC37 (they share the gated tool) and
 * reddens /group-policy for everyone on a shared cluster.
 *
 * Best-effort only: logout must never fail because a group write failed, and
 * a throw here would mask whatever error sent the user to logout in the
 * first place. Extracted out of the /api/auth/logout handler in server.js so
 * this behaviour is unit-testable without booting the whole app.
 */

const groupPolicy = require('./groupPolicy');
const pingOneGroupMembershipService = require('./pingOneGroupMembershipService');
const { verticalManifest } = require('./verticalManifest');

/**
 * @param {import('express').Request} req — read before req.session.destroy()
 *   is called; this function only reads the session, never destroys it.
 */
async function restorePremiumTierOnLogout(req) {
  try {
    const verticalId = verticalManifest.resolver.activeIdFor(req) || 'banking';
    const groupName = groupPolicy.groupNameForCategory(verticalId, 'premiumTier');
    if (groupName && pingOneGroupMembershipService.isReady()) {
      await pingOneGroupMembershipService.setUserGroupMembership({
        username: req.session?.user?.username || null,
        pingOneUserId: req.session?.user?.oauthId || req.session?.user?.sub || null,
        groupName,
        inGroup: true,
      });
    }
  } catch (err) {
    console.warn('[auth] premiumTier restore on logout failed:', err.message);
  }
}

module.exports = { restorePremiumTierOnLogout };
