'use strict';

/**
 * enterpriseMcpPolicyService.js
 * IT policy gate for Enterprise-Managed MCP Authorization (Phase 2 demo).
 * Checks PingOne population/group membership before RFC 8693 stand-in exchange.
 */

const configStore = require('./configStore');
const scopeTopology = require('./scopeTopology');
const groupPolicy = require('./groupPolicy');
const { logEvent } = require('./appEventService');
const { isEnterpriseManagedFlagOn } = require('./enterpriseMcpMetadata');

const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Policy cache TTL. Default unchanged at 5 minutes; UC39 lowers it so a
 * revocation is visible during a live demo rather than appearing broken for
 * up to five minutes after IT removes the user from the group.
 */
function getCacheTtlMs() {
  const raw = configStore.getEffective('enterprise_mcp_policy_cache_ttl_ms');
  if (raw === '' || raw === null || raw === undefined) return CACHE_TTL_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : CACHE_TTL_MS;
}

/**
 * Revoke an MCP access token the session is still holding.
 *
 * Denying the NEXT mint does nothing about a token already in hand, so without
 * this a revoked user keeps working until the token expires — which reads as
 * "revocation does not work". Best effort: the failure path still denies, and
 * the token is short-lived regardless.
 */
async function revokeHeldMcpToken(req) {
  const token = req && req.session && req.session.mcpAccessToken;
  const tokenUrl = String(configStore.getEffective('enterprise_mcp_as_token_url') || '').trim();
  if (!token || !tokenUrl) return;

  try {
    const axios = require('axios');
    await axios.post(
      tokenUrl.replace(/\/token$/, '/revoke'),
      new URLSearchParams({ token }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 5000 },
    );
  } catch (_err) {
    // Best effort — the next mint is already denied and the token is short-lived.
  }
  req.session.mcpAccessToken = null;
}

