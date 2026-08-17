// demo_api_ui/src/utils/useCaseAuth.js

/**
 * Client reader for the use-case auth SoT.
 *
 * The level is stamped onto every catalog entry by the server
 * (demo_api_server/config/use-case-auth.json → resolveUseCase), so there is no
 * second list to keep in sync here — only the fallback when a caller hands us
 * an entry that predates the field.
 *
 * Why this exists: the demo-step gates used to ask "is the user signed in, or
 * is this the marketing path?" and never "does this step need a session at
 * all?". UC24 answers fine for a guest, but the client told them to sign in.
 */

/** Applied when an entry carries no level — fail closed, never public. */
const DEFAULT_AUTH_LEVEL = 'user';

const AUTH_LEVELS = new Set(['public', 'user', 'admin']);

/**
 * @param {object|null|undefined} uc resolved catalog entry
 * @returns {'public'|'user'|'admin'}
 */
export function authLevelForUseCase(uc) {
  const level = uc && typeof uc === 'object' ? uc.auth : undefined;
  return AUTH_LEVELS.has(level) ? level : DEFAULT_AUTH_LEVEL;
}

/**
 * True when a signed-out visitor can run this step end to end, so the client
 * must not gate it behind a sign-in prompt.
 * @param {object|null|undefined} uc resolved catalog entry
 * @returns {boolean}
 */
export function isPublicUseCase(uc) {
  return authLevelForUseCase(uc) === 'public';
}
