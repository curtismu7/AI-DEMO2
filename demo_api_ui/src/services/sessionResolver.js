// banking_api_ui/src/services/sessionResolver.js
import { getCachedJson } from './cachedStatusService';

/**
 * Resolve current authenticated user from all supported session endpoints.
 * Order matches App/session behavior: admin OAuth -> user OAuth -> generic session.
 *
 * Cached with 3s TTL + in-flight dedup via cachedStatusService.
 * Cache cleared on login/logout events. BFF cookie auth means cached status is safe.
 */
export async function resolveSessionUser() {
  const SESSION_RESOLVE_TIMEOUT = 10000; // 10s timeout to prevent indefinite UI hang
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('Session resolution timed out')), SESSION_RESOLVE_TIMEOUT);
  });

  try {
    const [admin, endUser, session] = await Promise.race([
      Promise.allSettled([
        getCachedJson('/api/auth/oauth/status'),
        getCachedJson('/api/auth/oauth/user/status'),
        getCachedJson('/api/auth/session'),
      ]),
      timeoutPromise.then(() => { throw new Error('timeout'); }),
    ]);

    const adminUser = admin.status === 'fulfilled' && admin.value?.data?.authenticated ? admin.value.data.user : null;
    if (adminUser) return adminUser;

    const endUserUser = endUser.status === 'fulfilled' && endUser.value?.data?.authenticated ? endUser.value.data.user : null;
    if (endUserUser) return endUserUser;

    const sessionUser = session.status === 'fulfilled' && session.value?.data?.authenticated ? session.value.data.user : null;
    return sessionUser || null;
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
 * Shares the 3s cache via cachedStatusService.
 */
export async function resolveSessionExpiry() {
  const [admin, endUser, generic] = await Promise.allSettled([
    getCachedJson('/api/auth/oauth/status'),
    getCachedJson('/api/auth/oauth/user/status'),
    getCachedJson('/api/auth/session'),
  ]);

  const pairs = [
    { settled: admin, type: 'admin' },
    { settled: endUser, type: 'user' },
  ];

  for (const { settled, type } of pairs) {
    const data = settled.status === 'fulfilled' ? settled.value?.data : null;
    if (data?.authenticated && data.expiresAt) {
      return {
        expiresAt: data.expiresAt,
        sessionType: type,
        staleSession: false,
        hasRefreshToken: data.hasRefreshToken ?? false,
        oauthProvider: data.oauthProvider ?? null,
      };
    }
  }

  // The generic session endpoint also covers local sessions and cookie-backed
  // auth paths that do not report through either OAuth status endpoint.
  const genericData = generic.status === 'fulfilled' ? generic.value?.data : null;
  if (genericData?.authenticated && genericData.expiresAt) {
    const sessionType = genericData.authType === 'admin' || genericData.user?.role === 'admin'
      ? 'admin'
      : 'user';
    return { expiresAt: genericData.expiresAt, sessionType, staleSession: false };
  }

  // No active access token — retain the refresh-token signal for a still-live
  // login session. A failed/transient refresh must not hide the red R while the
  // BFF still has a refresh token it can use on the next request.
  const adminData = admin.status === 'fulfilled' ? admin.value?.data : null;
  const endUserData = endUser.status === 'fulfilled' ? endUser.value?.data : null;
  const staleData = adminData?.staleSession ? adminData : endUserData?.staleSession ? endUserData : null;
  if (staleData) {
    return {
      expiresAt: staleData.expiresAt ?? null,
      sessionType: staleData.sessionType || (staleData === adminData ? 'admin' : 'user'),
      staleSession: true,
      hasRefreshToken: Boolean(staleData.hasRefreshToken),
      oauthProvider: staleData.oauthProvider ?? null,
    };
  }

  return { expiresAt: null, sessionType: null, staleSession: false, hasRefreshToken: false, oauthProvider: null };
}
