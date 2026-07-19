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
    // Check if user has a session
    fetch('/api/tokens/session-preview', { credentials: 'include' })
      .then(r => {
        // Non-2xx (e.g. 401 with JSON error body) must not be parsed as valid session data
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

  return (
    <div className='tet-page'>
      <div className='tet-topbar'>
        <h1>RFC 8693 Token Exchange Tester</h1>
        <span className='tet-topbar__status'>
          Exchange your session token for a scoped MCP token using real PingOne credentials.
        </span>
      </div>

      {!hasSession ? (
        <div className='tet-no-session'>Please log in first to test token exchange.</div>
      ) : (
        <div className='tet-grid'>
          {/* Left column: tokens (form + claims) */}
          <div className='tet-col-left'>
            <div className='tet-section-label'>Exchange Configuration</div>
            <form onSubmit={handleExchange} className='tet-form'>
              <div className='tet-field'>
                <label htmlFor='audience'>Target Audience (Resource URI)</label>
                <select
                  value={audience}
                  onChange={(e) => setAudience(e.target.value)}
                >
                  {predefinedAudiences.map(opt => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <input
                  type='text'
                  placeholder='Custom audience'
                  value={audience}
                  onChange={(e) => setAudience(e.target.value)}
                />
              </div>

              <div className='tet-field'>
                <label htmlFor='scopes'>Scopes (space-separated)</label>
                <input
                  type='text'
                  id='scopes'
                  value={scopes}
                  onChange={(e) => setScopes(e.target.value)}
                  placeholder='e.g. read write agent:invoke'
                />
              </div>

              <button type='submit' disabled={loading} className='tet-btn'>
                {loading ? 'Exchanging...' : 'Exchange Token'}
              </button>
            </form>

            {result?.success && (
              <>
                <div className='tet-section-label'>Original Token (Subject)</div>
                {result.original?.content?.payload && (
                  <dl className='tet-claims'>
                    <dt>sub</dt>
                    <dd>{result.original.content.payload.sub}</dd>
                    <dt>aud</dt>
                    <dd>{Array.isArray(result.original.content.payload.aud) ? result.original.content.payload.aud.join(', ') : result.original.content.payload.aud}</dd>
                    <dt>scope</dt>
                    <dd>{result.original.content.payload.scope}</dd>
                    <dt>expires</dt>
                    <dd>{result.original.content.expires_at}</dd>
                  </dl>
                )}

                <div className='tet-section-label'>Exchanged Token (Result)</div>
                {result.exchanged?.content?.payload && (
                  <dl className='tet-claims'>
                    <dt>sub</dt>
                    <dd>{result.exchanged.content.payload.sub}</dd>
                    <dt>aud</dt>
                    <dd>{Array.isArray(result.exchanged.content.payload.aud) ? result.exchanged.content.payload.aud.join(', ') : result.exchanged.content.payload.aud}</dd>
                    <dt>scope</dt>
                    <dd>{result.exchanged.content.payload.scope}</dd>
                    {result.exchanged.content.payload.act && (
                      <>
                        <dt>act</dt>
                        <dd>{JSON.stringify(result.exchanged.content.payload.act)}</dd>
                      </>
                    )}
                    <dt>expires</dt>
                    <dd>{result.exchanged.content.expires_at}</dd>
                  </dl>
                )}
              </>
            )}
          </div>

          {/* Right column: results (error / request / response) */}
          <div className='tet-col-right'>
            {error && (
              <>
                <div className='tet-section-label'>Error</div>
                <div className='tet-error'>{error}</div>
              </>
            )}

            {result?.details && (
              <>
                <div className='tet-section-label'>PingOne Error Details</div>
                <pre className='tet-json'>
                  <JsonHighlight value={result.details} />
                </pre>
              </>
            )}

            {result?.request && (
              <>
                <div className='tet-section-label'>Exchange Request</div>
                <pre className='tet-json'>
                  <JsonHighlight value={result.request} />
                </pre>
              </>
            )}

            {result && (
              <>
                <div className='tet-section-label'>Full Response</div>
                <pre className='tet-json'>
                  <JsonHighlight value={result} />
                </pre>
              </>
            )}

            {!result && !error && (
              <div className='tet-empty'>Run an exchange to see the request and response here.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
