'use strict';

/**
 * Auth-requirement SoT reader.
 *
 * `auth-requirements.json` answers one question for every demo surface: what
 * must the visitor be signed in as for this to work? Before it existed the
 * answer was spread across a client `isLoggedIn` check per call site, a
 * hand-written guest allowlist in agentRun.js, and inline route guards — so a
 * public use case (UC24 Act 1) still triggered a sign-in prompt.
 *
 * Read-only and lazy: the file is static config, so it loads once per process.
 */

const AUTH_REQUIREMENTS = require('./auth-requirements.json');

const LEVELS = AUTH_REQUIREMENTS.levels;
const DEFAULT_LEVEL = AUTH_REQUIREMENTS.defaultLevel;

/** Ascending strictness — index doubles as the comparison rank. */
const RANK = new Map(LEVELS.map((level, i) => [level, i]));

/**
 * Auth level for a use-case id (`UC24`, `ADMIN1`).
 * Unknown ids fall back to the strictest sensible default rather than `public`
 * — an unlisted use case must not become anonymously runnable by omission.
 * @param {string} id
 * @returns {'public'|'user'|'admin'}
 */
function authLevelForUseCase(id) {
  return AUTH_REQUIREMENTS.useCases[id] || DEFAULT_LEVEL;
}

/**
 * Auth level for an app route path. Routes are listed only where a use case
 * links to them; anything else answers with the default.
 * @param {string} path
 * @returns {'public'|'user'|'admin'}
 */
function authLevelForRoute(path) {
  return AUTH_REQUIREMENTS.routes[path] || DEFAULT_LEVEL;
}

/** @param {string} id @returns {boolean} true when the use case runs signed out. */
function isPublicUseCase(id) {
  return authLevelForUseCase(id) === 'public';
}

/**
 * Compare two levels. Positive when `a` is stricter than `b`.
 * @param {string} a @param {string} b @returns {number}
 */
function compareLevels(a, b) {
  return (RANK.get(a) ?? RANK.get(DEFAULT_LEVEL)) - (RANK.get(b) ?? RANK.get(DEFAULT_LEVEL));
}

module.exports = {
  AUTH_REQUIREMENTS,
  LEVELS,
  DEFAULT_LEVEL,
  authLevelForUseCase,
  authLevelForRoute,
  isPublicUseCase,
  compareLevels,
};
