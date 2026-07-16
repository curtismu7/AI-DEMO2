import React, { useState, useEffect } from 'react';
import './TokenExchangeTesterPage.css';
import JsonHighlight from '../components/shared/JsonHighlight';

export default function TokenExchangeTesterPage() {
  const [audience, setAudience] = useState('mcpgateway.ping.demo');
  const [scopes, setScopes] = useState('read write');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    fetch('/api/tokens/session-preview', { credentials: 'include' })
      .then(r => {
        if (!r.ok) throw new Error(`session-preview returned ${r.status}`);
        return r.json();
      })
      .then(data => {
        if (data.tokenEvents && data.tokenEvents.length > 0) {
          setHasSession(true);
        }
      })
      .catch(() => setHasSession(false));
  }, []);

  const handleExchange = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const scopeArray = scopes
        .split(/\s+/)
        .filter(s => s.length > 0);

      const response = await fetch('/api/tokens/exchange-test', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audience, scopes: scopeArray })
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Token exchange failed');
        setResult(data);
      } else {
        setResult(data);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const predefinedAudiences = [
    { label: 'MCP Gateway', value: 'mcpgateway.ping.demo' },
    { label: 'Agent Gateway', value: 'agentgateway.ping.demo' },
    { label: 'Enduser', value: 'enduser.ping.demo' }
  ];

  const decision = result
    ? (error ? 'error' : 'success')
    : null;

  return (
    <div className="tet-page">
      {/* Header */}
      <header className="tet-header">
        <h1 className="tet-title">RFC 8693 Token Exchange Tester</h1>
        <p className="tet-subtitle">
          Exchange your session token for a scoped delegation token using real PingOne credentials.
          See the full request and response in real time.
        </p>
      </header>

      {!hasSession ? (
        <div className="tet-no-session">
          <div className="tet-no-session__icon">!</div>
          <div>
            <strong>No active session</strong>
            <p>Log in first to test token exchange. The exchange requires a valid subject token from your session.</p>
          </div>
        </div>
      ) : (
        <div className="tet-layout">
          {/* Left: Form + quick token comparison */}
          <div className="tet-left">
            <div className="tet-form-card">
              <h2 className="tet-form-title">Exchange Parameters</h2>
              <form onSubmit={handleExchange}>
                <div className="tet-field">
                  <label className="tet-label">Target Audience (resource)</label>
                  <select
                    className="tet-select"
                    value={predefinedAudiences.find(a => a.value === audience) ? audience : '__custom'}
                    onChange={(e) => {
                      if (e.target.value !== '__custom') setAudience(e.target.value);
                    }}
                  >
                    {predefinedAudiences.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label} ({opt.value})</option>
                    ))}
                    <option value="__custom">Custom...</option>
                  </select>
                  <input
                    type="text"
                    className="tet-input"
                    value={audience}
                    onChange={(e) => setAudience(e.target.value)}
                    placeholder="Custom audience URI"
                  />
                </div>

                <div className="tet-field">
                  <label className="tet-label">Scopes (space-separated)</label>
                  <input
                    type="text"
                    className="tet-input tet-input--mono"
                    value={scopes}
                    onChange={(e) => setScopes(e.target.value)}
                    placeholder="e.g. read write agent:invoke"
                  />
                </div>

                <button type="submit" disabled={loading} className="tet-btn">
                  {loading ? 'Exchanging...' : 'Exchange Token'}
                </button>
              </form>
            </div>

            {/* Token comparison cards - shown after exchange */}
            {result && !error && (
              <div className="tet-tokens">
                <div className="tet-token-card tet-token-card--original">
                  <div className="tet-token-card__head">Subject Token (input)</div>
                  {result.original?.content?.payload ? (
                    <dl className="tet-claims">
                      <div className="tet-claim"><dt>sub</dt><dd>{result.original.content.payload.sub}</dd></div>
                      <div className="tet-claim"><dt>aud</dt><dd>{Array.isArray(result.original.content.payload.aud) ? result.original.content.payload.aud.join(', ') : result.original.content.payload.aud}</dd></div>
                      <div className="tet-claim"><dt>scope</dt><dd>{result.original.content.payload.scope}</dd></div>
                      <div className="tet-claim"><dt>exp</dt><dd>{result.original.content.expires_at}</dd></div>
                    </dl>
                  ) : (
                    <p className="tet-muted">No subject token details available</p>
                  )}
                </div>
                <div className="tet-token-card tet-token-card--exchanged">
                  <div className="tet-token-card__head">Exchanged Token (output)</div>
                  {result.exchanged?.content?.payload ? (
                    <dl className="tet-claims">
                      <div className="tet-claim"><dt>sub</dt><dd>{result.exchanged.content.payload.sub}</dd></div>
                      <div className="tet-claim"><dt>aud</dt><dd>{Array.isArray(result.exchanged.content.payload.aud) ? result.exchanged.content.payload.aud.join(', ') : result.exchanged.content.payload.aud}</dd></div>
                      <div className="tet-claim"><dt>scope</dt><dd>{result.exchanged.content.payload.scope}</dd></div>
                      {result.exchanged.content.payload.act && (
                        <div className="tet-claim tet-claim--highlight"><dt>act</dt><dd>{JSON.stringify(result.exchanged.content.payload.act)}</dd></div>
                      )}
                      <div className="tet-claim"><dt>exp</dt><dd>{result.exchanged.content.expires_at}</dd></div>
                    </dl>
                  ) : (
                    <p className="tet-muted">No exchanged token details available</p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Right: Request + Response panels (always visible, prominent) */}
          <div className="tet-right">
            <div className={`tet-panel tet-panel--request${decision ? ' tet-panel--has-data' : ''}`}>
              <div className="tet-panel__head">
                <span className="tet-panel__title">Exchange Request</span>
                <span className="tet-panel__badge">POST /as/token.oauth2</span>
              </div>
              <div className="tet-panel__body">
                {result?.request ? (
                  <pre className="tet-json"><JsonHighlight value={result.request} deep /></pre>
                ) : (
                  <div className="tet-panel__empty">
                    <p>The RFC 8693 token exchange request will appear here after you click <strong>Exchange Token</strong>.</p>
                    <div className="tet-panel__preview">
                      <code>grant_type=urn:ietf:params:oauth:grant-type:token-exchange</code>
                      <code>subject_token=&lt;your_access_token&gt;</code>
                      <code>subject_token_type=urn:ietf:params:oauth:token-type:access_token</code>
                      <code>audience={audience}</code>
                      <code>scope={scopes}</code>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className={`tet-panel tet-panel--response${decision === 'success' ? ' tet-panel--success' : ''}${decision === 'error' ? ' tet-panel--error' : ''}`}>
              <div className="tet-panel__head">
                <span className="tet-panel__title">Full Response</span>
                {decision === 'success' && <span className="tet-panel__status tet-panel__status--ok">200 OK</span>}
                {decision === 'error' && <span className="tet-panel__status tet-panel__status--err">Error</span>}
              </div>
              <div className="tet-panel__body">
                {result ? (
                  <pre className="tet-json"><JsonHighlight value={result} deep /></pre>
                ) : (
                  <div className="tet-panel__empty">
                    <p>The full PingOne response (token + metadata) will appear here after exchange.</p>
                    <div className="tet-panel__preview">
                      <code>{"{"}</code>
                      <code>{"  "}access_token: "...",</code>
                      <code>{"  "}token_type: "Bearer",</code>
                      <code>{"  "}expires_in: 3600,</code>
                      <code>{"  "}scope: "read write"</code>
                      <code>{"}"}</code>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {error && (
              <div className="tet-error-banner">
                <strong>Exchange failed:</strong> {error}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
