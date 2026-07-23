// banking_api_ui/src/components/ResourceServerPage.jsx
import React, { useState, useEffect } from 'react';
import bffAxios from '../services/bffAxios';
import ResourceServerTester, { INFLOW_PROBE_TARGETS, INFLOW_SOURCES } from './ResourceServerTester';
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

/** Format a countdown string from a JWT exp claim (seconds or ISO). */
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

/** Access-token claims panel shared by login and in-flow views. */
function AccessTokenPanel({ accessTokenClaims, tokenMetadata, resourceServerInfo, timeRemaining }) {
  const audValue = tokenMetadata?.audience;
  const audMatchesResource = resourceServerInfo?.targetAudience &&
    (Array.isArray(audValue)
      ? audValue.includes(resourceServerInfo.targetAudience)
      : audValue === resourceServerInfo.targetAudience);

  return (
    <div className="rsp-token-panel">
      <div className="rsp-panel-header">
        <h3>Access Token Claims</h3>
        {timeRemaining && (
          <span className={`rsp-expiry ${timeRemaining === 'Expired' ? 'expired' : ''}`}>
            {timeRemaining}
          </span>
        )}
      </div>

      <ClaimRow label="Subject (sub)" value={accessTokenClaims?.sub} glossary={CLAIM_GLOSSARY.sub} />
      <ClaimRow label="Issuer (iss)" value={accessTokenClaims?.iss} glossary={CLAIM_GLOSSARY.iss} />

      {accessTokenClaims?.aud && (
        <div className={`rsp-claim-row ${audMatchesResource ? 'rsp-aud-highlight' : ''}`}>
          <span className="rsp-claim-key" title={CLAIM_GLOSSARY.aud} style={{ cursor: 'help', borderBottom: '1px dotted #94a3b8' }}>
            Audience (aud) {audMatchesResource && <span className="rsp-aud-tag">This Resource Server</span>}
          </span>
          <span className="rsp-claim-value">
            {Array.isArray(accessTokenClaims.aud) ? accessTokenClaims.aud.join(', ') : accessTokenClaims.aud}
          </span>
        </div>
      )}

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

      {accessTokenClaims?.act && (
        <div className="rsp-act-box">
          <div className="rsp-act-header">Agent Acting On Behalf</div>
          <ClaimRow label="Actor (act)" value={accessTokenClaims.act} glossary={CLAIM_GLOSSARY.act} />
        </div>
      )}

      {accessTokenClaims?.may_act && (
        <div className="rsp-may-act-box">
          <div className="rsp-act-header">May Act (Delegation Pre-authorization)</div>
          <ClaimRow label="may_act" value={accessTokenClaims.may_act} glossary={CLAIM_GLOSSARY.may_act} />
        </div>
      )}
    </div>
  );
}

