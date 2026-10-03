// banking_api_ui/src/components/OAuthTokenDisplayPage.jsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import bffAxios from '../services/bffAxios';
import { fetchEnrichedUserInfo } from '../services/userInfoService';
import { startEmbeddedSignInFromUrl, submitPassword } from '../lib/embeddedPiFlow';
import './OAuthTokenDisplayPage.css';
import TokenCard from './TokenCard';
import JsonHighlight from './shared/JsonHighlight';

import ConfirmModal from './ConfirmModal';

function hasAnyField(data) {
  if (!data) return false;
  return Object.values(data).some((v) => v !== undefined && v !== null);
}

function formatRemaining(ms) {
  if (ms <= 0) return 'expired';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `in ${h ? `${h}h ` : ''}${h || m ? `${m}m ` : ''}${s}s`;
}

// Claims worth comparing between the ID token and the userinfo response. Protocol
// claims (iss, aud, exp, nonce, at_hash...) only exist on one side by design.
const COMPARE_KEYS = ['sub', 'email', 'email_verified', 'given_name', 'family_name', 'name', 'preferred_username', 'phone_number', 'locale', 'updated_at'];

function compareClaims(idPayload, userinfo) {
  const show = (v) => (v === undefined ? null : typeof v === 'object' ? JSON.stringify(v) : String(v));
  return COMPARE_KEYS
    .filter((k) => idPayload?.[k] !== undefined || userinfo?.[k] !== undefined)
    .map((k) => {
      const a = show(idPayload?.[k]);
      const b = show(userinfo?.[k]);
      const status = a === null ? 'only in userinfo' : b === null ? 'only in ID token' : a === b ? 'match' : 'differs';
      return { key: k, idValue: a, userinfoValue: b, status };
    });
}

/** Step states for the unauthenticated in-page PingOne flow. */
const PI_FLOW_STEPS = {
  idle: null,
  starting: { label: 'Starting PingOne pi.flow…' },
  credentials: { label: 'Complete PingOne sign-in in this window.' },
  exchanging: { label: 'The BFF is exchanging the authorization code…' },
};