/** Parse comma-separated config/env list. */
function parseCsv(raw) {
  if (!raw || typeof raw !== 'string') return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function isEnabled() {
  return isEnterpriseManagedFlagOn(configStore);
}

function getAllowedGroups() {
  const fromStore = configStore.getEffective('enterprise_mcp_allowed_groups');
  if (fromStore) return parseCsv(String(fromStore));
  return parseCsv(process.env.ENTERPRISE_MCP_ALLOWED_GROUPS || 'banking-agents,employees');
}

function getAllowedResourceUris() {
  const fromStore = configStore.getEffective('enterprise_mcp_resource_uris');
  const fromEnv = fromStore ? parseCsv(String(fromStore)) : parseCsv(process.env.ENTERPRISE_MCP_RESOURCE_URIS || '');
  if (fromEnv.length) return fromEnv;
  try {
    const aud = scopeTopology.audiences();
    return [aud.mcpServer, aud.mcpGateway].filter(Boolean);
  } catch {
    return [];
  }
}

/** List PingOne group names for a user, or null when API unavailable. */
async function listPingOneGroupNames(userId) {
  if (!userId) return [];
  try {
    const pingOneUserService = require('./pingOneUserService');
    if (!pingOneUserService.environmentId) {
      pingOneUserService.initialize();
    }
    const resp = await pingOneUserService.makeRequest('GET', `/users/${userId}/memberOfGroups`);
    const groups = resp?._embedded?.groups || [];
    return groups.map((g) => g.name || g.id).filter(Boolean);
  } catch (err) {
    return null;
  }
}

/** Demo fallback when PingOne Management API is unavailable. */
function demoGroupsForUser(req) {
  const username = req.session?.user?.username;
  // groupsForUserSync, not groupsForUser: this function is synchronous, and the
  // async one returned a Promise here whose `.length` was always undefined — so
  // the manifest branch could never fire. No pingOneUserId is available on this
  // path anyway, which is exactly what groupsForUserSync is for.
  const fromPolicy = groupPolicy.groupsForUserSync(username);
  if (fromPolicy.length) return fromPolicy;
  const allowed = getAllowedGroups();
  if (username && allowed.includes(username)) return [username];
  return [];
}

/**
 * Evaluate enterprise MCP policy for the current session user.
 * @param {import('express').Request} req
 * @returns {Promise<{ allowed: boolean, code?: string, httpStatus?: number, message?: string, matchDetail?: string }>}
 */
async function checkPolicy(req) {
  if (!isEnabled()) {
    return {
      allowed: false,
      code: 'enterprise_mcp_not_enabled',
      httpStatus: 400,
      message: 'Enterprise-managed MCP authorization is not enabled in this environment.',
    };
  }

  const cacheTtlMs = getCacheTtlMs();
  const cache = req.session?.enterpriseMcpPolicyCache;
  if (cacheTtlMs > 0 && cache && cache.expiresAt > Date.now() && cache.result) {
    return cache.result;
  }

  const allowedGroups = getAllowedGroups();
  const userSub = req.session?.user?.oauthId || req.session?.user?.sub || null;
  const username = req.session?.user?.username || null;
  const populationId =
    req.session?.populationId ||
    req.session?.user?.populationId ||
    null;

  let matched = false;
  let matchDetail = null;

  if (populationId && allowedGroups.includes(populationId)) {
    matched = true;
    matchDetail = `population:${populationId}`;
  }

  if (!matched && userSub) {
    const pingGroups = await listPingOneGroupNames(userSub);
    const groups = pingGroups === null ? demoGroupsForUser(req) : pingGroups;
    const overlap = groups.filter((g) => allowedGroups.includes(g));
    if (overlap.length) {
      matched = true;
      matchDetail = `group:${overlap[0]}`;
    }
  }

  if (!matched && username && allowedGroups.includes(username)) {
    matched = true;
    matchDetail = `allowlist:${username}`;
  }

  let result;
  if (matched) {
    result = { allowed: true, matchDetail };
    logEvent('enterprise_mcp', 'info', 'enterprise_mcp.policy_check — PERMIT', {
      tag: 'enterprise_mcp/policy_check',
      metadata: { matchDetail, userSub, username },
    });
  } else {
    result = {
      allowed: false,
      code: 'enterprise_mcp_policy_denied',
      httpStatus: 403,
      message:
        'Your account is not authorized for enterprise-managed MCP access. ' +
        'Contact IT to request access (for example, membership in the banking-agents group).',
    };
    logEvent('enterprise_mcp', 'warning', 'enterprise_mcp.policy_check — DENY', {
      tag: 'enterprise_mcp/policy_check',
      metadata: { userSub, username, allowedGroups },
    });
  }

  if (!result.allowed) {
    // Revoke before returning: denying the next mint leaves a token already in
    // hand fully valid, which reads as revocation not working.
    await revokeHeldMcpToken(req);
  }

  if (req.session) {
    req.session.enterpriseMcpPolicyCache = {
      result,
      expiresAt: Date.now() + cacheTtlMs,
    };
    req.session.enterpriseMcpPolicy = {
      allowed: result.allowed,
      code: result.code || null,
      matchDetail: result.matchDetail || null,
    };
  }

  return result;
}

/** Mark session as enterprise-auto-connected when policy permits. */
async function establishEnterpriseSession(req) {
  const policy = await checkPolicy(req);
  if (!policy.allowed || !req.session) return policy;

  if (!req.session.agentConsentGiven) {
    req.session.agentConsentGiven = true;
    req.session.agentConsentedAt = new Date().toISOString();
    req.session.enterpriseMcpAutoConnect = true;
  }
  return policy;
}

module.exports = {
  isEnabled,
  getAllowedGroups,
  getAllowedResourceUris,
  checkPolicy,
  establishEnterpriseSession,
  CACHE_TTL_MS,
  getCacheTtlMs,
  revokeHeldMcpToken,
};
