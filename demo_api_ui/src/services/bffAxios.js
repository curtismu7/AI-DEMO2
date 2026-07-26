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
    if (error.response?.status === 401) {
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
