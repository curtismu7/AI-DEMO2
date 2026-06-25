// banking_api_ui/src/components/OAuthTokenDisplayPage.jsx
import React, { useState, useEffect, useCallback } from 'react';
import bffAxios from '../services/bffAxios';
import { fetchEnrichedUserInfo } from '../services/userInfoService';
import './OAuthTokenDisplayPage.css';
import TokenCard from './TokenCard';
import JsonHighlight from './shared/JsonHighlight';

function hasAnyField(data) {
  if (!data) return false;
  return Object.values(data).some((v) => v !== undefined && v !== null);
}

/** Step states for the unauthenticated "start the flow" UI */
const MCP_FLOW_STEPS = {
  idle: null,
  calling: { label: 'Sending request to MCP server…', color: '#3b82f6' },
  got_401: { label: 'MCP server → 401 Unauthenticated', color: '#f59e0b' },
  redirecting: { label: 'Redirecting to PingOne login…', color: '#10b981' },
};

export default function OAuthTokenDisplayPage() {
  const [userStatus, setUserStatus] = useState(null);
  const [tokenClaims, setTokenClaims] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [enrichedInfo, setEnrichedInfo] = useState(null);
  const [enrichedLoading, setEnrichedLoading] = useState(false);
  const [expandedSections, setExpandedSections] = useState({ account: true, rawJson: false });

  const toggleSection = (section) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };
  const [mcpFlowStep, setMcpFlowStep] = useState('idle');

  useEffect(() => {
    let cancelled = false;

    async function fetchTokenData() {
      try {
        const statusRes = await bffAxios.get('/api/auth/oauth/user/status');
        if (!cancelled) setUserStatus(statusRes.data);

        if (!statusRes.data.authenticated) {
          if (!cancelled) {
            setError('no_session');
            setLoading(false);
          }
          return;
        }

        const previewRes = await bffAxios.get('/api/tokens/session-preview');
        const events = previewRes.data?.tokenEvents || [];
        // Server shape: { id, claims, jwtFullDecode: { header, claims } }
        // Render code expects: { header, payload: { sub, scope, aud, ... } }
        // Map the first user-token event to that shape.
        const userTokenEvent = events.find(
          (e) => e.id === 'user-token' || e.label?.toLowerCase().includes('user access')
        );
        if (!cancelled) {
          if (userTokenEvent) {
            // Prefer jwtFullDecode (richer) but fall back to the top-level claims field
            const src = userTokenEvent.jwtFullDecode || { header: null, claims: userTokenEvent.claims };
            setTokenClaims({ header: src.header || {}, payload: src.claims || {} });
          } else {
            setTokenClaims(null);
          }
          setLoading(false);
        }
      } catch (err) {
        console.error('OAuthTokenDisplayPage fetch error:', err.message);
        if (!cancelled) {
          setError('fetch_failed');
          setLoading(false);
        }
      }
    }

    fetchTokenData();
    return () => { cancelled = true; };
  }, []);

  // Fetch enriched user info from PingOne userinfo endpoint (optional)
  useEffect(() => {
    if (!userStatus?.authenticated) return;
    let cancelled = false;
    setEnrichedLoading(true);
    fetchEnrichedUserInfo()
      .then((result) => { if (!cancelled) setEnrichedInfo(result); })
      .finally(() => { if (!cancelled) setEnrichedLoading(false); });
    return () => { cancelled = true; };
  }, [userStatus?.authenticated]);

  /**
   * Demonstrate the MCP → 401 → OAuth login flow.
   * 1. POST /api/mcp/tool (get_my_accounts) — no session, expect 401
   * 2. Show the 401 step visually for 1.2 s
   * 3. Redirect to the BFF user login endpoint
   */
  const startMcpFlow = useCallback(async () => {
    setMcpFlowStep('calling');
    try {
      await fetch('/api/mcp/tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ tool: 'get_my_accounts', params: {} }),
      });
      // Any response (401 expected) — show the 401 step then redirect
    } catch {
      // Network error still means we should try to log in
    }
    setMcpFlowStep('got_401');
    setTimeout(() => {
      setMcpFlowStep('redirecting');
      setTimeout(() => {
        window.location.href = '/api/auth/oauth/user/login';
      }, 800);
    }, 1200);
  }, []);

  if (loading) {
    return (
      <div className="otdp-container">
        <div className="otdp-loading">Loading token information…</div>
      </div>
    );
  }

  if (error === 'no_session') {
    const step = MCP_FLOW_STEPS[mcpFlowStep];
    const isBusy = mcpFlowStep !== 'idle';
    return (
      <div className="otdp-container">
        <div className="otdp-header">
          <h2>OAuth Token Information</h2>
        </div>
        <div className="otdp-card otdp-flow-start-card">
          <div className="otdp-flow-icon">🔒</div>
          <h3>No Active Session</h3>
          <p className="otdp-flow-desc">
            Click <strong>Log In</strong> to see the live token flow — the browser POSTs to the MCP
            server, receives a&nbsp;<code>401&nbsp;Unauthenticated</code>, then follows the OAuth
            redirect to PingOne. Once you log in, this page shows your decoded token claims.
          </p>

          {/* Step flow diagram */}
          <div className="otdp-flow-steps">
            <div className={`otdp-flow-step ${mcpFlowStep === 'calling' ? 'otdp-flow-step--active' : ''} ${['got_401','redirecting'].includes(mcpFlowStep) ? 'otdp-flow-step--done' : ''}`}>
              <span className="otdp-flow-step-num">1</span>
              <div>
                <div className="otdp-flow-step-title">POST /api/mcp/tool</div>
                <div className="otdp-flow-step-sub">get_my_accounts — no token yet</div>
              </div>
            </div>
            <div className="otdp-flow-arrow">→</div>
            <div className={`otdp-flow-step ${mcpFlowStep === 'got_401' ? 'otdp-flow-step--active otdp-flow-step--warn' : ''} ${mcpFlowStep === 'redirecting' ? 'otdp-flow-step--done' : ''}`}>
              <span className="otdp-flow-step-num">2</span>
              <div>
                <div className="otdp-flow-step-title">401 Unauthenticated</div>
                <div className="otdp-flow-step-sub">MCP server rejects the request</div>
              </div>
            </div>
            <div className="otdp-flow-arrow">→</div>
            <div className={`otdp-flow-step ${mcpFlowStep === 'redirecting' ? 'otdp-flow-step--active otdp-flow-step--ok' : ''}`}>
              <span className="otdp-flow-step-num">3</span>
              <div>
                <div className="otdp-flow-step-title">PingOne OAuth Login</div>
                <div className="otdp-flow-step-sub">Auth Code + PKCE → tokens issued</div>
              </div>
            </div>
          </div>

          {step && (
            <div className="otdp-flow-status" style={{ color: step.color }}>
              {step.label}
            </div>
          )}

          <button
            className="otdp-flow-login-btn"
            onClick={startMcpFlow}
            disabled={isBusy}
          >
            {isBusy ? 'Starting…' : 'Log In via MCP Flow'}
          </button>
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
          <p>Could not retrieve token information from the server. Please try again.</p>
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
          {userStatus?.oauthProvider && (
            <span className="otdp-badge otdp-badge--provider">{userStatus.oauthProvider}</span>
          )}
        </div>
      </div>

      <TokenCard
        decoded={tokenClaims}
        title="User Access Token"
        defaultExpanded
        showHeader
        showIdentity
        showScopes
        showRaw={false}
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

      {/* Raw payload toggle */}
      {Object.keys(payload).length > 0 && (
        <div className="otdp-card otdp-raw-section">
          <div className="otdp-card-header" onClick={() => toggleSection('rawJson')}>
            <div className="otdp-card-title">Raw JWT Claims (JSON)</div>
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
