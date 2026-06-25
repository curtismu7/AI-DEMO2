// banking_api_ui/src/utils/appToast.js
/**
 * Standard notifications for the banking UI (react-toastify).
 * Prefer `notifySuccess` / `notifyError` / `notifyWarning` / `notifyInfo` for all user-visible outcomes
 * instead of `alert()`, inline banners, or calling `toast.*` directly (except `toast` for dismiss/update/loading patterns).
 * Session + “Sign in”: `dashboardToast.js` dispatches `SESSION_REAUTH_EVENT` → `SessionReauthBanner` in App (on-page CTA).
 */
import { toast } from 'react-toastify';

const DEFAULT_SUCCESS = { autoClose: 4000 };
const DEFAULT_ERROR = { autoClose: 8000 };
const DEFAULT_WARN = { autoClose: 6000 };

/** Success feedback (saved, completed, copied, etc.). */
export function notifySuccess(message, options = {}) {
  if (message == null || String(message).trim() === '') return;
  toast.success(String(message), { ...DEFAULT_SUCCESS, ...options });
}

/** Errors and failures (API, validation, permission). */
export function notifyError(message, options = {}) {
  if (message == null || String(message).trim() === '') return;
  toast.error(String(message), { ...DEFAULT_ERROR, ...options });
}

/** Warnings (soft failures, attention needed, non-blocking issues). */
export function notifyWarning(message, options = {}) {
  if (message == null || String(message).trim() === '') return;
  toast.warning(String(message), { ...DEFAULT_WARN, ...options });
}

/** Neutral info (tips, deduped status). Pass through to toast.info. */
export function notifyInfo(message, options = {}) {
  if (message == null || String(message).trim() === '') return;
  toast.info(String(message), { autoClose: 5000, ...options });
}

export { toast };
