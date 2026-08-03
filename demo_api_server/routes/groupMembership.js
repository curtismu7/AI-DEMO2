'use strict';

/**
 * groupMembership.js — vertical-scoped PingOne group membership for the demo UI.
 * Live directory lookup when worker creds exist; manifest fallback otherwise.
 */

const express = require('express');
const configStore = require('../services/configStore');
const groupPolicy = require('../services/groupPolicy');
const pingOneGroupMembershipService = require('../services/pingOneGroupMembershipService');
const { verticalManifest } = require('../services/verticalManifest');
const { requireSession } = require('../middleware/auth');
const { provisionVerticalGroups } = require('../services/pingOneGroupProvisionService');

const router = express.Router();

/** Admin-only gate for group provisioning. */
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'admin_required' });
  }
  return next();
}

/** Resolve PingOne user id from session (PingOne sub, not legacy numeric id). */
function resolvePingOneUserId(sessionUser) {
  if (!sessionUser) return null;
  return sessionUser.oauthId || sessionUser.sub || null;
}

/**
 * GET /api/groups/membership
 * Returns the active vertical's group categories, the user's resolved membership,
 * and whether data came from PingOne directory or manifest fallback.
 */
router.get('/membership', requireSession, async (req, res) => {
  try {
    await configStore.ensureInitialized();
    verticalManifest.init();

    const verticalId = verticalManifest.resolver.activeIdFor(req) || 'banking';
    const username = req.session?.user?.username || null;
    const pingOneUserId = resolvePingOneUserId(req.session?.user);
    const manifest = verticalManifest.resolver.resolve(verticalId);
    const groupsConfig = manifest?.groups || null;

    let source = 'manifest';
    let groups = groupPolicy.groupsForUserSync(username, verticalId);

    if (pingOneUserId && pingOneGroupMembershipService.isReady()) {
      const live = await pingOneGroupMembershipService.listUserGroupNamesForVertical(
        pingOneUserId,
        verticalId,
      );
      if (Array.isArray(live)) {
        groups = live;
        source = 'pingone';
      }
    }

    const restrictedTools = {};
    if (groupsConfig?.restrictedTools) {
      for (const [tool, category] of Object.entries(groupsConfig.restrictedTools)) {
        restrictedTools[tool] = groupPolicy.groupNameForCategory(verticalId, category);
      }
    }

    res.json({
      verticalId,
      displayName: manifest?.identity?.displayName || verticalId,
      policyEnabled: groupPolicy.isEnabled(configStore),
      username,
      pingOneUserId,
      source,
      groups,
      userTier: groupPolicy.resolveUserTier(groups, verticalId),
      categories: groupsConfig?.categories || {},
      restrictedTools,
      liveLookupReady: pingOneGroupMembershipService.isReady(),
    });
  } catch (err) {
    console.error('[groupMembership] membership lookup failed:', err.message);
    res.status(500).json({
      error: 'group_membership_failed',
      message: err.message,
    });
  }
});

/**
 * POST /api/groups/membership/toggle
 * Move the SIGNED-IN demo user in or out of the active vertical's group for a
 * category (default `privileged`), live in PingOne.
 *
 * Body: { inGroup: boolean, category?: string }
 *
 * Why a real directory write: groupPolicy.groupsForUser() prefers a live lookup,
 * so a simulated toggle would change the UI and not the decision. The demo's
 * whole claim is that the policy decides — a toggle that only moves a local flag
 * would prove nothing while looking identical.
 *
 * Deliberately NOT admin-gated: the point is that the person running the demo
 * flips their own membership without leaving the app. The service allowlists the
 * three seeded demo usernames, so this cannot reassign a real user.
 */
router.post('/membership/toggle', requireSession, async (req, res) => {
  try {
    await configStore.ensureInitialized();
    verticalManifest.init();

    const { inGroup, category = 'privileged' } = req.body || {};
    if (typeof inGroup !== 'boolean') {
      return res.status(400).json({ error: 'inGroup must be a boolean' });
    }

    const verticalId = verticalManifest.resolver.activeIdFor(req) || 'banking';
    const username = req.session?.user?.username || null;
    const pingOneUserId = resolvePingOneUserId(req.session?.user);
    const groupName = groupPolicy.groupNameForCategory(verticalId, category);

    if (!groupName) {
      return res.status(400).json({
        error: 'unknown_group_category',
        message: `vertical '${verticalId}' declares no '${category}' group`,
      });
    }
    if (!pingOneGroupMembershipService.isReady()) {
      return res.status(503).json({
        error: 'live_lookup_unavailable',
        message: 'PingOne worker credentials are not configured, so membership cannot be changed.',
      });
    }

    const result = await pingOneGroupMembershipService.setUserGroupMembership({
      username, pingOneUserId, groupName, inGroup,
    });

    // Read back from PingOne rather than echoing the request. A toggle that
    // reports success from its own input would hide a write that silently did
    // nothing — the failure mode this whole feature already hit once.
    const groups = await pingOneGroupMembershipService.listUserGroupNamesForVertical(
      pingOneUserId, verticalId,
    );

    return res.json({
      verticalId,
      username,
      groupName,
      category,
      requested: inGroup,
      changed: result.changed,
      inGroup: Array.isArray(groups) ? groups.includes(groupName) : inGroup,
      groups: groups || [],
      userTier: groupPolicy.resolveUserTier(groups || [], verticalId),
      verified: Array.isArray(groups),
    });
  } catch (err) {
    const code = err.code === 'user_not_toggleable' ? 403
      : err.code === 'group_not_found' ? 404
        : 500;
    console.error('[groupMembership] toggle failed:', err.message);
    return res.status(code).json({
      error: err.code || 'group_toggle_failed',
      message: err.message,
    });
  }
});

/**
 * POST /api/groups/provision
 * Create vertical-scoped PingOne groups via Management API (no full bootstrap).
 * Body: { verticalId?: string } — omit to provision all verticals with groups config.
 */
router.post('/provision', requireSession, requireAdmin, async (req, res) => {
  try {
    const verticalId = req.body?.verticalId || null;
    const result = await provisionVerticalGroups({ verticalId });
    res.json(result);
  } catch (err) {
    console.error('[groupMembership] provision failed:', err.message);
    res.status(500).json({
      error: 'group_provision_failed',
      message: err.message,
    });
  }
});

module.exports = router;
