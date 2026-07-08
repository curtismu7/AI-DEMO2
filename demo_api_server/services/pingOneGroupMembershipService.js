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
    const embedded = resp.data?._embedded?.groups || resp.data?._embedded?.['memberOfGroups'] || [];
    const names = embedded
      .map((g) => g && g.name)
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
