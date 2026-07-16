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
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Session resolution timed out')), SESSION_RESOLVE_TIMEOUT)
  );

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
  }
}

/**
 * Resolve the current session's token-expiry info from the same OAuth status
 * endpoints and admin -> user precedence as resolveSessionUser.
 *
 * Returns { expiresAt, sessionType, staleSession } where:
 *   expiresAt    — ms epoch timestamp, or null if no authenticated session
 *   sessionType  — 'admin' | 'user' | null
 *   staleSession — true when the backend reports staleSession:true (tokens gone
 *                  but session record still alive — user needs to sign in again)
 *
 * Shares the 3s cache via cachedStatusService.
 */
export async function resolveSessionExpiry() {
  const [admin, endUser] = await Promise.allSettled([
    getCachedJson('/api/auth/oauth/status'),
    getCachedJson('/api/auth/oauth/user/status'),
  ]);

  const pairs = [
    { settled: admin, type: 'admin' },
    { settled: endUser, type: 'user' },
  ];

  for (const { settled, type } of pairs) {
    const data = settled.status === 'fulfilled' ? settled.value?.data : null;
    if (data?.authenticated && data.expiresAt) {
      return { expiresAt: data.expiresAt, sessionType: type, staleSession: false };
    }
  }

  // No authenticated session — check if the user session is stale
  const endUserData = endUser.status === 'fulfilled' ? endUser.value?.data : null;
  if (endUserData?.staleSession) {
    return { expiresAt: null, sessionType: 'user', staleSession: true };
  }

  return { expiresAt: null, sessionType: null, staleSession: false };
}
