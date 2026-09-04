import React, { useState, useEffect } from 'react';
import useDividerDrag from '../hooks/useDividerDrag';
import './TokenExchangeTesterPage.css';
import JsonHighlight from '../components/shared/JsonHighlight';
import InlineSpinner from '../components/shared/InlineSpinner';
import { useThemeOptional } from '../context/ThemeContext';

const LOGIN_URL = '/api/auth/oauth/user/login?return_to=/token-exchange-tester';

/**
 * Summarize a token-event claims object for the readiness / step cards.
 * @param {object|null|undefined} claims
 */
function claimSummary(claims) {
  if (!claims) return null;
  return {
    sub: claims.sub || null,
    aud: Array.isArray(claims.aud) ? claims.aud.join(', ') : (claims.aud || null),
    scope: claims.scope || null,
    act: claims.act ? JSON.stringify(claims.act) : null,
    client_id: claims.client_id || null,
  };
}

/**
 * RFC 8693 Token Exchange Tester — single (subject-only) or double (subject + agent → MCP).
 */
export default function TokenExchangeTesterPage() {
  const { darkMode, toggleDarkMode } = useThemeOptional();
  const { size: leftWidth, handleProps: leftHandleProps } = useDividerDrag({
    min: 300,
    max: 640,
    initial: 380,
    storageKey: 'tet-left-width',
  });
  const [mode, setMode] = useState('single');
  const [audience, setAudience] = useState('mcpgateway.ping.demo');
  const [scopes, setScopes] = useState('read write');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [userReady, setUserReady] = useState({ status: 'checking', claims: null, label: null });
  const [agentReady, setAgentReady] = useState({ status: 'checking', claims: null, label: null });

  useEffect(() => {
    let cancelled = false;

    /**
     * Prefetch subject (session) + agent (CC) tokens. Missing subject → login.
     */
    async function loadTokens() {
      try {
        const sessionRes = await fetch('/api/tokens/session-preview', { credentials: 'include' });
        if (!sessionRes.ok) {
          if (!cancelled) {
            setUserReady({ status: 'missing', claims: null, label: 'No user session' });
          }
        } else {
          const data = await sessionRes.json();
          const userEvt = (data.tokenEvents || []).find(
            (e) => e.id === 'user-token' || e.status === 'active'
          );
          if (!cancelled) {
            if (userEvt?.claims) {
              setUserReady({
                status: 'ready',
                claims: claimSummary(userEvt.claims),
                label: userEvt.label || 'User Token',
              });
            } else if ((data.tokenEvents || []).length > 0) {
              // Session exists but claims not on first event — still treat as logged in
              setUserReady({ status: 'ready', claims: null, label: 'User session present' });
            } else {
              setUserReady({ status: 'missing', claims: null, label: 'No user session' });
            }
          }
        }
      } catch {
        if (!cancelled) {
          setUserReady({ status: 'missing', claims: null, label: 'No user session' });
        }
      }

      try {
        const agentRes = await fetch('/api/tokens/agent-cc-preview', { credentials: 'include' });
        if (!agentRes.ok) {
          if (!cancelled) {
            setAgentReady({ status: 'missing', claims: null, label: 'Agent CC unavailable' });
          }
          return;
        }
        const agentData = await agentRes.json();
        const agentEvt = (agentData.tokenEvents || [])[0];
        if (!cancelled) {
          if (agentEvt?.status === 'active' && agentEvt.claims) {
            setAgentReady({
              status: 'ready',
              claims: claimSummary(agentEvt.claims),
              label: agentEvt.label || 'Agent Actor Token (CC)',
            });
          } else if (agentEvt?.status === 'skipped' || agentEvt?.id === 'agent-cc-not-configured') {
            setAgentReady({
              status: 'missing',
              claims: null,
              label: agentEvt?.explanation || 'Agent CC not configured',
            });
          } else {
            setAgentReady({
              status: 'missing',
              claims: null,
              label: agentEvt?.explanation || agentEvt?.label || 'Agent CC fetch failed',
            });
          }
        }
      } catch {
        if (!cancelled) {
          setAgentReady({ status: 'missing', claims: null, label: 'Agent CC unavailable' });
        }
      }
    }

    loadTokens();
    return () => { cancelled = true; };
  }, []);

  const hasSession = userReady.status === 'ready';
  const agentOk = agentReady.status === 'ready';
  const canRunDouble = hasSession && agentOk;
  const canRun = mode === 'single' ? hasSession : canRunDouble;

  const handleExchange = async (e) => {
    e.preventDefault();
    if (!hasSession) {
      window.location.href = LOGIN_URL;
      return;
    }
    if (mode === 'double' && !agentOk) {
      setError('Agent actor token is not available. Configure PingOne MCP Token Exchanger credentials, then refresh.');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const scopeArray = scopes
        .split(/\s+/)
        .filter((s) => s.length > 0);

      const body = {
        mode,
        scopes: scopeArray,
      };
      if (mode === 'single') {
        body.audience = audience;
      }

      const response = await fetch('/api/tokens/exchange-test', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (response.status === 401 || data.code === 'login_required') {
        window.location.href = data.loginUrl || LOGIN_URL;
        return;
      }

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
    { label: 'Agent Gateway', value: 'mcpgateway.ping.demo' },
    { label: 'Agent Gateway', value: 'agentgateway.ping.demo' },
    { label: 'Enduser', value: 'enduser.ping.demo' },
  ];

  /**
   * Render a compact claims definition list.
   * @param {object|null} summary
   */
  function renderClaims(summary) {
    if (!summary) return <p className="tet-muted">No claims available.</p>;
    return (
      <dl className="tet-claims">
        {summary.sub && (<><dt>sub</dt><dd>{summary.sub}</dd></>)}
        {summary.aud && (<><dt>aud</dt><dd>{summary.aud}</dd></>)}
        {summary.scope && (<><dt>scope</dt><dd>{summary.scope}</dd></>)}
        {summary.client_id && (<><dt>client_id</dt><dd>{summary.client_id}</dd></>)}
        {summary.act && (<><dt>act</dt><dd>{summary.act}</dd></>)}
      </dl>
    );
  }

  /**
   * Render one hop from the 2-exchange step list.
   * @param {object} step
   * @param {number} idx
   */
  function renderStepCard(step, idx) {
    const statusClass =
      step.status === 'failed' ? 'tet-step--failed'
        : step.status === 'exchanged' || step.status === 'active' ? 'tet-step--ok'
          : 'tet-step--pending';
    return (
      <div key={step.id || idx} className={`tet-step ${statusClass}`}>
        <div className="tet-step__head">
          <span className="tet-step__label">{step.label || step.id}</span>
          <span className="tet-step__status">{step.status}</span>
        </div>
        {step.explanation && <p className="tet-step__why">{step.explanation}</p>}
        {step.claims && renderClaims(claimSummary(step.claims))}
        {step.exchangeRequest && (
          <pre className="tet-json tet-json--compact">
            <JsonHighlight value={step.exchangeRequest} />
          </pre>
        )}
      </div>
    );
  }

  return (
    <div className="tet-page">
      <div className="tet-topbar">
        <h1>RFC 8693 Token Exchange Tester</h1>
        <span className="tet-topbar__status">
          Exchange your session subject token (and agent actor token in 2-exchange mode) for a scoped MCP token using real PingOne credentials.
        </span>
        <button
          type="button"
          onClick={toggleDarkMode}
          className="tet-theme-toggle"
          title="Switch this page between light and dark"
          aria-pressed={darkMode}
        >
          {darkMode ? '☀️ Light mode' : '🌙 Dark mode'}
        </button>
      </div>

      <div className="tet-readiness">
        <div className={`tet-ready-card ${
          userReady.status === 'ready' ? 'tet-ready-card--ok'
            : userReady.status === 'checking' ? 'tet-ready-card--checking'
              : 'tet-ready-card--bad'
        }`}>
          <div className="tet-ready-card__title">
            {userReady.status === 'ready' ? '✅' : userReady.status === 'checking' ? <InlineSpinner /> : '❌'} Subject (User) Token
          </div>
          <div className="tet-ready-card__meta">{userReady.label || '—'}</div>
          {userReady.claims && renderClaims(userReady.claims)}
          {userReady.status === 'missing' && (
            <a className="tet-btn tet-btn--secondary" href={LOGIN_URL}>
              Log in to get user token
            </a>
          )}
        </div>
        <div className={`tet-ready-card ${
          agentReady.status === 'ready' ? 'tet-ready-card--ok'
            : agentReady.status === 'checking' ? 'tet-ready-card--checking'
              : 'tet-ready-card--bad'
        }`}>
          <div className="tet-ready-card__title">
            {agentReady.status === 'ready' ? '✅' : agentReady.status === 'checking' ? <InlineSpinner /> : '❌'} Agent Actor Token (CC)
          </div>
          <div className="tet-ready-card__meta">{agentReady.label || '—'}</div>
          {agentReady.claims && renderClaims(agentReady.claims)}
          {agentReady.status === 'missing' && mode === 'double' && (
            <p className="tet-ready-card__hint">
              Required for 2-exchange. Configure PingOne MCP Token Exchanger credentials in Admin → Config.
            </p>
          )}
        </div>
      </div>

      {userReady.status === 'checking' ? (
        <div className="tet-no-session">
          <InlineSpinner label="Checking session…" />
        </div>
      ) : !hasSession ? (
        <div className="tet-no-session">
          Please log in first to test token exchange.{' '}
          <a href={LOGIN_URL}>Customer Sign In</a>
        </div>
      ) : (
        <div className="tet-grid" style={{ '--tet-left-w': `${leftWidth}px` }}>
          <div className="tet-col-left">
            <div className="tet-section-label">Exchange Configuration</div>
            <form onSubmit={handleExchange} className="tet-form">
              <div className="tet-field">
                <label htmlFor="exchange-mode">Mode</label>
                <div className="tet-mode-toggle" role="group" aria-label="Exchange mode">
                  <button
                    type="button"
                    className={`tet-mode-btn ${mode === 'single' ? 'tet-mode-btn--active' : ''}`}
                    onClick={() => setMode('single')}
                    aria-pressed={mode === 'single'}
                  >
                    1-exchange
                  </button>
                  <button
                    type="button"
                    className={`tet-mode-btn ${mode === 'double' ? 'tet-mode-btn--active' : ''}`}
                    onClick={() => setMode('double')}
                    aria-pressed={mode === 'double'}
                  >
                    2-exchange
                  </button>
                </div>
                <p className="tet-field-hint">
                  {mode === 'single'
                    ? 'Subject token only → MCP (or chosen audience).'
                    : 'Subject + Agent actor → intermediate, then → MCP token (production chain).'}
                </p>
              </div>

              {mode === 'single' && (
                <div className="tet-field">
                  <label htmlFor="audience">Target Audience (Resource URI)</label>
                  <select
                    id="audience"
                    value={audience}
                    onChange={(e) => setAudience(e.target.value)}
                  >
                    {predefinedAudiences.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    placeholder="Custom audience"
                    value={audience}
                    onChange={(e) => setAudience(e.target.value)}
                  />
                </div>
              )}

              <div className="tet-field">
                <label htmlFor="scopes">Scopes (space-separated)</label>
                <input
                  type="text"
                  id="scopes"
                  value={scopes}
                  onChange={(e) => setScopes(e.target.value)}
                  placeholder="e.g. read write agent:invoke"
                />
              </div>

              <button type="submit" disabled={loading || !canRun} className="tet-btn">
                {loading
                  ? 'Exchanging...'
                  : mode === 'double'
                    ? 'Run 2-Exchange'
                    : 'Exchange Token'}
              </button>
            </form>

            {result?.success && result.mode !== 'double' && (
              <>
                <div className="tet-section-label">Original Token (Subject)</div>
                {result.original?.content?.payload && (
                  renderClaims(claimSummary(result.original.content.payload))
                )}

                <div className="tet-section-label">Exchanged Token (Result)</div>
                {result.exchanged?.content?.payload && (
                  renderClaims(claimSummary(result.exchanged.content.payload))
                )}
              </>
            )}

            {result?.mode === 'double' && Array.isArray(result.steps) && result.steps.length > 0 && (
              <>
                <div className="tet-section-label">2-Exchange Steps</div>
                <div className="tet-steps">
                  {result.steps.map(renderStepCard)}
                </div>
              </>
            )}
          </div>

          <div className="divider-drag-handle" aria-label="Resize token panel" {...leftHandleProps} />

          <div className="tet-col-right">
            {error && (
              <>
                <div className="tet-section-label">Error</div>
                <div className="tet-error">{error}</div>
              </>
            )}

            {result?.details && (
              <>
                <div className="tet-section-label">PingOne Error Details</div>
                <pre className="tet-json">
                  <JsonHighlight value={result.details} />
                </pre>
              </>
            )}

            {result?.request && (
              <>
                <div className="tet-section-label">Exchange Request</div>
                <pre className="tet-json">
                  <JsonHighlight value={result.request} />
                </pre>
              </>
            )}

            {result && (
              <>
                <div className="tet-section-label">Full Response</div>
                <pre className="tet-json">
                  <JsonHighlight value={result} />
                </pre>
              </>
            )}

            {!result && !error && (
              <div className="tet-empty">Run an exchange to see the request and response here.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
