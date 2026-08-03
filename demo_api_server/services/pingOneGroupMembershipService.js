'use strict';

/**
 * pingOneGroupMembershipService.js — live PingOne directory group membership.
 *
 * Resolves a user's group names via Management API GET /users/{id}/memberOfGroups.
 * Results are filtered to groups declared in the active vertical manifest and
 * cached briefly to avoid per-tool-call latency.
 */

const pingOneUserService = require('./pingOneUserService');
const groupPolicy = require('./groupPolicy');

const CACHE_TTL_MS = 60_000;
const _cache = new Map();

function _cacheKey(userId, verticalId) {
  return `${verticalId || 'banking'}:${userId}`;
}

function _getCached(userId, verticalId) {
  const entry = _cache.get(_cacheKey(userId, verticalId));
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    _cache.delete(_cacheKey(userId, verticalId));
    return null;
  }
  return entry.groups.slice();
}

function _setCached(userId, verticalId, groups) {
  _cache.set(_cacheKey(userId, verticalId), {
    groups: groups.slice(),
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

/** Drop cache entries (tests). */
function _resetCache() {
  _cache.clear();
}

/**
 * True when worker credentials are configured enough to call the Management API.
 */
function isReady() {
  try {
    pingOneUserService.initialize();
    return true;
  } catch {
    return false;
  }
}

/**
 * List PingOne group names for a user, filtered to the vertical's declared groups.
 */
async function listUserGroupNamesForVertical(pingOneUserId, verticalId) {
  if (!pingOneUserId) return null;

  const cached = _getCached(pingOneUserId, verticalId);
  if (cached) return cached;

  const allowed = new Set(groupPolicy.listGroupNamesForVertical(verticalId));
  if (allowed.size === 0) return [];

  try {
    pingOneUserService.initialize();
    const resp = await pingOneUserService.makeRequest(
      'GET',
      `/users/${pingOneUserId}/memberOfGroups`,
    );
    // ⚠️ TWO separate mistakes lived here, and EITHER ONE alone guarantees [].
    //
    // 1. NESTING. pingOneUserService.makeRequest resolves to the parsed BODY, not
    //    an axios-style { data } envelope. `resp.data` is undefined.
    // 2. KEY. PingOne's GET /users/{id}/memberOfGroups returns
    //    _embedded.groupMemberships — not _embedded.groups, and not
    //    _embedded.memberOfGroups (the endpoint's own name).
    //
    // The failure is silent and total: `embedded` is [], a user in 15 groups
    // resolves to ZERO, and this returns [] from a SUCCESSFUL call. An empty
    // array is NOT treated as "lookup failed" — groupPolicy.groupsForUser lets it
    // BEAT the manifest. So every group-gated tool denied every user, including
    // demoUser, the moment ff_authorize_group_policy was enabled. That is the
    // opposite of the intended demo and looks like a policy bug.
    //
    // Verified live 2026-08-03 against env 01d89b06: demoUser is in 15 groups
    // (AI_Demo_Privileged, Banking_PremiumTier, …) and this returned [].
    //
    // The unit test could not catch it: its fixture mocked
    // { data: { _embedded: { groups } } }, encoding BOTH mistakes, so the parser
    // was proven correct against a shape PingOne never sends.
    //
    // `resp.data ?? resp` and the extra key fallbacks are belt-and-braces so a
    // future client or API change degrades instead of silently emptying again.
    const body = resp?.data ?? resp;
    const embedded = body?._embedded?.groupMemberships
      || body?._embedded?.groups
      || body?._embedded?.memberOfGroups
      || [];
    const names = embedded
      // With ?expand=group the name moves under _embedded.group; without it the
      // membership carries `name` directly. Accept both so neither form silently
      // yields an unnamed entry that filters out to nothing.
      .map((g) => (g && (g.name || g._embedded?.group?.name)) || null)
      .filter((name) => name && allowed.has(name));

    _setCached(pingOneUserId, verticalId, names);
    return names;
  } catch (err) {
    console.warn(
      '[pingOneGroupMembershipService] live lookup failed — falling back to manifest:',
      err && err.message,
    );
    return null;
  }
}

module.exports = {
  isReady,
  listUserGroupNamesForVertical,
  _resetCache,
};
