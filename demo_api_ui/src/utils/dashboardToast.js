// banking_api_ui/src/utils/dashboardToast.js
/**
 * Session-loss notifications for the dashboards.
 *
 * These are NOT toasts. A toast that says "please sign in again" gives the user
 * nothing to click and then auto-dismisses; the `onSignIn` callback every call
 * site passes was documented as unused and never wired to anything. Both
 * helpers now raise the shared sign-in interrupt (`SESSION_REAUTH_EVENT` →
 * `SignInModal`), which carries a real CTA and a `returnTo`.
 *
 * Signatures are unchanged so the 14 existing call sites keep working.
 */
import { SESSION_REAUTH_EVENT } from './authUi';

/**
 * @param {string} message
 * @param {'admin' | 'customer'} role
 */
function raiseSignInInterrupt(message, role) {
  if (message == null || message === '') return;
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(SESSION_REAUTH_EVENT, {
      detail: { message, role, invalidateSession: true },
    }),
  );
}

/**
 * Customer dashboard lost its session.
 * @param {string} message
 * @param {() => void} _onSignIn — unused; kept for call-site compatibility
 */
export function toastCustomerError(message, _onSignIn) {
  raiseSignInInterrupt(message, 'customer');
}

/**
 * Admin dashboard lost its session.
 * @param {string} message
 * @param {() => void} _onAdminSignIn — unused; kept for call-site compatibility
 */
export function toastAdminSessionError(message, _onAdminSignIn) {
  raiseSignInInterrupt(message, 'admin');
}
