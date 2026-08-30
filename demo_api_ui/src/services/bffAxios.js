// banking_api_ui/src/services/bffAxios.js
import axios from 'axios';
import { resolveApiBaseUrl } from '../utils/resolveApiBaseUrl';
import { notifySessionExpiredIfNeeded } from '../utils/authUi';

/**
 * Same-origin API calls that rely on the Backend-for-Frontend (BFF) session cookie only.
 * The Backend-for-Frontend (BFF) is banking_api_server: it holds OAuth tokens server-side; the browser only sends the session cookie.
 * Intentionally no Authorization / refresh interceptors — those can break
 * admin routes when the SPA does not send Bearer tokens (session fallback).
 * One response interceptor: surface session-expiry via SessionReauthBanner.
 */
const bffAxios = axios.create({
  baseURL: resolveApiBaseUrl(),
  withCredentials: true,
  timeout: 15000, // 15s — aligned closer to apiClient (10s) for consistent UX
});

bffAxios.interceptors.response.use(
  (response) => response,
  (error) => {
    // `_noAuthBanner` — the same opt-out apiClient already honours, for callers that
    // render their own inline SignInPrompt on a 401. Without it those pages
    // showed BOTH: the page's own "Sign in required" card and the global
    // SignInModal interrupt stacked over it, which is the state /pingone-authorize
    // was in. SignInModal and SignInPrompt are documented siblings — the modal
    // is for content that cannot render, the prompt for content that still
    // does — so a page must pick one.
    //
    // A per-request flag rather than a path or URL list: apiClient's own note
    // has it right, "the caller knows whether its own 401 is informative; a URL
    // denylist here would rot". It is also the only race-free place to decide.
    // The prompt is rendered FROM the 401 (setNeedsLogin(true) in the catch),
    // so anything keyed on the prompt being mounted is asked too early — the
    // modal has already fired by the time the card exists.
    if (error.response?.status === 401 && !error.config?._noAuthBanner) {
      notifySessionExpiredIfNeeded({
        status: 401,
        body: error.response?.data,
        pathname: typeof window !== 'undefined' ? window.location.pathname : '',
      });
    }
    return Promise.reject(error);
  },
);

export default bffAxios;
