// banking_api_ui/src/services/sessionResolver.js
import { getCachedJson } from './cachedStatusService';

/**
 * Resolve current authenticated user from all supported session endpoints.
 * Queries admin OAuth, user OAuth, and generic session; returns the first
 * confirmed identity so a stalled unrelated probe cannot mask an active user.
 *
 * Cached with 10s TTL + in-flight dedup via cachedStatusService.
 * Cache cleared on login/logout events. BFF cookie auth means cached status is safe.
 */
export async function resolveSessionUser() {
  const SESSION_RESOLVE_TIMEOUT = 10000; // 10s timeout to prevent indefinite UI hang
  let timeoutId;
  try {
    return await new Promise((resolve) => {
      let pending = 3;
      timeoutId = setTimeout(() => resolve(null), SESSION_RESOLVE_TIMEOUT);
      // Return a confirmed identity as soon as it arrives. An unrelated status
      // endpoint can hang even while the customer's session is valid.
      for (const url of ['/api/auth/oauth/status', '/api/auth/oauth/user/status', '/api/auth/session']) {
        Promise.resolve().then(() => getCachedJson(url))
          .then(({ data }) => {
            if (data?.authenticated && data.user) resolve(data.user);
          })
          .catch(() => {})
          .finally(() => {
            pending -= 1;
            if (pending === 0) resolve(null);
          });
      }
    });
  } catch (err) {
    console.warn('[sessionResolver] resolveSessionUser failed or timed out:', err.message);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Resolve the current session's token-expiry info from the same OAuth status
 * endpoints and admin -> user precedence as resolveSessionUser.
 *
 * Returns { expiresAt, sessionType, staleSession, hasRefreshToken, oauthProvider } where:
 *   expiresAt    — ms epoch timestamp, or null if no authenticated session
 *   sessionType  — 'admin' | 'user' | null
 *   staleSession — true when the backend reports staleSession:true (tokens gone
 *                  but session record still alive — user needs to sign in again)
 *   hasRefreshToken — true when the session holds a refresh token (token pill
 *                     shows the red "R" marker)
 *   oauthProvider   — 'pingone' | 'pingfederate' | null (active login provider)
 *
 * Shares the 10s cache via cachedStatusService.
 */
export async function resolveSessionExpiry() {
  let timeoutId;
  try {
    return await new Promise((resolve) => {
      const results = {};
      let pending = 2;
      const finish = () => {
        // No active access token — retain the refresh-token signal for a
        // still-live login session after both probes settle or time out.
        const staleData = results.admin?.staleSession ? results.admin
          : results.user?.staleSession ? results.user : null;
        resolve(staleData ? {
          expiresAt: staleData.expiresAt ?? null,
          sessionType: staleData.sessionType || (staleData === results.admin ? 'admin' : 'user'),
          staleSession: true,
          hasRefreshToken: Boolean(staleData.hasRefreshToken),
          oauthProvider: staleData.oauthProvider ?? null,
        } : { expiresAt: null, sessionType: null, staleSession: false, hasRefreshToken: false, oauthProvider: null });
      };
      timeoutId = setTimeout(finish, 10000);
      for (const [url, type] of [
        ['/api/auth/oauth/status', 'admin'],
        ['/api/auth/oauth/user/status', 'user'],
      ]) {
        Promise.resolve().then(() => getCachedJson(url))
          .then(({ data }) => {
            results[type] = data;
            if (data?.authenticated && data.expiresAt) {
              resolve({
                expiresAt: data.expiresAt,
                sessionType: data.sessionType || type,
                staleSession: false,
                hasRefreshToken: data.hasRefreshToken ?? false,
                oauthProvider: data.oauthProvider ?? null,
              });
            }
          })
          .catch(() => {})
          .finally(() => {
            pending -= 1;
            if (pending === 0) finish();
          });
      }
    });
  } finally {
    clearTimeout(timeoutId);
  }
}
