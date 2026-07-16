// demo_api_ui/src/context/SessionTokenContext.js
//
// Single source of truth for the TopNav session/token pill.
//
// The pill lives in the global TopNav, which renders on every route. Previously
// only the dashboard page components (Dashboard.js / UserDashboard.js) fetched
// the session status and published the countdown — so any admin subpage that
// did not mount one of those (e.g. /users, /activity, /reports) left the pill
// stuck at null and rendered the empty dark shimmer box. This provider owns the
// status fetch + live countdown itself, so the pill is populated on every route.
//
// The dashboards still own their token-detail modal; they register an opener
// here via registerTokenModalOpener so the pill's "View Token" button works on
// the routes where that modal exists.
import React, { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';
import { resolveSessionExpiry } from '../services/sessionResolver';

const SessionTokenContext = createContext(null);

export function SessionTokenProvider({ children }) {
  const [tokenExpiresAt, setTokenExpiresAt] = useState(null);
  const [tokenSecondsLeft, setTokenSecondsLeft] = useState(null);
  const [tokenLoading, setTokenLoading] = useState(true);
  const [sessionType, setSessionType] = useState(null);   // 'admin' | 'user' | null
  const [staleSession, setStaleSession] = useState(false); // user tokens gone, session alive
  // Page components register a fn that opens their token-detail modal; null on
  // routes that have no such modal (the pill then omits the "View Token" button).
  const [openTokenModal, setOpenTokenModal] = useState(null);

  // Resolve session expiry via the shared resolver (same endpoints/precedence as
  // resolveSessionUser; cached 3s + self-invalidating on auth events).
  const refreshTokenStatus = useCallback(async () => {
    try {
      const result = await resolveSessionExpiry();
      setTokenExpiresAt(result?.expiresAt ?? null);
      setSessionType(result?.sessionType ?? null);
      setStaleSession(result?.staleSession ?? false);
    } catch {
      setTokenExpiresAt(null);
      setSessionType(null);
      setStaleSession(false);
    } finally {
      setTokenLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshTokenStatus();
    const onLogout = () => {
      setTokenExpiresAt(null);
      setSessionType(null);
      setStaleSession(false);
    };
    window.addEventListener('userAuthenticated', refreshTokenStatus);
    window.addEventListener('userLoggedOut', onLogout);
    return () => {
      window.removeEventListener('userAuthenticated', refreshTokenStatus);
      window.removeEventListener('userLoggedOut', onLogout);
    };
  }, [refreshTokenStatus]);

  // Live token expiry countdown — ticks every second.
  useEffect(() => {
    if (!tokenExpiresAt) {
      setTokenSecondsLeft(null);
      return;
    }
    const tick = () =>
      setTokenSecondsLeft(Math.max(0, Math.round((tokenExpiresAt - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [tokenExpiresAt]);

  // Periodic re-fetch of token status to pick up server-side silent refreshes.
  // Without this, the pill shows "expired" even when the BFF has already refreshed.
  useEffect(() => {
    const id = setInterval(refreshTokenStatus, 60000); // every 60s
    return () => clearInterval(id);
  }, [refreshTokenStatus]);

  // Register/unregister the page-owned token modal opener. Returns a cleanup
  // that only clears the opener if it is still the one this caller registered.
  const registerTokenModalOpener = useCallback((fn) => {
    setOpenTokenModal(() => fn); // wrap in arrow so useState doesn't call it
    return () => setOpenTokenModal((cur) => (cur === fn ? null : cur));
  }, []);

  // Single derived "is there a usable access token" flag. Consumers (TopNav
  // pill, UserMenu, BankingChips sign-in CTA) must use this rather than
  // re-deriving from the raw fields so they can never disagree.
  const hasActiveToken =
    !tokenLoading && tokenSecondsLeft !== null && tokenSecondsLeft > 0;

  const value = useMemo(() => ({
    tokenSecondsLeft,
    tokenLoading,
    sessionType,
    staleSession,
    hasActiveToken,
    openTokenModal,
    registerTokenModalOpener,
    refreshTokenStatus,
  }), [tokenSecondsLeft, tokenLoading, sessionType, staleSession, hasActiveToken, openTokenModal, registerTokenModalOpener, refreshTokenStatus]);

  return (
    <SessionTokenContext.Provider value={value}>
      {children}
    </SessionTokenContext.Provider>
  );
}

export function useSessionToken() {
  const ctx = useContext(SessionTokenContext);
  if (!ctx) throw new Error('useSessionToken must be used within SessionTokenProvider');
  return ctx;
}
