// banking_api_ui/src/components/ClientCredentialsResourcePage.jsx
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { notifySessionExpiredIfNeeded } from '../utils/authUi';
import SignInPrompt from './SignInPrompt';
import ResourceServerTester from './ResourceServerTester';
import '../styles/appShellPages.css';
import './ClientCredentialsResourcePage.css';

const CC_TESTER_SOURCES = [
  { value: 'cc', label: 'CC token (machine client)' },
  { value: 'paste', label: 'Paste a JWT' },
];

const CLAIM_GLOSSARY = {
  client_id: 'Client ID — the OAuth 2.0 application that requested this token (no user identity)',
  iss: 'Issuer — the PingOne authorization server that issued this token',
  aud: 'Audience — the resource server(s) this token is valid for',
  exp: 'Expiration — Unix epoch time after which the token MUST be rejected',
  iat: 'Issued At — Unix epoch time when the token was created',
  scope: 'Scopes — permissions granted to this machine client',
  jti: 'JWT ID — unique identifier for this token',
  azp: 'Authorized Party — client that the token was issued to',
  sub: '(ABSENT in CC tokens) — would identify a user in OIDC; not present in Client Credentials',
  act: '(ABSENT in CC tokens) — RFC 8693 actor claim; not present without token exchange',
};

