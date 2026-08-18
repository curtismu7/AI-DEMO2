import axios from 'axios';
import { resolveApiBaseUrl } from '../utils/resolveApiBaseUrl';
import { notifySessionExpiredIfNeeded } from '../utils/authUi';
import { appendTrafficEntry, redactHeaders, redactBody, tryParseJson, normalizeHeaders } from './apiTrafficStore';
import { spinner } from './spinnerService';

class ApiClient {
  constructor() {
    this.client = axios.create({
      baseURL: resolveApiBaseUrl(),
      timeout: 10000,
      withCredentials: true,
    });

    this.setupInterceptors();
  }

  setupInterceptors() {
    // ── Spinner — show overlay for every non-silent API request ───────────────
    this.client.interceptors.request.use(
      (config) => {
        if (!config._silent) {
          try { spinner.increment((config.method || 'GET').toUpperCase(), config.url || ''); } catch (_) {}
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    this.client.interceptors.response.use(
      (response) => {
        if (!response.config?._silent) {
          try { spinner.decrement(false, response.config?.url || ''); } catch (_) {}
        }
        return response;
      },
      (error) => {
        if (!error.config?._silent) {
          try { spinner.decrement(true, error.config?.url || ''); } catch (_) {} // isError → skip min display so toasts show
        }
        return Promise.reject(error);
      }
    );

    // ── Traffic capture — stamp request start time ────────────────────────────
    this.client.interceptors.request.use(
      (config) => { config._trafficStart = Date.now(); return config; },
      (error) => Promise.reject(error)
    );

    // Request interceptor to add OAuth token
    this.client.interceptors.request.use(
      async (config) => {
        const token = await this.getValidToken();
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    // ── MCP inspector — client timeout must outlive the BFF's upstream budgets ─
    // The BFF gives MCP transports 15s (WebSocket, HTTP) to 30s (stdio, hosted
    // PingOne MCP) before answering or falling back. The 10s default above would
    // abort these in the browser while the server call goes on to succeed.
    // Registered after the auth interceptor — tests index request interceptors
    // [0..2] by registration order.
    this.client.interceptors.request.use(
      (config) => {
        if ((config.url || '').startsWith('/api/mcp/inspector/')) config.timeout = 35000;
        return config;
      },
      (error) => Promise.reject(error)
    );

    // ── Traffic capture — record response (success + error) ───────────────────
    this.client.interceptors.response.use(
      (response) => {
        const cfg = response.config || {};
        const url = cfg.url || '';
        if (url.startsWith('/api/')) {
          let reqBody = cfg.data;
          if (typeof reqBody === 'string') reqBody = tryParseJson(reqBody) ?? reqBody;
          if (reqBody && typeof reqBody === 'object') reqBody = redactBody(reqBody);
          appendTrafficEntry({
            method: (cfg.method || 'GET').toUpperCase(),
            url,
            status: response.status,
            duration: cfg._trafficStart ? Date.now() - cfg._trafficStart : null,
            requestHeaders: redactHeaders(normalizeHeaders(cfg.headers || {})),
            requestBody: reqBody ?? null,
            responseHeaders: normalizeHeaders(response.headers),
            responseBody: response.data ?? null,
            source: 'axios',
            timestamp: new Date().toISOString(),
          });
        }
        return response;
      },
      async (error) => {
        const cfg = error.config || {};
        const url = cfg.url || '';
        if (url.startsWith('/api/')) {
          let errReqBody = cfg.data ? (tryParseJson(cfg.data) ?? cfg.data) : null;
          if (errReqBody && typeof errReqBody === 'object') errReqBody = redactBody(errReqBody);
          appendTrafficEntry({
            method: (cfg.method || 'GET').toUpperCase(),
            url,
            status: error.response?.status ?? 0,
            duration: cfg._trafficStart ? Date.now() - cfg._trafficStart : null,
            requestHeaders: redactHeaders(normalizeHeaders(cfg.headers || {})),
            requestBody: errReqBody,
            responseHeaders: normalizeHeaders(error.response?.headers),
            responseBody: error.response?.data ?? null,
            error: error.message,
            source: 'axios',
            timestamp: new Date().toISOString(),
          });
        }

        // ── Original error handling ──────────────────────────────────────────
        const originalRequest = error.config;

        // `_noAuthBanner` — for best-effort background calls whose 401 says
        // nothing about the user's session. Skipping flag arming for a public
        // use case removes the known offender, but any other admin-gated call
        // a guest happens to make would still put "please sign in" over an
        // answer that succeeded. The caller knows whether its own 401 is
        // informative; a URL denylist here would rot.
        if (error.response?.status === 401 && !cfg._noAuthBanner) {
          notifySessionExpiredIfNeeded({
            status: 401,
            body: error.response?.data,
            pathname: typeof window !== 'undefined' ? window.location.pathname : '',
          });
        }

        // BFF pattern: the server handles token refresh transparently via
        // refreshIfExpiring middleware. No client-side retry needed — the
        // session cookie is the auth mechanism. Previous dead-code retry
        // (refreshToken() always returned null) has been removed.

        // Check for insufficient scope errors (403)
        if (error.response?.status === 403) {
          console.error('Insufficient scope for request:', error.response.data);
          if (error.response.data?.error === 'insufficient_scope') {
            const scopeError = new Error('Insufficient permissions for this operation');
            scopeError.response = error.response;
            scopeError.requiredScopes = error.response.data?.required_scopes;
            scopeError.providedScopes = error.response.data?.provided_scopes;
            return Promise.reject(scopeError);
          }
        }

        return Promise.reject(error);
      }
    );

    // ── Dev-proxy transient bounce — retry once ───────────────────────────────
    // vite's dev proxy (vite.config.js) answers 502 {error:'proxy_error'} when
    // the BFF's `node --watch` process is mid hot-reload restart and hasn't
    // reopened its listener yet (ECONNREFUSED at the proxy, before the request
    // ever reaches the backend). Nothing server-side ran, so retrying once
    // after a short delay is safe for any method. Production (nginx) never
    // emits this exact shape, so this is a no-op outside dev.
    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        const cfg = error.config;
        const isDevProxyBounce =
          error.response?.status === 502 && error.response?.data?.error === 'proxy_error';
        if (isDevProxyBounce && cfg && !cfg._proxyRetried) {
          cfg._proxyRetried = true;
          await new Promise((resolve) => setTimeout(resolve, 700));
          return this.client(cfg);
        }
        return Promise.reject(error);
      }
    );
  }

  async getValidToken() {
    // Backend-for-Frontend (BFF) pattern: same-origin /api/* calls use the session cookie; the server reads the
    // access token from req.session. Do not send Authorization: Bearer from a JWT copy
    // exposed via /oauth/status — it can be expired while the session token is still valid,
    // causing 401 and a broken refresh flow that redirected to home.
    return null;
  }

  /** @deprecated BFF pattern — server never exposes accessToken to the client. */
  async getTokenFromSession() {
    // The /status endpoints intentionally omit accessToken (BFF pattern).
    // This method exists for backwards compatibility but always returns null.
    return null;
  }

  isTokenExpired(_token) {
    // OAuth access tokens are opaque here; rely on the Backend-for-Frontend (BFF)/session for validity.
    return false;
  }

  async refreshToken() {
    // BFF pattern: the server holds the access token and refreshes it transparently
    // via the refreshIfExpiring middleware before every authenticated request.
    // The client never has the token, so there is nothing to refresh here.
    return null;
  }

  handleAuthFailure() {
    console.warn('Authentication failed, redirecting to login');
    localStorage.setItem('userLoggedOut', 'true');
    delete axios.defaults.headers.common['Authorization'];
    window.dispatchEvent(new CustomEvent('userLoggedOut'));
    setTimeout(() => { window.location.href = '/'; }, 100);
  }

  // Convenience methods that use the configured client
  get(url, config) { return this.client.get(url, config); }
  post(url, data, config) { return this.client.post(url, data, config); }
  put(url, data, config) { return this.client.put(url, data, config); }
  delete(url, config) { return this.client.delete(url, config); }
  patch(url, data, config) { return this.client.patch(url, data, config); }
}

// Create and export a singleton instance
const apiClient = new ApiClient();
export default apiClient;