export default function ResourceServerPage() {
  const [view, setView] = useState('login');
  const [loginData, setLoginData] = useState(null);
  const [inflowData, setInflowData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [timeRemaining, setTimeRemaining] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      bffAxios.get('/api/resource-server/summary'),
      bffAxios.get('/api/resource-server/summary-inflow'),
    ])
      .then(([loginRes, inflowRes]) => {
        if (cancelled) return;
        setLoginData(loginRes.data);
        setInflowData(inflowRes.data);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err.response?.status === 401) {
          setError('auth');
        } else {
          setError(err.response?.data?.message || 'Failed to load resource server data.');
        }
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const activeClaims = view === 'inflow'
    ? inflowData?.accessTokenClaims
    : loginData?.accessTokenClaims;

  useEffect(() => {
    if (!activeClaims?.exp) {
      setTimeRemaining(null);
      return undefined;
    }
    const update = () => setTimeRemaining(calculateTimeRemaining(activeClaims.exp));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [activeClaims?.exp, view]);

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
          <span className="rsp-lock-icon" aria-hidden="true">🔐</span>
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

  const isInflow = view === 'inflow';
  const data = isInflow ? inflowData : loginData;
  const {
    accounts,
    transactions,
    accessTokenClaims,
    idTokenClaims,
    tokenMetadata,
    resourceServerInfo,
    hasMcpToken,
  } = data || {};
  const totalBalance = (accounts || []).reduce((sum, a) => sum + (a.balance || 0), 0);

  return (
    <div className="rsp-container">
      <div className="rsp-header">
        <div className="rsp-header-content">
          <span className="rsp-path-badge">{isInflow ? 'IN-FLOW GATEWAY PATH' : 'LOGIN OAUTH PATH'}</span>
          <h1>OIDC Resource Server</h1>
          <p className="rsp-subtitle">
            {isInflow
              ? 'Gateway TX hop — same /api/resource-server Path B the agent dual_token flow calls'
              : 'Login hop — enduser audience on the session access token (not the MCP exchange target)'}
          </p>
        </div>
      </div>

      <div className="rsp-view-tabs" role="tablist" aria-label="Resource server view">
        <button
          type="button"
          role="tab"
          aria-selected={!isInflow}
          className={`rsp-view-tab${!isInflow ? ' rsp-view-tab--active' : ''}`}
          onClick={() => setView('login')}
        >
          Login RS
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={isInflow}
          className={`rsp-view-tab${isInflow ? ' rsp-view-tab--active' : ''}`}
          onClick={() => setView('inflow')}
        >
          In-flow RS
        </button>
      </div>

      <div className="rsp-explainer">
        <div>
          {isInflow ? (
            <>
              <strong>In-flow resource server.</strong> After RFC 8693 exchange the agent
              bearer targets the MCP gateway audience (
              <code>{resourceServerInfo?.targetAudience || 'mcpgateway.ping.demo'}</code>
              ). Path B posts that token to <code>/api/resource-server/identity</code>.
              {!hasMcpToken && (
                <> No cached TX token yet — run an agent tool or Execute in the tester to mint one.</>
              )}
            </>
          ) : (
            <>
              <strong>Login resource server.</strong> Decodes your session access token
              (audience <code>{resourceServerInfo?.targetAudience || 'enduser.ping.demo'}</code>
              ) — the first hop after sign-in. Switch to <strong>In-flow RS</strong> for the
              gateway TX hop used in the live agent path.
            </>
          )}
        </div>
      </div>

      <div className="rsp-grid">
        <div className="rsp-banking-col">
          {isInflow ? (
            <div className="rsp-hero rsp-hero--inflow">
              <div className="rsp-hero-label">In-flow hop</div>
              <div className="rsp-hero-balance" style={{ fontSize: 22 }}>
                {hasMcpToken ? 'TX token cached' : 'No TX token yet'}
              </div>
              <div className="rsp-hero-count">
                Probe target: {resourceServerInfo?.probeHint || '/api/resource-server/identity'}
              </div>
            </div>
          ) : (
            <>
              <div className="rsp-hero">
                <div className="rsp-hero-label">Total Balance</div>
                <div className="rsp-hero-balance">{formatCurrency(totalBalance || 0, 'USD')}</div>
                <div className="rsp-hero-count">{accounts?.length || 0} account{accounts?.length !== 1 ? 's' : ''}</div>
              </div>

              <div className="rsp-accounts-grid">
                {(accounts || []).map((acct) => (
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
                  {transactions.map((txn) => (
                    <div key={txn.id} className="rsp-txn-row">
                      <span className="rsp-txn-desc">{txn.description}</span>
                      <span className={`rsp-txn-amount ${txn.amount >= 0 ? 'positive' : 'negative'}`}>
                        {txn.amount >= 0 ? '+' : ''}{formatCurrency(txn.amount || 0, 'USD')}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          <div className="rsp-info-box" style={{ marginTop: 16 }}>
            <h3>Resource Server Info</h3>
            <ClaimRow label="Name" value={resourceServerInfo?.name} />
            <ClaimRow label="Type" value={resourceServerInfo?.type} />
            <ClaimRow label="Auth Method" value={resourceServerInfo?.authMethod} />
            <ClaimRow label="Target Audience" value={resourceServerInfo?.targetAudience} />
            <ClaimRow label="Description" value={resourceServerInfo?.description} />
          </div>
        </div>

        <div className="rsp-tokens-col">
          {accessTokenClaims ? (
            <AccessTokenPanel
              accessTokenClaims={accessTokenClaims}
              tokenMetadata={tokenMetadata}
              resourceServerInfo={resourceServerInfo}
              timeRemaining={timeRemaining}
            />
          ) : (
            <div className="rsp-token-panel">
              <div className="rsp-panel-header">
                <h3>Access Token Claims</h3>
              </div>
              <p className="rsp-muted" style={{ padding: '8px 0' }}>
                {isInflow
                  ? 'No cached in-flow token. Use the tester below (In-flow MCP / gateway TX) — Execute mints via RFC 8693 when needed.'
                  : 'No access token claims available.'}
              </p>
            </div>
          )}

          {!isInflow && (
            <div className="rsp-token-row">
              <div className="rsp-token-panel rsp-id-token-panel">
                <h3>ID Token Claims</h3>
                <ClaimRow label="Subject (sub)" value={idTokenClaims?.sub} glossary={CLAIM_GLOSSARY.sub} />
                <ClaimRow label="Name" value={idTokenClaims?.name} glossary={CLAIM_GLOSSARY.name} />
                <ClaimRow label="Email" value={idTokenClaims?.email} glossary={CLAIM_GLOSSARY.email} />
                <ClaimRow label="Preferred Username" value={idTokenClaims?.preferred_username} glossary={CLAIM_GLOSSARY.preferred_username} />
                <ClaimRow label="Given Name" value={idTokenClaims?.given_name} glossary={CLAIM_GLOSSARY.given_name} />
                <ClaimRow label="Family Name" value={idTokenClaims?.family_name} glossary={CLAIM_GLOSSARY.family_name} />
                <ClaimRow label="Auth Time" value={idTokenClaims?.auth_time ? formatDateTime(idTokenClaims.auth_time) || '—' : null} glossary={CLAIM_GLOSSARY.auth_time} />
                <ClaimRow label="ACR" value={idTokenClaims?.acr} glossary={CLAIM_GLOSSARY.acr} />
              </div>
            </div>
          )}
        </div>
      </div>

      <ResourceServerTester
        key={view}
        profile={view}
        sources={isInflow ? INFLOW_SOURCES : undefined}
        probeTargets={isInflow ? INFLOW_PROBE_TARGETS : undefined}
        intro={
          isInflow
            ? 'Test the in-flow RS the gateway Path B uses. Default token is the cached MCP / gateway TX (minted on Execute if missing). Probe /identity to match dual_token.'
            : 'Submit a login-session token and see how this resource server would treat it. Pick one by reference, or paste any JWT to test a failure case.'
        }
      />

      <div className="rsp-footer">
        <p>
          This view expects audience:{' '}
          <code>{resourceServerInfo?.targetAudience || '(not configured)'}</code>
          {isInflow ? ' (gateway TX)' : ' (login)'}
        </p>
      </div>
    </div>
  );
}
