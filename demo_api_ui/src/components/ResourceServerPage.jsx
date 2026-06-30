// banking_api_ui/src/components/ResourceServerPage.jsx
import React, { useState, useEffect } from 'react';
import bffAxios from '../services/bffAxios';
import ResourceServerTester from './ResourceServerTester';
import { formatCurrency, formatDateTime } from '../utils/formatters';
import './ResourceServerPage.css';

const CLAIM_GLOSSARY = {
  sub: 'Subject — unique identifier of the authenticated user',
  iss: 'Issuer — the PingOne authorization server that issued this token',
  aud: 'Audience — the resource server(s) this token is valid for (RFC 8693 target)',
  exp: 'Expiration — Unix epoch time after which the token MUST be rejected',
  iat: 'Issued At — Unix epoch time when the token was created',
  nbf: 'Not Before — token is not valid before this time',
  scope: 'Scopes — permissions granted to the bearer of this token',
  client_id: 'Client ID — the OAuth 2.0 application that requested this token',
  act: 'Actor claim (RFC 8693 §4.1) — identifies the party acting on behalf of the subject',
  may_act: 'May Act (RFC 8693 §4.4) — allows the named client to perform Token Exchange',
  acr: 'Authentication Context Class Reference — level of assurance (e.g. Multi_Factor)',
  auth_time: 'Authentication Time — Unix epoch time when the user last authenticated',
  azp: 'Authorized Party — client ID that the token was issued to',
  jti: 'JWT ID — unique identifier for this token',
  email: 'Email address of the authenticated user',
  name: 'Display name of the authenticated user',
  preferred_username: 'Preferred username of the authenticated user',
  given_name: 'First/given name of the user',
  family_name: 'Last/family name of the user',
};


function calculateTimeRemaining(expTs) {
  if (!expTs) return null;
  const expMs = typeof expTs === 'number' ? expTs * 1000 : new Date(expTs).getTime();
  const diffMs = expMs - Date.now();
  if (diffMs <= 0) return 'Expired';
  const minutes = Math.floor(diffMs / 60000);
  const seconds = Math.floor((diffMs % 60000) / 1000);
  if (minutes > 0) return `${minutes}m ${seconds}s remaining`;
  return `${seconds}s remaining`;
}

function ClaimRow({ label, value, glossary, highlight }) {
  if (value === undefined || value === null) return null;
  const displayValue = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
  return (
    <div className={`rsp-claim-row ${highlight ? 'rsp-claim-highlight' : ''}`}>
      <span
        className="rsp-claim-key"
        title={glossary || ''}
        style={{ cursor: glossary ? 'help' : 'default', borderBottom: glossary ? '1px dotted #94a3b8' : 'none' }}
      >
        {label}
      </span>
      <span className="rsp-claim-value">{displayValue}</span>
    </div>
  );
}

function ScopesBadges({ scopes, highlightBanking }) {
  if (!scopes || scopes.length === 0) return <span className="rsp-muted">No scopes</span>;
  return (
    <div className="rsp-scopes">
      {scopes.map((s) => (
        <span
          key={s}
          className={`rsp-scope-badge ${highlightBanking && s.startsWith('') ? 'rsp-scope-banking' : ''}`}
        >
          {s}
        </span>
      ))}
    </div>
  );
}