export default function OAuthTokenDisplayPage() {
  const [sessionStatus, setSessionStatus] = useState(null);
  const [tokenClaims, setTokenClaims] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [enrichedInfo, setEnrichedInfo] = useState(null);
  const [enrichedLoading, setEnrichedLoading] = useState(false);
  const [idToken, setIdToken] = useState(null);
  const [refreshInfo, setRefreshInfo] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const [tokenAction, setTokenAction] = useState({ busy: null, message: null, error: false });
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  // Every section starts open; the headers still collapse them.
  const [expandedSections, setExpandedSections] = useState({ account: true, rawJson: true, refresh: true });

  const toggleSection = (section) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };
  const [piFlowSession, setPiFlowSession] = useState(null);
  const [piFlowBusy, setPiFlowBusy] = useState(false);
  const [piFlowStep, setPiFlowStep] = useState('idle');
  const [piFlowError, setPiFlowError] = useState(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const mountedRef = useRef(true);

  // Check both session types before reading decoded claims. Exposed as a
  // callback so the error screen's Try Again button can rerun it in place.
  const fetchTokenData = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const [adminResult, userResult] = await Promise.allSettled([
        bffAxios.get('/api/auth/oauth/status'),
        bffAxios.get('/api/auth/oauth/user/status'),
      ]);
      const adminStatus = adminResult.status === 'fulfilled' ? adminResult.value.data : null;
      const userStatus = userResult.status === 'fulfilled' ? userResult.value.data : null;
      if (!adminStatus && !userStatus) {
        throw adminResult.reason || userResult.reason || new Error('Could not check the OAuth session.');
      }
      if (!adminStatus?.authenticated && !userStatus?.authenticated
        && (adminResult.status === 'rejected' || userResult.status === 'rejected')) {
        throw adminResult.status === 'rejected' ? adminResult.reason : userResult.reason;
      }
      if (!mountedRef.current) return false;

      const activeStatus = adminStatus?.authenticated
        ? { ...adminStatus, sessionType: adminStatus.sessionType || 'admin' }
        : userStatus?.authenticated
          ? { ...userStatus, sessionType: userStatus.sessionType || 'user' }
          : null;
      setSessionStatus(activeStatus || (adminStatus?.sessionType === 'admin' ? adminStatus : userStatus || adminStatus));

      if (!activeStatus) {
        setTokenClaims(null);
        setIdToken(null);
        setRefreshInfo(null);
        setEnrichedInfo(null);
        setError('no_session');
        setLoading(false);
        return false;
      }

      const claimsRes = await bffAxios.get('/api/auth/oauth/token-claims');
      if (!mountedRef.current) return false;
      let decoded = claimsRes.data?.authenticated ? claimsRes.data.decoded : null;
      if (!decoded) {
        const previewRes = await bffAxios.get('/api/tokens/session-preview');
        if (!mountedRef.current) return false;
        const events = previewRes.data?.tokenEvents || [];
        const accessTokenEvent = events.find(
          (event) => event.id === 'user-token'
            || event.id === 'admin-token'
            || event.label?.toLowerCase().includes('access token')
        );
        const source = accessTokenEvent?.jwtFullDecode || accessTokenEvent?.decoded
          || (accessTokenEvent?.claims ? { claims: accessTokenEvent.claims } : null);
        if (source) {
          decoded = {
            header: source.header || {},
            payload: source.claims || source.payload || {},
          };
        }
      }
      setTokenClaims(decoded);
      setIdToken(claimsRes.data?.idToken || null);
      setRefreshInfo(claimsRes.data?.authenticated
        ? {
            present: !!claimsRes.data.hasRefreshToken,
            format: claimsRes.data.refreshTokenFormat || null,
            expiresAt: claimsRes.data.expiresAt || null,
          }
        : null);
      setLoading(false);
      return true;
    } catch (err) {
      console.error('OAuthTokenDisplayPage fetch error:', err.message);
      if (!mountedRef.current) return false;
      setError('fetch_failed');
      setLoading(false);
      return false;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    fetchTokenData();
    return () => { mountedRef.current = false; };
  }, [fetchTokenData]);

  // The admin token is not a userinfo token; only enrich customer sessions.
  useEffect(() => {
    if (!sessionStatus?.authenticated || sessionStatus.sessionType === 'admin') {
      setEnrichedInfo(null);
      return undefined;
    }
    let cancelled = false;
    setEnrichedLoading(true);
    fetchEnrichedUserInfo()
      .then((result) => { if (!cancelled) setEnrichedInfo(result); })
      .finally(() => { if (!cancelled) setEnrichedLoading(false); });
    return () => { cancelled = true; };
  }, [sessionStatus?.authenticated, sessionStatus?.sessionType]);

  const finishPiFlow = useCallback(async ({ code, state }, callbackPath) => {
    if (!code || !state || !callbackPath) {
      throw new Error('PingOne did not return the authorization code needed to finish sign-in.');
    }
    setPiFlowStep('exchanging');
    const callbackUrl = new URL(callbackPath, window.location.origin);
    if (callbackUrl.origin !== window.location.origin) {
      throw new Error('The sign-in callback must stay on this application.');
    }
    callbackUrl.searchParams.set('code', code);
    callbackUrl.searchParams.set('state', state);
    const callbackResponse = await fetch(callbackUrl.toString(), {
      credentials: 'include',
      redirect: 'manual',
    });
    // A successful BFF callback redirects after saving the session. With
    // redirect: 'manual', same-origin fetch exposes that 3xx as !ok, so only
    // treat server errors as a failed exchange and confirm the session below.
    if (callbackResponse.status >= 400) {
      throw new Error('The BFF could not exchange the PingOne authorization code.');
    }
    const authenticated = await fetchTokenData();
    if (!authenticated) {
      throw new Error('PingOne completed sign-in, but the BFF session was not established.');
    }
    setPiFlowSession(null);
    setPiFlowStep('idle');
    setPiFlowError(null);
    setUsername('');
    setPassword('');
    window.dispatchEvent(new CustomEvent('userAuthenticated'));
  }, [fetchTokenData]);

  const startPiFlow = useCallback(async () => {
    setPiFlowBusy(true);
    setPiFlowError(null);
    setPiFlowStep('starting');
    try {
      const startRes = await bffAxios.get('/api/auth/oauth/user/login?mode=pi.flow');
      const flow = await startEmbeddedSignInFromUrl(startRes.data?.authorizeUrl, { allowImmediateCompletion: true });
      if (flow.code && flow.state) {
        await finishPiFlow(flow, startRes.data?.callbackPath);
      } else {
        setPiFlowSession({ flow, callbackPath: startRes.data?.callbackPath });
        setPiFlowStep('credentials');
      }
    } catch (err) {
      if (err.response?.status === 409) {
        const refreshed = await fetchTokenData();
        if (refreshed) return;
        setSessionStatus((current) => ({
          ...current,
          authenticated: false,
          sessionType: 'admin',
          adminSessionBlocked: true,
        }));
        setError('no_session');
        setPiFlowError(null);
        setPiFlowStep('idle');
        return;
      }
      setPiFlowError(err.response?.data?.message || err.message || 'Could not start PingOne pi.flow.');
      setPiFlowStep('idle');
    } finally {
      setPiFlowBusy(false);
    }
  }, [fetchTokenData, finishPiFlow]);

  const submitPiFlowCredentials = useCallback(async (event) => {
    event.preventDefault();
    if (!piFlowSession) return;
    const typedPassword = password;
    setPassword('');
    setPiFlowBusy(true);
    setPiFlowError(null);
    try {
      const authorization = await submitPassword(piFlowSession.flow, username, typedPassword);
      await finishPiFlow(authorization, piFlowSession.callbackPath);
    } catch (err) {
      setPiFlowError(err.message || 'PingOne sign-in failed.');
      setPiFlowStep('credentials');
    } finally {
      setPiFlowBusy(false);
    }
  }, [finishPiFlow, password, piFlowSession, username]);

  const cancelPiFlow = useCallback(() => {
    setPiFlowSession(null);
    setPiFlowStep('idle');
    setPiFlowError(null);
    setPassword('');
  }, []);

  // Live countdown for the access token's expiry.
  const expiresAt = refreshInfo?.expiresAt;
  useEffect(() => {
    if (!expiresAt) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  const isAdminSession = sessionStatus?.sessionType === 'admin' || sessionStatus?.user?.role === 'admin';

  const refreshNow = useCallback(async () => {
    setTokenAction({ busy: 'refresh', message: null, error: false });
    try {
      await bffAxios.post(isAdminSession ? '/api/auth/oauth/refresh' : '/api/auth/oauth/user/refresh');
      await fetchTokenData();
      setTokenAction({ busy: null, message: 'Refreshed: the BFF exchanged the refresh token for a new access token.', error: false });
    } catch (err) {
      setTokenAction({ busy: null, message: err.response?.data?.message || err.message || 'Refresh failed.', error: true });
    }
  }, [fetchTokenData, isAdminSession]);

  const revokeNow = useCallback(async () => {
    setRevokeOpen(false);
    setTokenAction({ busy: 'revoke', message: null, error: false });
    try {
      const { data } = await bffAxios.post('/api/auth/oauth/user/revoke');
      const message = data.revoked === true
        ? 'Revoked: PingOne now reports this access token as inactive. Use Refresh now to get a working one, or sign in again.'
        : data.revoked === false
          ? 'Revocation was sent, but PingOne still reports the access token as active.'
          : data.message;
      setTokenAction({ busy: null, message, error: data.revoked !== true });
    } catch (err) {
      setTokenAction({ busy: null, message: err.response?.data?.message || err.message || 'Revoke failed.', error: true });
    }
  }, []);

  const copyClaims = useCallback(async (event, value) => {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(JSON.stringify(value, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }, []);

  if (loading) {
    return (
      <div className="otdp-container">
        <div className="otdp-loading">Loading token information…</div>
      </div>
    );
  }

  if (error === 'no_session') {
    const step = PI_FLOW_STEPS[piFlowStep];
    const adminSessionBlocked = sessionStatus?.sessionType === 'admin' && !sessionStatus.authenticated;
    const staleAdminSession = adminSessionBlocked && sessionStatus.staleSession;
    return (
      <div className="otdp-container otdp-container--narrow">
        <div className="otdp-header">
          <h2>OAuth Token Information</h2>
        </div>
        <div className="otdp-card otdp-flow-start-card">
          <div className="otdp-flow-icon">🔐</div>
          <h3>{adminSessionBlocked ? (staleAdminSession ? 'Admin Session Needs Renewal' : 'Admin Session Detected') : 'No Active Session'}</h3>
          <p className="otdp-flow-desc">
            {staleAdminSession
              ? 'An Admin session was found, but its OAuth token is no longer active. Renew that Admin session, then reopen this panel.'
              : adminSessionBlocked
                ? 'An Admin session is present, but this panel could not confirm its active token. Check the session status before signing in.'
                : 'Sign-in stays in this window. PingOne returns the authorization code through pi.flow, then the BFF exchanges it and keeps the access token in the server session.'}
          </p>

          {/* Step flow diagram */}
          <div className="otdp-flow-steps">
            <div className={`otdp-flow-step ${piFlowStep === 'starting' ? 'otdp-flow-step--active' : ''} ${['credentials','exchanging'].includes(piFlowStep) ? 'otdp-flow-step--done' : ''}`}>
              <span className="otdp-flow-step-num">1</span>
              <div>
                <div className="otdp-flow-step-title">PingOne /as/authorize</div>
                <div className="otdp-flow-step-sub">response_mode=pi.flow</div>
              </div>
            </div>
            <div className="otdp-flow-arrow">→</div>
            <div className={`otdp-flow-step ${piFlowStep === 'credentials' ? 'otdp-flow-step--active otdp-flow-step--warn' : ''} ${piFlowStep === 'exchanging' ? 'otdp-flow-step--done' : ''}`}>
              <span className="otdp-flow-step-num">2</span>
              <div>
                <div className="otdp-flow-step-title">PingOne sign-in</div>
                <div className="otdp-flow-step-sub">Credentials go directly to PingOne</div>
              </div>
            </div>
            <div className="otdp-flow-arrow">→</div>
            <div className={`otdp-flow-step ${piFlowStep === 'exchanging' ? 'otdp-flow-step--active otdp-flow-step--ok' : ''}`}>
              <span className="otdp-flow-step-num">3</span>
              <div>
                <div className="otdp-flow-step-title">BFF code exchange</div>
                <div className="otdp-flow-step-sub">PKCE verifier and tokens stay server-side</div>
              </div>
            </div>
          </div>

          {step && (
            <div className="otdp-flow-status" role="status">
              {step.label}
            </div>
          )}

          {piFlowError && <p className="otdp-flow-error" role="alert">{piFlowError}</p>}
          {adminSessionBlocked ? (
            <button type="button" className="otdp-retry-btn" onClick={fetchTokenData}>Check Admin session again</button>
          ) : piFlowSession ? (
            <form onSubmit={submitPiFlowCredentials}>
              <p className="otdp-flow-desc">Enter your PingOne credentials. They are sent directly to PingOne from this browser.</p>
              <div className="otdp-field">
                <label htmlFor="otdp-pi-flow-username">Username</label>
                <input
                  id="otdp-pi-flow-username"
                  autoComplete="username"
                  required
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                />
              </div>
              <div className="otdp-field">
                <label htmlFor="otdp-pi-flow-password">Password</label>
                <input
                  id="otdp-pi-flow-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
              <div className="otdp-flow-actions">
                <button type="submit" className="otdp-flow-login-btn" disabled={piFlowBusy}>
                  {piFlowBusy ? 'Signing in…' : 'Continue with PingOne'}
                </button>
                <button type="button" className="otdp-flow-link-btn" onClick={cancelPiFlow} disabled={piFlowBusy}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <div className="otdp-flow-actions">
              {/* The redirect sign-in works everywhere; the in-page pi.flow one
                  below needs CORS on the PingOne end-user app (TECH_DEBT.md). */}
              <button
                type="button"
                className="otdp-flow-login-btn"
                onClick={() => {
                  window.location.assign(`/api/auth/oauth/user/login?return_to=${encodeURIComponent(window.location.pathname)}`);
                }}
                disabled={piFlowBusy}
              >
                Sign in with PingOne
              </button>
              <button
                type="button"
                className="otdp-flow-link-btn"
                onClick={startPiFlow}
                disabled={piFlowBusy}
              >
                {piFlowBusy ? 'Starting…' : 'Sign In with PingOne here'}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (error === 'fetch_failed') {
    return (
      <div className="otdp-container">
        <div className="otdp-header">
          <h2>OAuth Token Information</h2>
        </div>
        <div className="otdp-card otdp-card--error">
          <div className="otdp-error-icon">⚠️</div>
          <h3>Failed to Load Token Data</h3>
          <p>Could not retrieve token information from the server. This is usually transient.</p>
          <button type="button" className="otdp-retry-btn" onClick={fetchTokenData}>
            Try Again
          </button>
        </div>
      </div>
    );
  }

  const payload = tokenClaims?.payload || {};

  return (
    <div className="otdp-container">
      <div className="otdp-header">
        <h2>OAuth Token Information</h2>
        <div className="otdp-status">
          {sessionStatus?.sessionType && (
            <span className="otdp-badge otdp-badge--provider">
              {sessionStatus.sessionType === 'admin' || sessionStatus.user?.role === 'admin' ? 'Admin Session' : 'User Session'}
            </span>
          )}
          {sessionStatus?.oauthProvider && (
            <span className="otdp-badge otdp-badge--provider">{sessionStatus.oauthProvider}</span>
          )}
        </div>
      </div>

      <TokenCard
        decoded={tokenClaims}
        title={sessionStatus?.sessionType === 'admin' || sessionStatus?.user?.role === 'admin' ? 'Admin Access Token' : 'User Access Token'}
        defaultExpanded
        showHeader
        showIdentity
        showScopes
        showRaw={false}
      />

      {idToken && (
        <TokenCard
          decoded={idToken}
          title="ID Token"
          defaultExpanded
          showHeader
          showIdentity
          showRaw={false}
        />
      )}

      {refreshInfo && (
        <div className="otdp-card">
          <div className="otdp-card-header" onClick={() => toggleSection('refresh')}>
            <div className="otdp-card-title">Refresh Token</div>
            <span className="otdp-toggle-icon">{expandedSections.refresh ? '▼' : '▶'}</span>
          </div>
          {expandedSections.refresh && (
            <div className="otdp-card-content">
              <div className="otdp-claim-row">
                <span className="otdp-claim-key">Issued</span>
                <span className="otdp-claim-value">{refreshInfo.present ? 'Yes' : 'No (this session has no refresh token)'}</span>
              </div>
              {refreshInfo.present && (
                <>
                  <div className="otdp-claim-row">
                    <span className="otdp-claim-key">Format</span>
                    <span className="otdp-claim-value">
                      {refreshInfo.format === 'jwt' ? 'JWT' : 'Opaque (not a JWT, so there are no claims to decode)'}
                    </span>
                  </div>
                  <div className="otdp-claim-row">
                    <span className="otdp-claim-key">Value</span>
                    <span className="otdp-claim-value">Held by the BFF in the server session. It is never sent to the browser.</span>
                  </div>
                </>
              )}
              {refreshInfo.expiresAt != null && (
                <div className="otdp-claim-row">
                  <span className="otdp-claim-key">Access token expires</span>
                  <span className="otdp-claim-value">
                    {new Date(refreshInfo.expiresAt).toLocaleString()}{' '}
                    <span className={refreshInfo.expiresAt <= now ? 'otdp-expired-text' : 'otdp-active-text'} data-testid="expiry-countdown">
                      ({formatRemaining(refreshInfo.expiresAt - now)})
                    </span>
                  </span>
                </div>
              )}
              <div className="otdp-actions">
                {refreshInfo.present && (
                  <button
                    type="button"
                    className="otdp-action-btn"
                    onClick={refreshNow}
                    disabled={tokenAction.busy !== null}
                  >
                    {tokenAction.busy === 'refresh' ? 'Refreshing…' : 'Refresh now'}
                  </button>
                )}
                {!isAdminSession && (
                  <button
                    type="button"
                    className="otdp-action-btn otdp-action-btn--danger"
                    onClick={() => setRevokeOpen(true)}
                    disabled={tokenAction.busy !== null}
                  >
                    {tokenAction.busy === 'revoke' ? 'Revoking…' : 'Revoke access token'}
                  </button>
                )}
              </div>
              {tokenAction.message && (
                <p className={tokenAction.error ? 'otdp-flow-error' : 'otdp-action-note'} role="status">{tokenAction.message}</p>
              )}
            </div>
          )}
        </div>
      )}

      <ConfirmModal
        isOpen={revokeOpen}
        title="Revoke access token?"
        message="PingOne will invalidate this session's access token (RFC 7009). The agent and any API call using it will start failing until you refresh the token or sign in again."
        confirmLabel="Revoke"
        danger
        onConfirm={revokeNow}
        onCancel={() => setRevokeOpen(false)}
      />

      {/* PingOne Userinfo Enrichment — only render card if loading, error, or has data */}
      {(enrichedLoading || enrichedInfo?.error || hasAnyField(enrichedInfo?.data)) && (
        <div className="otdp-card">
          <div className="otdp-card-header" onClick={() => toggleSection('account')}>
            <div className="otdp-card-title">Account Information <span className="otdp-source-label">(from PingOne userinfo)</span></div>
            <span className="otdp-toggle-icon">{expandedSections.account ? '▼' : '▶'}</span>
          </div>
          {expandedSections.account && (
            <div className="otdp-card-content">
              {enrichedLoading && <div className="otdp-muted">Loading PingOne profile…</div>}
              {enrichedInfo?.error && (
                <div className="otdp-muted">⚠️ {enrichedInfo.error} — showing token data only</div>
              )}
              {enrichedInfo?.data && hasAnyField(enrichedInfo.data) && (
                <>
                  {enrichedInfo.data.email != null && (
                    <div className="otdp-claim-row">
                      <span className="otdp-claim-key">Email</span>
                      <span className="otdp-claim-value">{enrichedInfo.data.email}</span>
                    </div>
                  )}
                  {enrichedInfo.data.email_verified != null && (
                    <div className="otdp-claim-row">
                      <span className="otdp-claim-key">Email Verified</span>
                      <span className="otdp-claim-value">{String(enrichedInfo.data.email_verified)}</span>
                    </div>
                  )}
                  {enrichedInfo.data.given_name != null && (
                    <div className="otdp-claim-row">
                      <span className="otdp-claim-key">Given Name</span>
                      <span className="otdp-claim-value">{enrichedInfo.data.given_name}</span>
                    </div>
                  )}
                  {enrichedInfo.data.family_name != null && (
                    <div className="otdp-claim-row">
                      <span className="otdp-claim-key">Family Name</span>
                      <span className="otdp-claim-value">{enrichedInfo.data.family_name}</span>
                    </div>
                  )}
                  {(enrichedInfo.data.phone_number || enrichedInfo.data.phone) != null && (
                    <div className="otdp-claim-row">
                      <span className="otdp-claim-key">Phone</span>
                      <span className="otdp-claim-value">{enrichedInfo.data.phone_number || enrichedInfo.data.phone}</span>
                    </div>
                  )}
                  {enrichedInfo.data.locale != null && (
                    <div className="otdp-claim-row">
                      <span className="otdp-claim-key">Locale</span>
                      <span className="otdp-claim-value">{enrichedInfo.data.locale}</span>
                    </div>
                  )}
                  {enrichedInfo.data.address?.formatted != null && (
                    <div className="otdp-claim-row">
                      <span className="otdp-claim-key">Address</span>
                      <span className="otdp-claim-value">{enrichedInfo.data.address.formatted}</span>
                    </div>
                  )}
                  {enrichedInfo.data.updated_at != null && (
                    <div className="otdp-claim-row">
                      <span className="otdp-claim-key">Updated At</span>
                      <span className="otdp-claim-value">{new Date(enrichedInfo.data.updated_at * 1000).toLocaleString()}</span>
                    </div>
                  )}
                  {enrichedInfo.timestamp && (
                    <div className="otdp-claim-row">
                      <span className="otdp-claim-key otdp-muted">Fetched</span>
                      <span className="otdp-claim-value otdp-muted">{new Date(enrichedInfo.timestamp).toLocaleString()}</span>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {idToken && hasAnyField(enrichedInfo?.data) && (
        <div className="otdp-card">
          <div className="otdp-card-title">ID Token vs Userinfo</div>
          <p className="otdp-muted">The ID token is a signed snapshot from sign-in; userinfo is fetched live. A difference means the profile changed since sign-in.</p>
          <div className="otdp-compare" role="table" aria-label="ID token compared with userinfo">
            <div className="otdp-compare-row otdp-compare-row--head" role="row">
              <span role="columnheader">Claim</span>
              <span role="columnheader">ID token</span>
              <span role="columnheader">Userinfo</span>
              <span role="columnheader">Result</span>
            </div>
            {compareClaims(idToken.payload, enrichedInfo.data).map((row) => (
              <div className="otdp-compare-row" role="row" key={row.key}>
                <span className="otdp-claim-key" role="cell">{row.key}</span>
                <span className="otdp-claim-value" role="cell">{row.idValue ?? '-'}</span>
                <span className="otdp-claim-value" role="cell">{row.userinfoValue ?? '-'}</span>
                <span className={`otdp-compare-status otdp-compare-status--${row.status === 'match' ? 'ok' : row.status === 'differs' ? 'diff' : 'info'}`} role="cell">{row.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Raw payload toggle */}
      {Object.keys(payload).length > 0 && (
        <div className="otdp-card otdp-raw-section">
          <div className="otdp-card-header" onClick={() => toggleSection('rawJson')}>
            <div className="otdp-card-title">Raw JWT Claims (JSON)</div>
            <button type="button" className="otdp-action-btn otdp-action-btn--small" onClick={(event) => copyClaims(event, payload)}>
              {copied ? 'Copied' : 'Copy claims'}
            </button>
            <span className="otdp-toggle-icon">{expandedSections.rawJson ? '▼' : '▶'}</span>
          </div>
          {expandedSections.rawJson && (
            <div className="otdp-card-content">
              <pre className="otdp-raw-json"><JsonHighlight value={payload} /></pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
