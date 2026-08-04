'use strict';

/**
 * groupMembership.js — vertical-scoped PingOne group membership for the demo UI.
 * Live directory lookup when worker creds exist; manifest fallback otherwise.
 */

const express = require('express');
const configStore = require('../services/configStore');
const groupPolicy = require('../services/groupPolicy');
const pingOneGroupMembershipService = require('../services/pingOneGroupMembershipService');
const pingOneAuthorizeService = require('../services/pingOneAuthorizeService');
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
 * GET /api/groups/decision-board
 *
 * One live PingOne Authorize decision per vertical, for that vertical's
 * group-gated tool, using the signed-in user's REAL directory membership.
 *
 * This is the page the group demo is for: flipping one membership and watching
 * every vertical move together is something no single chip can show. Each row is
 * a real decision from the same endpoint the PEP calls — not a simulation and not
 * a re-statement of the manifest, because the point being demonstrated is that
 * the POLICY decides.
 *
 * ⚠️ Costs one decision call per gated vertical (11 today). Fine for a demo page
 * a human loads; do not put it behind anything that polls.
 */
router.get('/decision-board', requireSession, async (req, res) => {
  try {
    await configStore.ensureInitialized();
    verticalManifest.init();

    const username = req.session?.user?.username || null;
    const pingOneUserId = resolvePingOneUserId(req.session?.user);

    // Every vertical that declares a group-gated tool, straight from the
    // manifests — so a vertical added later appears here with no code change.
    const targets = [];
    for (const def of groupPolicy.listAllVerticalGroupDefinitions()) {
      for (const [tool, category] of Object.entries(def.restrictedTools || {})) {
        const manifest = verticalManifest.resolver.resolve(def.verticalId);
        targets.push({
          verticalId: def.verticalId,
          displayName: manifest?.identity?.displayName || def.verticalId,
          tool,
          requiredGroup: groupPolicy.groupNameForCategory(def.verticalId, category),
        });
      }
    }

    const rows = await Promise.all(targets.map(async (t) => {
      // Membership is per-vertical because listGroupNamesForVertical filters to
      // that vertical's declared groups — even though one generic group now
      // serves them all, this keeps working if that is ever split again.
      let groups = groupPolicy.groupsForUserSync(username, t.verticalId);
      let source = 'manifest';
      if (pingOneUserId && pingOneGroupMembershipService.isReady()) {
        const live = await pingOneGroupMembershipService
          .listUserGroupNamesForVertical(pingOneUserId, t.verticalId);
        if (Array.isArray(live)) { groups = live; source = 'pingone'; }
      }
      const inRequiredGroup = Boolean(t.requiredGroup && groups.includes(t.requiredGroup));

      try {
        const r = await pingOneAuthorizeService.evaluateMcpToolDelegation({
          userId: pingOneUserId,
          clientId: pingOneUserId,
          toolName: t.tool,
          verticalId: t.verticalId,
          requiredGroup: t.requiredGroup,
          userGroups: groups,
          inRequiredGroup,
          userTier: groupPolicy.resolveUserTier(groups, t.verticalId),
        });
        const codes = ((r.raw && r.raw.statements) || []).map((s) => s.code).filter(Boolean);
        return {
          ...t, inRequiredGroup, source, decision: r.decision, codes,
        };
      } catch (err) {
        // A failed probe must read as UNKNOWN, never as PERMIT. A board that
        // shows green when it could not ask is worse than one that shows nothing.
        return {
          ...t, inRequiredGroup, source, decision: 'UNKNOWN', codes: [], error: err.message,
        };
      }
    }));

    rows.sort((a, b) => a.displayName.localeCompare(b.displayName));
    return res.json({
      username,
      pingOneUserId,
      liveLookupReady: pingOneGroupMembershipService.isReady(),
      policyEnabled: groupPolicy.isEnabled(configStore),
      rows,
    });
  } catch (err) {
    console.error('[groupMembership] decision board failed:', err.message);
    return res.status(500).json({ error: 'decision_board_failed', message: err.message });
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
