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
    <div className='token-exchange-tester-page'>
      <div className='page-header'>
        <h1>RFC 8693 Token Exchange Tester</h1>
        <p>Exchange your session token for a scoped MCP token using real PingOne credentials.</p>
      </div>

      {!hasSession ? (
        <div className='no-session-message'>
          <p>Please log in first to test token exchange.</p>
        </div>
      ) : (
        <div className='content'>
          <div className='form-section'>
            <h2>Exchange Configuration</h2>
            <form onSubmit={handleExchange}>
              <div className='form-group'>
                <label htmlFor='audience'>Target Audience (Resource URI)</label>
                <div className='audience-selector'>
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
                  <span className='separator'>or</span>
                  <input
                    type='text'
                    placeholder='Custom audience'
                    value={audience}
                    onChange={(e) => setAudience(e.target.value)}
                    className='custom-input'
                  />
                </div>
              </div>

              <div className='form-group'>
                <label htmlFor='scopes'>Scopes (space-separated)</label>
                <input
                  type='text'
                  id='scopes'
                  value={scopes}
                  onChange={(e) => setScopes(e.target.value)}
                  placeholder='e.g. read write agent:invoke'
                />
              </div>

              <button
                type='submit'
                disabled={loading}
                className='exchange-button'
              >
                {loading ? 'Exchanging...' : 'Exchange Token'}
              </button>
            </form>
          </div>

          {error && (
            <div className='error-section'>
              <h3>Error</h3>
              <div className='error-box'>{error}</div>
            </div>
          )}

          {result && (
            <div className='result-section'>
              <h2>Exchange Result</h2>

              <div className='token-comparison'>
                <div className='token-card original'>
                  <h3>Original Token (Subject)</h3>
                  {result.original?.content && (
                    <div className='token-display'>
                      {result.original.content.payload && (
                        <div className='token-claims'>
                          <div className='claim'>
                            <span className='claim-label'>Subject (sub):</span>
                            <span className='claim-value'>{result.original.content.payload.sub}</span>
                          </div>
                          <div className='claim'>
                            <span className='claim-label'>Audience (aud):</span>
                            <span className='claim-value'>{Array.isArray(result.original.content.payload.aud) ? result.original.content.payload.aud.join(', ') : result.original.content.payload.aud}</span>
                          </div>
                          <div className='claim'>
                            <span className='claim-label'>Scopes:</span>
                            <span className='claim-value'>{result.original.content.payload.scope}</span>
                          </div>
                          <div className='claim'>
                            <span className='claim-label'>Expires:</span>
                            <span className='claim-value'>{result.original.content.expires_at}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className='token-card exchanged'>
                  <h3>Exchanged Token (Result)</h3>
                  {result.exchanged?.content && (
                    <div className='token-display'>
                      {result.exchanged.content.payload && (
                        <div className='token-claims'>
                          <div className='claim'>
                            <span className='claim-label'>Subject (sub):</span>
                            <span className='claim-value'>{result.exchanged.content.payload.sub}</span>
                          </div>
                          <div className='claim'>
                            <span className='claim-label'>Audience (aud):</span>
                            <span className='claim-value'>{Array.isArray(result.exchanged.content.payload.aud) ? result.exchanged.content.payload.aud.join(', ') : result.exchanged.content.payload.aud}</span>
                          </div>
                          <div className='claim'>
                            <span className='claim-label'>Scopes:</span>
                            <span className='claim-value'>{result.exchanged.content.payload.scope}</span>
                          </div>
                          {result.exchanged.content.payload.act && (
                            <div className='claim'>
                              <span className='claim-label'>Actor (act):</span>
                              <span className='claim-value'>{JSON.stringify(result.exchanged.content.payload.act)}</span>
                            </div>
                          )}
                          <div className='claim'>
                            <span className='claim-label'>Expires:</span>
                            <span className='claim-value'>{result.exchanged.content.expires_at}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {result.request && (
                <div className='request-section'>
                  <h3>Exchange Request</h3>
                  <JsonHighlight data={result.request} maxHeight='200px' />
                </div>
              )}

              <div className='raw-response-section'>
                <h3>Full Response</h3>
                <JsonHighlight data={result} maxHeight='300px' />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
