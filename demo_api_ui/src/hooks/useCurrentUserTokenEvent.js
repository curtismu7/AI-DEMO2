import { useEffect, useRef } from 'react';
import { useTokenChainOptional } from '../context/TokenChainContext';

/**
 * Hook to seed the token chain panel with the login token set on dashboard
 * load — the user access token plus the ID token and refresh token issued at
 * login (each as its own card). Fetches from /api/tokens/session-preview which
 * decodes the actual PingOne JWTs from the BFF session — gives real sub (UUID),
 * aud, scope, and jwtFullDecode for the inspector. Replaces the old approach of building a
 * synthetic event from /api/auth/oauth/user/status which only had the local DB
 * user.id (sequential integer) as sub and no jwtFullDecode.
 *
 * The endpoint answers 200 with an empty tokenEvents array when the session has
 * no usable access token *yet* — e.g. immediately after the OAuth callback
 * redirect, before the session write is readable, or during a stale/cookie-only
 * restored session. A single mount-time fetch could therefore land on an empty
 * result and leave the panel blank forever (the user looks logged in but the
 * token display never populates). We retry a bounded number of times until real
 * events arrive, then stop permanently.
 */
const MAX_ATTEMPTS = 5;
const RETRY_DELAY_MS = 1500;

export function useCurrentUserTokenEvent() {
  const tokenChain = useTokenChainOptional();
  // setSessionToken is a stable useCallback([]) on the context, so depending on
  // it (rather than the whole context object) lets the effect run once the
  // provider is available without the infinite-loop risk that drove the old
  // ref-based workaround: the context value changes on every setSessionToken
  // call, but this reference does not.
  const setSessionToken = tokenChain?.setSessionToken;
  const seededRef = useRef(false);

  useEffect(() => {
    if (!setSessionToken || seededRef.current) return;

    let isMounted = true;
    let timer = null;

    const attempt = async (n) => {
      if (!isMounted || seededRef.current) return;
      try {
        const res = await fetch('/api/tokens/session-preview', { credentials: 'include', _silent: true });
        if (!isMounted) return;
        if (res.ok) {
          const data = await res.json();
          if (!isMounted) return;
          const allEvents = Array.isArray(data.tokenEvents) ? data.tokenEvents : [];
          // The credentials issued at login: the user access token plus the ID
          // token and refresh token (when openid / offline_access were granted).
          // Each is seeded as its own card so the collapsed panel shows the full
          // login token set, not just the access token.
          const loginEvents = allEvents.filter(
            (e) => e && (e.id === 'user-token' || e.id === 'id-token' || e.id === 'refresh-token'),
          );
          if (loginEvents.length > 0) {
            seededRef.current = true;
            setSessionToken(loginEvents);
            return;
          }
        }
      } catch (err) {
        console.debug('[useCurrentUserTokenEvent] Could not fetch session token:', err?.message);
      }
      // Empty result or transient failure — the session access token may not be
      // readable yet (post-login race / stale session). Retry a bounded number
      // of times before giving up so the panel is not left permanently blank.
      if (isMounted && !seededRef.current && n < MAX_ATTEMPTS) {
        timer = setTimeout(() => attempt(n + 1), RETRY_DELAY_MS);
      }
    };

    attempt(1);

    return () => {
      isMounted = false;
      if (timer) clearTimeout(timer);
    };
  }, [setSessionToken]);
}
