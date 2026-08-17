'use strict';

/**
 * Use-case auth SoT — reader for config/use-case-auth.json.
 *
 * Answers one question: what does a visitor need in order to ACTIVATE a demo
 * step and get its intended result — nothing, any session, or an admin session.
 *
 * Before this manifest the answer only existed implicitly, split across
 * `PUBLIC_GUEST_ACTIONS` in routes/agentRun.js (one route, action-level,
 * invisible to the UI) and a set of client-side gates that checked the page
 * path instead of the use case. The UI therefore told a guest to sign in for
 * UC24 — a step the server answers fine without a session.
 *
 * This is a UI-gating SoT, not an enforcement point. Server enforcement is
 * unchanged: `PUBLIC_GUEST_ACTIONS` still decides what a guest may run on
 * /api/agent/run, and each route keeps its own guard.
 *
 * Drift is caught by `npm run verify:usecase-auth`.
 */

const MANIFEST = require('./use-case-auth.json');

/** @typedef {'public'|'user'|'admin'} AuthLevel */

/** Valid values for a manifest entry. */
const AUTH_LEVELS = Object.freeze(new Set(MANIFEST.levels));

/** Applied when an id is absent from the manifest — fail closed, never public. */
const DEFAULT_AUTH_LEVEL = 'user';

/**
 * Auth level for a use-case / demo-step id (e.g. 'UC24', 'ADMIN5').
 * @param {string|null|undefined} id
 * @returns {AuthLevel}
 */
function authLevelFor(id) {
  if (!id || typeof id !== 'string') return DEFAULT_AUTH_LEVEL;
  const level = MANIFEST.useCases[id];
  return AUTH_LEVELS.has(level) ? level : DEFAULT_AUTH_LEVEL;
}

/**
 * True when a signed-out visitor can run this step end to end.
 * @param {string|null|undefined} id
 * @returns {boolean}
 */
function isPublicUseCaseId(id) {
  return authLevelFor(id) === 'public';
}

module.exports = {
  USE_CASE_AUTH: MANIFEST.useCases,
  AUTH_LEVELS,
  DEFAULT_AUTH_LEVEL,
  authLevelFor,
  isPublicUseCaseId,
};
