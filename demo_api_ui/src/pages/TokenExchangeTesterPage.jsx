// /token-exchange-tester: RFC 8693 token exchange, single (subject only) or double (subject + agent actor).
//
// Honesty: nothing here is simulated. Run sends a real token-exchange request, made by the BFF, to the token
// endpoint the app is configured with, using the signed-in session's token as the subject. The page never names
// the identity provider because the response does not say which one answered; it reports what the BFF returned.
// Signed out there is no subject token, so the page says so and offers sign-in; it never navigates away on its own.
//
// Layout follows the standalone Ping UI Standard (AI-DEMO-Standalone/shared/STANDALONE-UI-PATTERNS.md) through the
// shared primitives (components/pingUi, docs/ping-ui-primitives.md): P2 banner first, P3 frame, P4 cards, P5 kv,
// P7 chips, P9 buttons. P9 "one primary per view": ONE primary button element whose job follows the state. Checking:
// none is offered (nothing can be done yet). Signed out: "Customer Sign In". Signed in: "Exchange Token" /
// "Run 2-Exchange". It takes aria-disabled (never disabled) while running or when 2-exchange lacks the agent
// token, so focus stays on it and a click explains why. Mode buttons and the theme toggle are secondaries.
// Page CSS keeps only the two-column split, the mode toggle mark and the JSON blocks.
import React, { useId, useState, useEffect, useRef } from 'react';
import useDividerDrag from '../hooks/useDividerDrag';
import './TokenExchangeTesterPage.css';
import JsonHighlight from '../components/shared/JsonHighlight';
import InlineSpinner from '../components/shared/InlineSpinner';
import PageHeader from '../components/common/PageHeader';
import {
  PingPage, SimBanner, PageFrame, Section, CardGrid, Card, StatusChip, KvList,
} from '../components/pingUi';
import { useThemeOptional } from '../context/ThemeContext';
import { openSignIn } from '../utils/signInService';

const RETURN_TO = '/token-exchange-tester';

// A readiness check that never answers must not leave the cards on "Checking" for ever.
const CHECK_TIMEOUT_MS = 8000;

/** fetch() that gives up after `ms`; the abort surfaces as an AbortError the caller maps to a plain-words label. */
async function fetchWithTimeout(url, init, ms = CHECK_TIMEOUT_MS) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}

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

/** claimSummary() output as KvList rows; empty when nothing was returned. */
function claimItems(summary) {
  if (!summary) return [];
  return ['sub', 'aud', 'scope', 'client_id', 'act']
    .filter((k) => summary[k])
    .map((k) => ({ label: k, value: summary[k], mono: true }));
}

/** Decoded claims as a key-value list. */
function Claims({ summary }) {
  const items = claimItems(summary);
  if (items.length === 0) return <p className="pu-note">No claims available.</p>;
  return <KvList items={items} />;
}

/** A scrollable JSON block: focusable and named, so keyboard users can scroll it. */
function JsonBlock({ label, value, compact, dark }) {
  const id = useId();
  return (
    <>
      <p className="pu-label tet-json-label" id={id}>{label}</p>
      <pre
        className={`tet-json${compact ? ' tet-json--compact' : ''}${dark ? ' jh-dark' : ''}`}
        tabIndex={0}
        role="region"
        aria-labelledby={id}
      >
        <JsonHighlight value={value} />
      </pre>
    </>
  );
}

const STEP_STATUS = {
  failed: { tone: 'danger', word: 'Failed' },
  exchanged: { tone: 'ok', word: 'Exchanged' },
  active: { tone: 'ok', word: 'Exchanged' },
};

