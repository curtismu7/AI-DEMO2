/**
 * Session flag: user launched a use case from /use-cases and may need a clear
 * path back. TopNav reads this so "← Use Cases" stays visible after the
 * launcher navigate state is cleared by AIAgent.
 */

export const BX_FROM_USE_CASES_KEY = 'bx_from_use_cases';

/** Mark that the current flow started from the use-case launcher. */
export function markCameFromUseCases() {
  try {
    sessionStorage.setItem(BX_FROM_USE_CASES_KEY, '1');
  } catch {
    // sessionStorage may be unavailable (private mode / policy)
  }
}

/** Clear the launcher-origin flag (returning to /use-cases or dismissing). */
export function clearCameFromUseCases() {
  try {
    sessionStorage.removeItem(BX_FROM_USE_CASES_KEY);
  } catch {
    // ignore
  }
}

/** @returns {boolean} true when the user last launched from /use-cases */
export function cameFromUseCases() {
  try {
    return sessionStorage.getItem(BX_FROM_USE_CASES_KEY) === '1';
  } catch {
    return false;
  }
}
