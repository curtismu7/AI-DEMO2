// demo_api_ui/src/utils/useCaseAuth.js
/**
 * Reads the auth level the BFF stamps onto every catalog entry from
 * `demo_api_server/config/auth-requirements.json`.
 *
 * Before this, each call site asked `isLoggedIn` and got the same answer for
 * every use case — so UC24 (Act 1, public catalog by definition) was gated like
 * a transfer. Gate on the level, not on the call site.
 */

/** Fail closed: a catalog entry with no level is treated as needing a session. */
export const DEFAULT_USE_CASE_AUTH = 'user';

/**
 * @param {{ auth?: string } | null | undefined} uc
 * @returns {'public' | 'user' | 'admin'}
 */
export function authLevelOf(uc) {
  const level = uc && typeof uc.auth === 'string' ? uc.auth : '';
  return level === 'public' || level === 'user' || level === 'admin'
    ? level
    : DEFAULT_USE_CASE_AUTH;
}

/**
 * True when the use case is defined to work signed out.
 * @param {{ auth?: string } | null | undefined} uc
 * @returns {boolean}
 */
export function runsSignedOut(uc) {
  return authLevelOf(uc) === 'public';
}

/**
 * True when the current visitor satisfies the use case's level.
 * @param {{ auth?: string } | null | undefined} uc
 * @param {{ isLoggedIn?: boolean, isAdmin?: boolean }} viewer
 * @returns {boolean}
 */
export function viewerMeetsUseCaseAuth(uc, { isLoggedIn = false, isAdmin = false } = {}) {
  const level = authLevelOf(uc);
  if (level === 'public') return true;
  if (level === 'admin') return !!isAdmin;
  return !!isLoggedIn;
}