const PREDEFINED_AUDIENCES = [
  { label: 'Agent Gateway: mcpgateway', value: 'mcpgateway.ping.demo' },
  { label: 'Agent Gateway: agentgateway', value: 'agentgateway.ping.demo' },
  { label: 'Enduser', value: 'enduser.ping.demo' },
];

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
  const [sessionEnded, setSessionEnded] = useState(false);
  const runRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    /**
     * Prefetch subject (session) + agent (CC) tokens. Missing subject → login.
     */
    async function loadTokens() {
      try {
        const sessionRes = await fetchWithTimeout('/api/tokens/session-preview', { credentials: 'include' });
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
      } catch (err) {
        // A failed or timed-out request is not "no session": say the session was not checked.
        if (!cancelled) {
          setUserReady({
            status: 'missing',
            unchecked: true,
            claims: null,
            label: err?.name === 'AbortError'
              ? 'The session check timed out'
              : 'The session could not be checked',
          });
        }
      }

      try {
        const agentRes = await fetchWithTimeout('/api/tokens/agent-cc-preview', { credentials: 'include' });
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
      } catch (err) {
        if (!cancelled) {
          setAgentReady({
            status: 'missing',
            claims: null,
            label: err?.name === 'AbortError' ? 'The agent token check timed out' : 'Agent CC unavailable',
          });
        }
      }
    }

    loadTokens();
    return () => { cancelled = true; };
  }, []);

  const hasSession = userReady.status === 'ready';
  const checking = userReady.status === 'checking';
  const agentOk = agentReady.status === 'ready';
  const canRunDouble = hasSession && agentOk;
  const canRun = mode === 'single' ? hasSession : canRunDouble;
  const blockedDouble = hasSession && mode === 'double' && !agentOk;

  // The session can end while focus is in a field that then leaves the page: put focus on the one button that is left.
  useEffect(() => {
    if (sessionEnded) runRef.current?.focus();
  }, [sessionEnded]);

  // A result or error belongs to the mode that produced it; do not carry it into the other mode.
  const chooseMode = (next) => {
    if (next === mode) return;
    setMode(next);
    setResult(null);
    setError(null);
  };

  const handleExchange = async (e) => {
    e.preventDefault();
    if (loading) return; // aria-disabled keeps focus; the submit is ignored
    if (!hasSession) {
      openSignIn({ returnTo: RETURN_TO });
      return;
    }
    if (mode === 'double' && !agentOk) {
      setResult(null);
      setError('Agent actor token is not available. Configure the MCP Token Exchanger credentials, then refresh.');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);
    setSessionEnded(false);

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
        // The session ended between the readiness check and the run. Say so and offer sign-in on the page
        // (the one primary button turns into "Customer Sign In"); never navigate away unasked.
        setUserReady({ status: 'missing', claims: null, label: 'No user session' });
        setSessionEnded(true);
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

  const signIn = () => openSignIn({ returnTo: RETURN_TO });

  const subjectChip = {
    ready: { tone: 'ok', word: 'Ready' },
    checking: { tone: 'neutral', word: 'Checking' },
    missing: userReady.unchecked
      ? { tone: 'warn', word: 'Not checked' }
      : { tone: 'warn', word: 'Signed out' },
  }[userReady.status];
  const agentChip = {
    ready: { tone: 'ok', word: 'Ready' },
    checking: { tone: 'neutral', word: 'Checking' },
    missing: mode === 'double'
      ? { tone: 'danger', word: 'Required' }
      : { tone: 'warn', word: 'Unavailable' },
  }[agentReady.status];

  // What the last run did, in the words of the engine that answered: this page checked nothing itself, it reports
  // what the BFF returned. Green only for a success the BFF reported.
  let runStatus;
  if (loading) runStatus = { tone: 'neutral', word: 'Running', text: 'Sending the exchange request.' };
  else if (error) runStatus = { tone: 'danger', word: 'Failed', text: error };
  else if (result?.success) {
    runStatus = {
      tone: 'ok',
      word: 'Issued',
      text: result.mode === 'double'
        ? 'Both exchanges succeeded. Each step has its own card with its claims.'
        : 'The 1-exchange request returned an exchanged token. Its decoded claims are in the Exchanged token card.',
    };
  } else runStatus = { tone: 'neutral', word: 'Not run', text: 'Run an exchange to see the request and response here.' };

  const showSingleClaims = result?.success && result.mode !== 'double';
  const steps = result?.mode === 'double' && Array.isArray(result.steps) ? result.steps : [];
  const darkJson = Boolean(darkMode);

  let primaryLabel = 'Exchange Token';
  if (!hasSession) primaryLabel = 'Customer Sign In';
  else if (loading) primaryLabel = 'Exchanging...';
  else if (mode === 'double') primaryLabel = 'Run 2-Exchange';

  return (
    <PingPage className="tet-page">
      <SimBanner data-testid="tet-banner">
        <strong>LIVE EXCHANGE</strong> — nothing here is simulated. Run sends a real RFC 8693 token-exchange request,
        made by this app&apos;s BFF, to the token endpoint the app is configured with. The subject is your session
        token (the agent&apos;s token is the actor in 2-exchange). Only decoded claims are shown. Signed out, there is
        nothing to exchange.
      </SimBanner>
      <PageHeader
        eyebrow="Tokens & delegation"
        title="RFC 8693 Token Exchange Tester"
        summary="Exchange your session's subject token (and the agent actor token in 2-exchange mode) for a scoped token, and read the claims that come back."
        actions={(
          <button
            type="button"
            onClick={toggleDarkMode}
            className="pu-btn"
            title="Switch this page between light and dark"
            aria-pressed={darkMode}
          >
            {darkMode ? '☀️ Light mode' : '🌙 Dark mode'}
          </button>
        )}
      />
      <PageFrame>
        <Section
          id="tet-tokens-h"
          kicker="1 · Tokens in play"
          title="What the exchange starts from"
          lede="This page checks both tokens when it loads. The subject token comes from your session; the agent actor token is the MCP Token Exchanger's client-credentials token, fetched by the BFF."
        >
          <CardGrid>
            <Card
              title="Subject (user) token"
              tone={hasSession ? 'ok' : 'neutral'}
              data-testid="tet-subject"
            >
              <p className="pu-status-line" role="status">
                <StatusChip tone={subjectChip.tone}>{subjectChip.word}</StatusChip>
                {checking ? <InlineSpinner label="Checking user token…" /> : null}
              </p>
              <p className="pu-note">{userReady.label || '—'}</p>
              {userReady.claims && <Claims summary={userReady.claims} />}
              {userReady.status === 'missing' && (
                <div className="pu-actions">
                  <button type="button" className="pu-btn" onClick={signIn}>
                    Log in to get user token
                  </button>
                </div>
              )}
            </Card>
            <Card
              title="Agent actor token (client credentials)"
              tone={agentOk ? 'ok' : 'neutral'}
              data-testid="tet-agent"
            >
              <p className="pu-status-line" role="status">
                <StatusChip tone={agentChip.tone}>{agentChip.word}</StatusChip>
                {agentReady.status === 'checking' ? <InlineSpinner label="Checking agent token…" /> : null}
              </p>
              <p className="pu-note">{agentReady.label || '—'}</p>
              {agentReady.claims && <Claims summary={agentReady.claims} />}
              {agentReady.status === 'missing' && mode === 'double' && (
                <p className="pu-note">
                  Required for 2-exchange. Configure the MCP Token Exchanger credentials in Admin → Config.
                </p>
              )}
            </Card>
          </CardGrid>
        </Section>

        <Section
          id="tet-run-h"
          kicker="2 · Run an exchange"
          title="Configure it, run it, read the result"
        >
          <div
            className={`tet-grid${hasSession ? '' : ' tet-grid--solo'}`}
            style={{ '--tet-left-w': `${leftWidth}px` }}
          >
            <div className="tet-col-left">
              <Card title="Exchange configuration" data-testid="tet-config">
                <form onSubmit={handleExchange} className="tet-form" aria-label="Exchange configuration">
                  {/* One live region that exists from the first render; its content changes. */}
                  <div role="status" data-testid="tet-session-status">
                    {checking && (
                      <p className="pu-status-line">
                        <InlineSpinner label="Checking session…" />
                      </p>
                    )}
                    {!checking && !hasSession && (
                      <p className="pu-status-line">
                        <StatusChip tone="warn">{subjectChip.word}</StatusChip>
                        {sessionEnded
                          ? 'Your session ended, so the exchange did not run. Sign in again to continue.'
                          : userReady.unchecked
                            ? `${userReady.label}. Sign in to continue, or reload to check again.`
                            : 'Please log in first to test token exchange. The subject token comes from your session.'}
                      </p>
                    )}
                  </div>
                  {hasSession && (
                    <>
                      <div className="tet-field">
                        <p className="pu-label" id="tet-mode-label">Mode</p>
                        <div className="tet-mode" role="group" aria-labelledby="tet-mode-label">
                          <button
                            type="button"
                            className="pu-btn"
                            onClick={() => chooseMode('single')}
                            aria-pressed={mode === 'single'}
                          >
                            1-exchange
                          </button>
                          <button
                            type="button"
                            className="pu-btn"
                            onClick={() => chooseMode('double')}
                            aria-pressed={mode === 'double'}
                          >
                            2-exchange
                          </button>
                        </div>
                        <p className="pu-note">
                          {mode === 'single'
                            ? 'Subject token only → MCP (or chosen audience).'
                            : 'Subject + Agent actor → intermediate, then → MCP token (production chain).'}
                        </p>
                      </div>

                      {mode === 'single' && (
                        <div className="tet-field">
                          <label className="pu-label" htmlFor="audience">Target Audience (Resource URI)</label>
                          <select
                            id="audience"
                            className="pu-select"
                            value={audience}
                            onChange={(e) => setAudience(e.target.value)}
                          >
                            {PREDEFINED_AUDIENCES.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                          <input
                            type="text"
                            className="pu-select tet-input"
                            placeholder="Custom audience"
                            aria-label="Custom audience"
                            value={audience}
                            onChange={(e) => setAudience(e.target.value)}
                          />
                        </div>
                      )}

                      <div className="tet-field">
                        <label className="pu-label" htmlFor="scopes">Scopes (space-separated)</label>
                        <input
                          type="text"
                          id="scopes"
                          className="pu-select tet-input"
                          value={scopes}
                          onChange={(e) => setScopes(e.target.value)}
                          placeholder="e.g. read write agent:invoke"
                        />
                      </div>
                    </>
                  )}

                  {!checking && (
                    <div className="pu-actions">
                      <button
                        type={hasSession ? 'submit' : 'button'}
                        className="pu-btn pu-btn--primary"
                        aria-disabled={hasSession && (loading || !canRun) ? 'true' : undefined}
                        aria-describedby={blockedDouble ? 'tet-run-reason' : undefined}
                        onClick={hasSession ? undefined : signIn}
                        data-testid="tet-run"
                        ref={runRef}
                      >
                        {primaryLabel}
                      </button>
                    </div>
                  )}
                  {blockedDouble && (
                    <p className="pu-note" id="tet-run-reason">
                      Run 2-Exchange is unavailable until the agent actor token is ready (see the card above).
                    </p>
                  )}
                </form>
              </Card>

              {showSingleClaims && (
                <>
                  {result.original?.content?.payload && (
                    <Card title="Original token (subject)" tone="neutral" data-testid="tet-original">
                      <p className="pu-status-line"><StatusChip tone="neutral">Decoded</StatusChip></p>
                      <Claims summary={claimSummary(result.original.content.payload)} />
                    </Card>
                  )}
                  {result.exchanged?.content?.payload && (
                    <Card title="Exchanged token (result)" tone="ok" data-testid="tet-exchanged">
                      <p className="pu-status-line"><StatusChip tone="ok">Issued</StatusChip></p>
                      <Claims summary={claimSummary(result.exchanged.content.payload)} />
                    </Card>
                  )}
                </>
              )}

              {steps.length > 0 && (
                <div className="tet-steps" data-testid="tet-steps">
                  {steps.map((step, idx) => {
                    const chip = STEP_STATUS[step.status] || { tone: 'neutral', word: String(step.status || 'Pending') };
                    return (
                      <Card
                        key={step.id || idx}
                        title={step.label || step.id}
                        tone={chip.tone}
                      >
                        <p className="pu-status-line"><StatusChip tone={chip.tone}>{chip.word}</StatusChip></p>
                        {step.explanation && <p className="pu-note">{step.explanation}</p>}
                        {step.claims && <Claims summary={claimSummary(step.claims)} />}
                        {step.exchangeRequest && (
                          <JsonBlock label="Step request" value={step.exchangeRequest} compact dark={darkJson} />
                        )}
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>

            {hasSession && (
              <>
                <div className="divider-drag-handle" aria-label="Resize token panel" {...leftHandleProps} />

                <div className="tet-col-right">
                  <Card
                    title="Request and response"
                    tone={runStatus.tone === 'ok' ? 'ok' : runStatus.tone === 'danger' ? 'danger' : 'neutral'}
                    data-testid="tet-response"
                  >
                    <div role="status" className="tet-result-status" data-testid="tet-status">
                      <p className="pu-status-line">
                        <StatusChip tone={runStatus.tone}>{runStatus.word}</StatusChip>
                      </p>
                      <p className={error ? 'tet-error' : 'pu-note'}>{runStatus.text}</p>
                    </div>

                    {result?.details && (
                      <JsonBlock label="Token endpoint error details" value={result.details} dark={darkJson} />
                    )}
                    {result?.request && (
                      <JsonBlock label="Exchange request" value={result.request} dark={darkJson} />
                    )}
                    {result && (
                      <JsonBlock label="Full response" value={result} dark={darkJson} />
                    )}
                  </Card>
                </div>
              </>
            )}
          </div>
        </Section>
      </PageFrame>
    </PingPage>
  );
}
