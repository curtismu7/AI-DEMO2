'use strict';

/**
 * useCaseDemoBehaviors.js — launcher-driven demo behaviors for needs-build → works chips.
 * Each helper is keyed on the catalog useCaseId slug (not UC# id). Behaviors fire only
 * when the Use Case Launcher (or agent run session) supplies a validated useCaseId.
 */

const { isValidUseCaseId } = require('../config/useCases');
const { stampUseCaseId } = require('./useCaseTagging');

/** Catalog slugs for the four chips implemented here. */
const AGENT_IDENTITY_LIFECYCLE = 'agent-identity-lifecycle';
const AUDIT_TRAIL = 'audit-trail';
const ENTITLEMENT_TIERED = 'entitlement-tiered-capability';
const JIT_EPHEMERAL = 'jit-ephemeral-credentials';
const GROUP_ENTITLEMENT = 'group-entitlement-check';

/** Short delegated-token TTL for UC17 (5 minutes). */
const JIT_TOKEN_LIFETIME_SEC = 300;

/** Premium tier group used when UC21 forces tier-expanded capability in the demo. */
const UC21_DEMO_PREMIUM_GROUP = 'Banking_PremiumTier';

/**
 * Resolve the active useCaseId from the request body or agent-run session stash.
 * @param {object} [req]
 * @returns {string|null}
 */
function resolveActiveUseCaseId(req) {
  const bodyId = typeof req?.body?.useCaseId === 'string' ? req.body.useCaseId.trim() : '';
  if (bodyId && isValidUseCaseId(bodyId)) return bodyId;
  const sessionId = typeof req?.session?.agentRunUseCaseId === 'string'
    ? req.session.agentRunUseCaseId.trim()
    : '';
  if (sessionId && isValidUseCaseId(sessionId)) return sessionId;
  return null;
}

/**
 * UC19 — simulate a retired agent app credential blocking token exchange (401).
 * @param {string|null} useCaseId
 * @returns {boolean}
 */
function shouldSimulateRetiredAgentExchange(useCaseId) {
  return useCaseId === AGENT_IDENTITY_LIFECYCLE;
}

/**
 * UC17 — build exchange options requesting a short-lived delegated token.
 * @param {string|null} useCaseId
 * @returns {{ tokenLifetime?: number }}
 */
function buildJitExchangeOptions(useCaseId) {
  if (useCaseId !== JIT_EPHEMERAL) return {};
  return { tokenLifetime: JIT_TOKEN_LIFETIME_SEC };
}

/**
 * UC21 — force tier policy evaluation and premium-tier groups for the demo chip.
 * @param {string|null} useCaseId
 * @returns {boolean}
 */
function shouldApplyEntitlementTierDemo(useCaseId) {
  return useCaseId === ENTITLEMENT_TIERED;
}

/**
 * UC9 — resolve REAL PingOne group membership for the group-entitlement chip
 * without turning on ff_authorize_group_policy globally.
 *
 * The flag is process-wide: flipping it for a demo changes behaviour for anyone
 * else using the app, survives a crashed or abandoned run, and can be turned OFF
 * mid-run by the 400-on-UserGroups self-heal in mcpToolAuthorizationService —
 * which also silently disables every banking tier ceiling. Scoping to the
 * request avoids all of that and needs no restore step.
 *
 * ⚠️ Unlike UC21, this must NOT inject any group. UC21 force-adds the premium
 * group so its PERMIT branch always renders; doing that here would make the
 * demo's in-group/out-of-group toggle decorative — the user would read as
 * privileged no matter which way it was set, and the DENY half of UC9 would be
 * unreachable. See resolveDemoUserGroupsForUseCase, which injects for
 * ENTITLEMENT_TIERED only.
 *
 * @param {string|null} useCaseId
 * @returns {boolean}
 */
function shouldApplyGroupPolicyDemo(useCaseId) {
  return useCaseId === GROUP_ENTITLEMENT;
}

/**
 * UC21 — override user groups so the simulated/live Authorize path sees PrivateBanking.
 * @param {string|null} useCaseId
 * @param {string[]|null} userGroups
 * @returns {string[]|null}
 */
function resolveDemoUserGroupsForUseCase(useCaseId, userGroups) {
  if (!shouldApplyEntitlementTierDemo(useCaseId)) return userGroups;
  const base = Array.isArray(userGroups) ? userGroups.slice() : [];
  if (!base.includes(UC21_DEMO_PREMIUM_GROUP)) base.push(UC21_DEMO_PREMIUM_GROUP);
  return base;
}

/**
 * Stamp useCaseId on token events when the launcher tagged the flow (UC20 audit trail).
 * @param {object[]} tokenEvents
 * @param {string|null} useCaseId
 */
function stampTokenEventsForUseCase(tokenEvents, useCaseId) {
  if (!useCaseId) return;
  stampUseCaseId(tokenEvents, useCaseId);
}

/**
 * Build metadata for appEventService when a useCaseId is active.
 * @param {string|null} useCaseId
 * @param {object} [metadata]
 * @returns {object}
 */
function buildEventMetadata(useCaseId, metadata = {}) {
  if (!useCaseId) return metadata;
  return { ...metadata, useCaseId };
}

module.exports = {
  AGENT_IDENTITY_LIFECYCLE,
  AUDIT_TRAIL,
  ENTITLEMENT_TIERED,
  JIT_EPHEMERAL,
  JIT_TOKEN_LIFETIME_SEC,
  UC21_DEMO_PREMIUM_GROUP,
  resolveActiveUseCaseId,
  shouldSimulateRetiredAgentExchange,
  buildJitExchangeOptions,
  shouldApplyEntitlementTierDemo,
  shouldApplyGroupPolicyDemo,
  resolveDemoUserGroupsForUseCase,
  stampTokenEventsForUseCase,
  buildEventMetadata,
};
