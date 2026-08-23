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
// Bumped by _resetCache so an in-flight fetch that started before a toggle's
// invalidation can detect it was invalidated mid-flight and skip repopulating
// the cache with the pre-toggle answer it already fetched.
let _cacheGeneration = 0;

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
  _cacheGeneration++;
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

  const generationAtFetchStart = _cacheGeneration;
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

    // A toggle's _resetCache() may have run while this GET was in flight — if
    // so, caching now would repopulate the just-cleared cache with the
    // pre-toggle answer for up to CACHE_TTL_MS, silently undoing the
    // invalidation. Skip the write in that case; the fetched names are still
    // returned to this caller, just not cached for the next one.
    if (_cacheGeneration === generationAtFetchStart) {
      _setCached(pingOneUserId, verticalId, names);
    }
    return names;
  } catch (err) {
    console.warn(
      '[pingOneGroupMembershipService] live lookup failed — falling back to manifest:',
      err && err.message,
    );
    return null;
  }
}

/**
 * Demo-only accounts this service may reassign. A demo control that can move an
 * ARBITRARY user between groups is a privilege-escalation primitive reachable
 * from a browser; the allowlist keeps the blast radius at the three seeded demo
 * identities no matter what a caller sends.
 */
const TOGGLEABLE_USERNAMES = new Set(['demoUser', 'demoAdmin', 'demoDelegate']);

/** Resolve a PingOne group id by exact name. Returns null when absent. */
async function _findGroupIdByName(groupName) {
  const resp = await pingOneUserService.makeRequest(
    'GET',
    `/groups?filter=${encodeURIComponent(`name eq "${groupName}"`)}`,
  );
  const body = resp?.data ?? resp;
  const groups = body?._embedded?.groups || [];
  const match = groups.find((g) => g && g.name === groupName);
  return match?.id || null;
}

/**
 * Add or remove a demo user's membership of one group, live in PingOne.
 *
 * This exists so a demo can show a group-gated tool flip between PERMIT and DENY
 * without anyone opening the PingOne console. It is a REAL directory write —
 * that is the point. groupsForUser() prefers a live lookup, so a simulated
 * toggle would change the UI and not the decision, which is the exact class of
 * "looks correct, proves nothing" this demo exists to avoid.
 *
 * @param {object} p
 * @param {string} p.username        — must be in TOGGLEABLE_USERNAMES
 * @param {string} p.pingOneUserId
 * @param {string} p.groupName
 * @param {boolean} p.inGroup        — desired end state, not a delta
 * @returns {Promise<{changed: boolean, inGroup: boolean, groupId: string}>}
 */
async function setUserGroupMembership({ username, pingOneUserId, groupName, inGroup }) {
  if (!TOGGLEABLE_USERNAMES.has(username)) {
    const err = new Error(`refusing to change group membership for '${username}'`);
    err.code = 'user_not_toggleable';
    throw err;
  }
  if (!pingOneUserId) {
    const err = new Error('missing PingOne user id');
    err.code = 'missing_user_id';
    throw err;
  }

  pingOneUserService.initialize();
  const groupId = await _findGroupIdByName(groupName);
  if (!groupId) {
    const err = new Error(`group '${groupName}' does not exist in PingOne`);
    err.code = 'group_not_found';
    throw err;
  }

  let changed = true;
  if (inGroup) {
    try {
      await pingOneUserService.makeRequest(
        'POST', `/users/${pingOneUserId}/memberOfGroups`, { id: groupId },
      );
    } catch (err) {
      // Already a member is the desired end state, not a failure. Mirrors
      // _ensureUserInGroup in pingoneProvisionService.
      const already = err?.pingone?.status === 409
        || /already.*member|already exists/i.test(err?.message || '');
      if (!already) throw err;
      changed = false;
    }
  } else {
    try {
      await pingOneUserService.makeRequest(
        'DELETE', `/users/${pingOneUserId}/memberOfGroups/${groupId}`,
      );
    } catch (err) {
      // Not a member is likewise the desired end state.
      const absent = err?.pingone?.status === 404
        || /not found|not a member/i.test(err?.message || '');
      if (!absent) throw err;
      changed = false;
    }
  }

  // ⚠️ MUST bust the cache. Reads are memoised per (vertical, user) for 60s, so
  // without this the very next decision uses pre-toggle membership and the demo
  // shows the OLD answer for up to a minute — indistinguishable from the policy
  // ignoring the change. Clearing wholesale is deliberate: one group now serves
  // every vertical, so a toggle invalidates every vertical's entry, not just the
  // active one.
  _resetCache();

  return { changed, inGroup, groupId };
}

module.exports = {
  setUserGroupMembership,
  TOGGLEABLE_USERNAMES,
  isReady,
  listUserGroupNamesForVertical,
  _resetCache,
};