export default function ResourceServerPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [timeRemaining, setTimeRemaining] = useState(null);

  useEffect(() => {
    bffAxios.get('/api/resource-server/summary')
      .then(res => {
        setData(res.data);
        setLoading(false);
      })
      .catch(err => {
        if (err.response?.status === 401) {
          setError('auth');
        } else {
          setError(err.response?.data?.message || 'Failed to load resource server data.');
        }
        setLoading(false);
      });
  }, []);

  // Update expiry countdown
  useEffect(() => {
    if (!data?.accessTokenClaims?.exp) return;
    const update = () => setTimeRemaining(calculateTimeRemaining(data.accessTokenClaims.exp));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [data?.accessTokenClaims?.exp]);

  if (loading) {
    return (
      <div className="rsp-container">
        <div className="rsp-loading">
          <div className="rsp-spinner" />
          <p>Loading OIDC Resource Server…</p>
        </div>
      </div>
    );
  }

  if (error === 'auth') {
    return (
      <div className="rsp-container">
        <div className="rsp-auth-required">
          <span className="rsp-lock-icon">🔒</span>
          <h2>Authentication Required</h2>
          <p>Please sign in to access the OIDC Resource Server.</p>
          <a href="/api/auth/oauth/user/login" className="rsp-login-btn">Log In</a>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rsp-container">
        <div className="rsp-error">
          <p>⚠️ {error}</p>
        </div>
      </div>
    );
  }

  const { accounts, transactions, accessTokenClaims, idTokenClaims, tokenMetadata, resourceServerInfo } = data;
  const totalBalance = (accounts || []).reduce((sum, a) => sum + (a.balance || 0), 0);
  const audValue = tokenMetadata?.audience;
  const audMatchesResource = resourceServerInfo?.targetAudience &&
    (Array.isArray(audValue) ? audValue.includes(resourceServerInfo.targetAudience) : audValue === resourceServerInfo.targetAudience);

  return (
    <div className="rsp-container">
      {/* Header */}
      <div className="rsp-header">
        <div className="rsp-header-content">
          <span className="rsp-path-badge">OAUTH BEARER PATH</span>
          <h1>🔐 OIDC Resource Server</h1>
          <p className="rsp-subtitle">Banking API — MCP Exchange Target · User-delegated access</p>
        </div>
      </div>

      {/* Learning-page explainer */}
      <div className="rsp-explainer">
        <span className="rsp-explainer-icon">🎓</span>
        <div>
          <strong>What this page is.</strong> A learning view of the OAuth 2.0 / OIDC resource
          server — the service that sits behind a protected API and decides whether an
          incoming token may access it. Below, your own session tokens are decoded so you can
          see exactly what a resource server receives: the <em>access token</em> claims it
          authorizes against (audience, scopes, expiry, and the RFC&nbsp;8693 <code>act</code>/
          <code>may_act</code> delegation claims), the <em>ID token</em> identity claims, and
          which audience this server requires. Then the <strong>🧪 Test this Resource Server</strong>
          panel at the bottom lets you submit any token and watch the server accept or reject it.
          No raw tokens leave the server — only decoded claims are shown.
        </div>
      </div>

      {/* Two-column grid */}
      <div className="rsp-grid">
        {/* Left: Banking Summary */}
        <div className="rsp-banking-col">
          <div className="rsp-hero">
            <div className="rsp-hero-label">Total Balance</div>
            <div className="rsp-hero-balance">{formatCurrency(totalBalance || 0, 'USD')}</div>
            <div className="rsp-hero-count">{accounts?.length || 0} account{accounts?.length !== 1 ? 's' : ''}</div>
          </div>

          <div className="rsp-accounts-grid">
            {(accounts || []).map(acct => (
              <div key={acct.id} className="rsp-account-card">
                <div className="rsp-account-top">
                  <span className={`rsp-account-badge ${acct.accountType || ''}`}>
                    {(acct.accountType || 'account').replace(/_/g, ' ')}
                  </span>
                  <span className="rsp-account-number">{acct.accountNumber}</span>
                </div>
                <div className="rsp-account-balance">{formatCurrency(acct.balance || 0, acct.currency || 'USD')}</div>
                <div className="rsp-account-name">{acct.name || ''}</div>
              </div>
            ))}
          </div>

          {transactions && transactions.length > 0 && (
            <div className="rsp-transactions">
              <h3>Recent Transactions</h3>
              {transactions.map(txn => (
                <div key={txn.id} className="rsp-txn-row">
                  <span className="rsp-txn-desc">{txn.description}</span>
                  <span className={`rsp-txn-amount ${txn.amount >= 0 ? 'positive' : 'negative'}`}>
                    {txn.amount >= 0 ? '+' : ''}{formatCurrency(txn.amount || 0, 'USD')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: Decoded Tokens */}
        <div className="rsp-tokens-col">
          {/* Access Token Panel */}
          <div className="rsp-token-panel">
            <div className="rsp-panel-header">
              <h3>🎫 Access Token Claims</h3>
              {timeRemaining && (
                <span className={`rsp-expiry ${timeRemaining === 'Expired' ? 'expired' : ''}`}>
                  {timeRemaining}
                </span>
              )}
            </div>

            <ClaimRow label="Subject (sub)" value={accessTokenClaims?.sub} glossary={CLAIM_GLOSSARY.sub} />
            <ClaimRow label="Issuer (iss)" value={accessTokenClaims?.iss} glossary={CLAIM_GLOSSARY.iss} />

            {/* Audience — highlight if matches resource server */}
            {accessTokenClaims?.aud && (
              <div className={`rsp-claim-row ${audMatchesResource ? 'rsp-aud-highlight' : ''}`}>
                <span className="rsp-claim-key" title={CLAIM_GLOSSARY.aud} style={{ cursor: 'help', borderBottom: '1px dotted #94a3b8' }}>
                  Audience (aud) {audMatchesResource && <span className="rsp-aud-tag">📍 This Resource Server</span>}
                </span>
                <span className="rsp-claim-value">
                  {Array.isArray(accessTokenClaims.aud) ? accessTokenClaims.aud.join(', ') : accessTokenClaims.aud}
                </span>
              </div>
            )}

            {/* Scopes */}
            {tokenMetadata?.scopes && tokenMetadata.scopes.length > 0 && (
              <div className="rsp-claim-row">
                <span className="rsp-claim-key" title={CLAIM_GLOSSARY.scope} style={{ cursor: 'help', borderBottom: '1px dotted #94a3b8' }}>
                  Scopes
                </span>
                <ScopesBadges scopes={tokenMetadata.scopes} highlightBanking />
              </div>
            )}

            <ClaimRow label="Client ID" value={accessTokenClaims?.client_id} glossary={CLAIM_GLOSSARY.client_id} />
            <ClaimRow label="Authorized Party (azp)" value={accessTokenClaims?.azp} glossary={CLAIM_GLOSSARY.azp} />
            <ClaimRow label="JWT ID (jti)" value={accessTokenClaims?.jti} glossary={CLAIM_GLOSSARY.jti} />
            <ClaimRow label="Issued At" value={accessTokenClaims?.iat ? formatDateTime(accessTokenClaims.iat) || '—' : null} glossary={CLAIM_GLOSSARY.iat} />
            <ClaimRow label="Expires At" value={accessTokenClaims?.exp ? formatDateTime(accessTokenClaims.exp) || '—' : null} glossary={CLAIM_GLOSSARY.exp} />
            <ClaimRow label="ACR" value={accessTokenClaims?.acr} glossary={CLAIM_GLOSSARY.acr} />

            {/* Actor claim (RFC 8693 delegation proof) */}
            {accessTokenClaims?.act && (
              <div className="rsp-act-box">
                <div className="rsp-act-header">🤖 Agent Acting On Behalf</div>
                <ClaimRow label="Actor (act)" value={accessTokenClaims.act} glossary={CLAIM_GLOSSARY.act} />
              </div>
            )}

            {/* May Act claim */}
            {accessTokenClaims?.may_act && (
              <div className="rsp-may-act-box">
                <div className="rsp-act-header">🔄 May Act (Delegation Pre-authorization)</div>
                <ClaimRow label="may_act" value={accessTokenClaims.may_act} glossary={CLAIM_GLOSSARY.may_act} />
              </div>
            )}
          </div>

          {/* ID Token + Resource Server Info side by side — both are short, so pairing
              them in a row trims the vertical whitespace under the tall Access Token panel. */}
          <div className="rsp-token-row">
            {/* ID Token Panel */}
            <div className="rsp-token-panel rsp-id-token-panel">
              <h3>🪪 ID Token Claims</h3>
              <ClaimRow label="Subject (sub)" value={idTokenClaims?.sub} glossary={CLAIM_GLOSSARY.sub} />
              <ClaimRow label="Name" value={idTokenClaims?.name} glossary={CLAIM_GLOSSARY.name} />
              <ClaimRow label="Email" value={idTokenClaims?.email} glossary={CLAIM_GLOSSARY.email} />
              <ClaimRow label="Preferred Username" value={idTokenClaims?.preferred_username} glossary={CLAIM_GLOSSARY.preferred_username} />
              <ClaimRow label="Given Name" value={idTokenClaims?.given_name} glossary={CLAIM_GLOSSARY.given_name} />
              <ClaimRow label="Family Name" value={idTokenClaims?.family_name} glossary={CLAIM_GLOSSARY.family_name} />
              <ClaimRow label="Auth Time" value={idTokenClaims?.auth_time ? formatDateTime(idTokenClaims.auth_time) || '—' : null} glossary={CLAIM_GLOSSARY.auth_time} />
              <ClaimRow label="ACR" value={idTokenClaims?.acr} glossary={CLAIM_GLOSSARY.acr} />
            </div>

            {/* Resource Server Info Box */}
            <div className="rsp-info-box">
              <h3>ℹ️ Resource Server Info</h3>
              <ClaimRow label="Name" value={resourceServerInfo?.name} />
              <ClaimRow label="Type" value={resourceServerInfo?.type} />
              <ClaimRow label="Auth Method" value={resourceServerInfo?.authMethod} />
              <ClaimRow label="Target Audience" value={resourceServerInfo?.targetAudience} />
              <ClaimRow label="Description" value={resourceServerInfo?.description} />
            </div>
          </div>
        </div>
      </div>

      {/* Interactive tester */}
      <ResourceServerTester />

      {/* Footer */}
      <div className="rsp-footer">
        <p>
          This resource server requires a valid OIDC access token with audience:{' '}
          <code>{resourceServerInfo?.targetAudience || '(not configured)'}</code>
        </p>
      </div>
    </div>
  );
}
