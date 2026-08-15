// banking_api_ui/src/utils/dashboardToast.js
import { toast } from 'react-toastify';

/**
 * Show an error toast for a customer dashboard data-fetch failure.
 * @param {string} message
 * @param {() => void} _onSignIn — unused; kept for call-site compatibility
 */
export function toastCustomerError(message, _onSignIn) {
  if (message == null || message === '') return;
  toast.error(message);
}

/**
 * Show an error toast for an admin dashboard data-fetch failure.
 * @param {string} message
 * @param {() => void} _onAdminSignIn — unused; kept for call-site compatibility
 */
export function toastAdminSessionError(message, _onAdminSignIn) {
  if (message == null || message === '') return;
  toast.error(message);
}