function formatTimestamp(ts) {
  if (!ts) return '—';
  try {
    return new Date(typeof ts === 'number' ? ts * 1000 : ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

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

function ClaimRow({ label, value, glossary }) {
  if (value === undefined || value === null) return null;
  const displayValue = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
  return (
    <div className="ccrsp-claim-row">
      <span
        className="ccrsp-claim-key"
        title={glossary || ''}
        style={{ cursor: glossary ? 'help' : 'default', borderBottom: glossary ? '1px dotted #b6c2cf' : 'none' }}
      >
        {label}
      </span>
      <span className="ccrsp-claim-value">{displayValue}</span>
    </div>
  );
}

function ScopesBadges({ scopes }) {
  if (!scopes || scopes.length === 0) return <span className="ccrsp-muted">No scopes</span>;
  return (
    <div className="ccrsp-scopes">
      {scopes.map((s) => (
        <span key={s} className="ccrsp-scope-badge">{s}</span>
      ))}
    </div>
  );
}

export default function ClientCredentialsResourcePage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState(null);

  useEffect(() => {
    axios.get('/api/resource-server-cc/summary')
      .then(res => {
        setData(res.data);
        setLoading(false);
      })
      .catch(err => {
        const status = err.response?.status;
        notifySessionExpiredIfNeeded({ status, body: err.response?.data });
        if (status === 401) {
          setNeedsSignIn(true);
          setError('Your sign-in session has expired. Sign in again to view this resource server.');
        } else {
          setError(err.response?.data?.message || 'Failed to load CC resource server data.');
        }
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!data?.ccTokenClaims?.exp) return;
    const update = () => setTimeRemaining(calculateTimeRemaining(data.ccTokenClaims.exp));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [data?.ccTokenClaims?.exp]);

  if (loading) {
    return (
      <div className="app-page-shell ccrsp-page">
        <div className="ccrsp-loading">
          <div className="ccrsp-spinner" />
          <p>Loading Client Credentials Resource Server…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="app-page-shell ccrsp-page">
        <div className="app-page-card ccrsp-error-card">
          {needsSignIn ? (
            <SignInPrompt message={error} />
          ) : (
            <p>⚠️ {error}</p>
          )}
        </div>
      </div>
    );
  }

  const { accounts, ccTokenClaims, tokenMetadata, resourceServerInfo, comparison, ccError } = data;

  return (
    <div className="app-page-shell ccrsp-page">

      {/* Header */}
      <header className="app-page-shell__hero ccrsp-hero">
        <div className="app-page-shell__hero-top">
          <div>
            <div className="ccrsp-path-badge">CLIENT CREDENTIALS</div>
            <h1 className="app-page-shell__title">Client Credentials Resource Server</h1>
            <p className="app-page-shell__lead">
              Service-to-Service · <code>client_id</code> / <code>client_secret</code> — No user context
            </p>
          </div>
          <div className="app-page-shell__actions">
            <Link to="/resource-server" className="app-page-shell__btn app-page-shell__btn--solid">
              OIDC version →
            </Link>
          </div>
        </div>
      </header>

      <div className="app-page-shell__body">

        {/* CC Config Error Banner */}
        {ccError && (
          <div className="app-page-card ccrsp-config-error">
            <strong>⚠️ CC Token Not Available</strong>
            <p>{ccError.message}</p>
            <p className="ccrsp-config-hint">
              Configure: <code>{ccError.configNeeded?.join(' / ')}</code>
            </p>
          </div>
        )}

        {/* Two-column grid */}
        <div className="ccrsp-grid">

          {/* Left: Service Account View */}
          <div className="ccrsp-col">

            <div className="app-page-card ccrsp-warning-card">
              <strong>No User Context</strong>
              <p>
                Client Credentials grant provides <em>application-level access</em> without any user context.
                This view shows what a machine client sees — no personal banking data, no user identity.
              </p>
            </div>

            <div className="app-page-card">
              <h2>Service Account View</h2>
              {(accounts || []).map(acct => (
                <div key={acct.id} className="ccrsp-account-card">
                  <div className="ccrsp-account-top">
                    <span className="ccrsp-account-badge">
                      {(acct.accountType || 'service').replace(/_/g, ' ')}
                    </span>
                    <span className="ccrsp-account-number">{acct.accountNumber}</span>
                  </div>
                  <div className="ccrsp-account-balance">Balance: N/A</div>
                  <div className="ccrsp-account-label">{acct.label}</div>
                </div>
              ))}
              <p className="ccrsp-muted ccrsp-cc-note">
                Client Credentials grant provides application-level access. Real user accounts are only
                accessible when a user delegates access via the OIDC flow.
              </p>
            </div>

            {resourceServerInfo && (
              <div className="app-page-card">
                <h2>Resource Server</h2>
                <p className="ccrsp-info-name">{resourceServerInfo.name}</p>
                <p className="ccrsp-muted">{resourceServerInfo.description}</p>
                <p className="ccrsp-muted"><em>{resourceServerInfo.authMethod}</em></p>
                <div className="ccrsp-info-note">{resourceServerInfo.note}</div>
              </div>
            )}
          </div>

          {/* Right: CC Token + Comparison */}
          <div className="ccrsp-col">

            <div className="app-page-card ccrsp-token-card">
              <div className="ccrsp-panel-header">
                <h2>Client Credentials Token Claims</h2>
                {timeRemaining && (
                  <span className={`ccrsp-expiry${timeRemaining === 'Expired' ? ' ccrsp-expiry--expired' : ''}`}>
                    {timeRemaining}
                  </span>
                )}
              </div>

              {ccError ? (
                <p className="ccrsp-muted">CC token unavailable — see configuration error above.</p>
              ) : (
                <>
                  <ClaimRow label="Client ID" value={ccTokenClaims?.client_id} glossary={CLAIM_GLOSSARY.client_id} />
                  <ClaimRow label="Issuer (iss)" value={ccTokenClaims?.iss} glossary={CLAIM_GLOSSARY.iss} />
                  {ccTokenClaims?.aud && (
                    <div className="ccrsp-claim-row">
                      <span className="ccrsp-claim-key" title={CLAIM_GLOSSARY.aud} style={{ cursor: 'help', borderBottom: '1px dotted #b6c2cf' }}>
                        Audience (aud)
                      </span>
                      <span className="ccrsp-claim-value">
                        {Array.isArray(ccTokenClaims.aud) ? ccTokenClaims.aud.join(', ') : ccTokenClaims.aud}
                      </span>
                    </div>
                  )}
                  {tokenMetadata?.scopes && tokenMetadata.scopes.length > 0 && (
                    <div className="ccrsp-claim-row">
                      <span className="ccrsp-claim-key" title={CLAIM_GLOSSARY.scope} style={{ cursor: 'help', borderBottom: '1px dotted #b6c2cf' }}>
                        Scopes
                      </span>
                      <ScopesBadges scopes={tokenMetadata.scopes} />
                    </div>
                  )}
                  <ClaimRow label="Issued At" value={ccTokenClaims?.iat ? formatTimestamp(ccTokenClaims.iat) : null} glossary={CLAIM_GLOSSARY.iat} />
                  <ClaimRow label="Expires At" value={ccTokenClaims?.exp ? formatTimestamp(ccTokenClaims.exp) : null} glossary={CLAIM_GLOSSARY.exp} />
                  <ClaimRow label="JWT ID (jti)" value={ccTokenClaims?.jti} glossary={CLAIM_GLOSSARY.jti} />
                  <ClaimRow label="Authorized Party (azp)" value={ccTokenClaims?.azp} glossary={CLAIM_GLOSSARY.azp} />
                </>
              )}

              <div className="ccrsp-missing-claims">
                <div className="ccrsp-missing-header">Absent Claims (by design)</div>
                <div className="ccrsp-missing-claim">
                  <span className="ccrsp-missing-icon">✕</span>
                  <span className="ccrsp-missing-label"><strong>NO <code>sub</code> claim</strong></span>
                  <span className="ccrsp-missing-desc">No user identity — this token represents the application, not a person</span>
                </div>
                <div className="ccrsp-missing-claim">
                  <span className="ccrsp-missing-icon">✕</span>
                  <span className="ccrsp-missing-label"><strong>NO <code>act</code> claim</strong></span>
                  <span className="ccrsp-missing-desc">No delegation chain — RFC 8693 actor claim only exists after Token Exchange with a user token</span>
                </div>
                <div className="ccrsp-missing-claim">
                  <span className="ccrsp-missing-icon">✕</span>
                  <span className="ccrsp-missing-label"><strong>NO <code>name</code> / <code>email</code></strong></span>
                  <span className="ccrsp-missing-desc">No user identity attributes — machine clients have no associated person</span>
                </div>
              </div>
            </div>

            {comparison && (
              <div className="app-page-card">
                <h2>OIDC vs Client Credentials</h2>

                <div className="ccrsp-comparison-col ccrsp-comparison-oidc">
                  <div className="ccrsp-comparison-header">✓ {comparison.oidc?.label}</div>
                  <ul className="ccrsp-comparison-list">
                    <li>✓ User identity (<code>sub</code>)</li>
                    <li>✓ Agent delegation (<code>act</code> via RFC 8693)</li>
                    <li>✓ User banking data</li>
                    <li>✓ Auditable user context</li>
                  </ul>
                  <p className="ccrsp-comparison-desc">{comparison.oidc?.description}</p>
                </div>

                <div className="ccrsp-comparison-col ccrsp-comparison-cc">
                  <div className="ccrsp-comparison-header">{comparison.cc?.label}</div>
                  <ul className="ccrsp-comparison-list">
                    <li>✕ No user identity</li>
                    <li>✕ No delegation chain</li>
                    <li>✕ No user banking data</li>
                    <li>✕ No auditable user context</li>
                  </ul>
                  <p className="ccrsp-comparison-desc">{comparison.cc?.description}</p>
                </div>

                <div className="ccrsp-comparison-note">
                  The agent's dual token exchange (RFC 8693) targets the <strong>OIDC resource server</strong>,
                  not this CC endpoint. Client Credentials alone is insufficient for agentic user delegation.
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Interactive tester */}
        <ResourceServerTester
          endpointBase="/api/resource-server-cc/test"
          sources={CC_TESTER_SOURCES}
          intro="Submit a token and see how this banking resource server treats a machine (Client Credentials) token. The CC token is fetched server-side and never leaves it — or paste any JWT. A CC token typically gets REJECTED here: it carries no user-delegated scope and a different audience, which is exactly the point."
        />

        <div className="ccrsp-footer">
          Client Credentials: <code>client_id</code> / <code>client_secret</code> grant.
          No user authentication. No delegation. Machine only.
        </div>
      </div>
    </div>
  );
}
