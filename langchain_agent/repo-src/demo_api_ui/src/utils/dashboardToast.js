// banking_api_ui/src/utils/dashboardToast.js
import { toast } from 'react-toastify';
import { errorMessageSuggestsLogin, SESSION_REAUTH_EVENT } from './authUi';

/**
 * Show an error toast; session-style messages raise an app-level banner with Sign in (see App.js).
 * @param {string} message
 * @param {() => void} _onSignIn — kept for call-site compatibility; routing uses `SESSION_REAUTH_EVENT` role `customer`
 */
export function toastCustomerError(message, _onSignIn) {
  if (message == null || message === '') return;
  if (errorMessageSuggestsLogin(message)) {
    window.dispatchEvent(
      new CustomEvent(SESSION_REAUTH_EVENT, { detail: { message, role: 'customer' } })
    );
    return;
  }
  toast.error(message);
}

/**
 * Admin dashboard session errors — login CTA is shown on-page (banner), not only as toast.
 * @param {string} message
 * @param {() => void} _onAdminSignIn — kept for compatibility; role `admin` in event detail
 */
export function toastAdminSessionError(message, _onAdminSignIn) {
  if (message == null || message === '') return;
  if (errorMessageSuggestsLogin(message)) {
    window.dispatchEvent(
      new CustomEvent(SESSION_REAUTH_EVENT, { detail: { message, role: 'admin' } })
    );
    return;
  }
  toast.error(message);
}
