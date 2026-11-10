// demo_api_ui/src/components/ResourceServerPage.jsx (/resource-server)
//
// What is real here: the claims are decoded by the demo API from the signed-in session's own access and ID tokens
// (display only, no signature check on this page), or from the gateway token it cached after an RFC 8693 exchange.
// What is demo data: the balances and transactions come from the demo bank's data store.
//
// Layout follows the standalone Ping UI Standard (AI-DEMO-Standalone/shared/STANDALONE-UI-PATTERNS.md) on the shared
// primitives (components/pingUi, docs/ping-ui-primitives.md): P2 banner first, P3 frame, P4 cards, P5 kv, P7 chips,
// P9 buttons. Skipped: P6 (the tester below is the shared inspector shell, restyled only at its buttons) and P8 (no
// diagram). The standalone shell bar is not added (the app has its own).
//
// P9, one primary per view state: loading, signed out and failed have none of this page's buttons (signed out shows
// the shared sign-in prompt, whose Sign in button is that state's one action). Once loaded, the tester's top Execute
// is the only primary. The bottom Execute, Clear and the Login RS / In-flow RS tabs are secondaries.
import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import bffAxios from '../services/bffAxios';
import ResourceServerTester, { INFLOW_PROBE_TARGETS, INFLOW_SOURCES } from './ResourceServerTester';
import { formatCurrency, formatDateTime } from '../utils/formatters';
import PageHeader from './common/PageHeader';
import { PingPage, SimBanner, PageFrame, Section, CardGrid, Card, StatusChip } from './pingUi';
import './ResourceServerPage.css';
import SignInPrompt from './SignInPrompt';
import PingIdentitySpinner from './shared/PingIdentitySpinner';

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

export default function ResourceServerPage() {
  const [view, setView] = useState('login');
  const [loginData, setLoginData] = useState(null);
  const [inflowData, setInflowData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [timeRemaining, setTimeRemaining] = useState(null);
  const tabRefs = useRef({});

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
  const state = loading ? 'loading' : error === 'auth' ? 'auth' : error ? 'error' : 'ready';

  // Every state shares one frame: banner first, then the title band, so a signed-out or failed page still says what it is.
  const frame = (children, title = 'OIDC Resource Server', summary = null, eyebrow = null) => (
    <PingPage className="rsv-page">
      <SimBanner data-testid="rsv-banner">{bannerFor(state, isInflow, Boolean(hasMcpToken && accessTokenClaims))}</SimBanner>
      <PageHeader eyebrow={eyebrow} title={title} summary={summary} />
      <PageFrame>{children}</PageFrame>
    </PingPage>
  );

  if (state === 'loading') {
    return frame(
      <div className="rsv-loading" role="status">
        <PingIdentitySpinner size={36} label="Loading OIDC Resource Server…" />
      </div>,
    );
  }

  if (state === 'auth') {
    return frame(<SignInPrompt message="Sign in to access the OIDC Resource Server." />);
  }

  if (state === 'error') {
    return frame(
      <Card tone="danger" title="Could not load the summaries" role="alert" data-testid="rsv-error">
        <p className="pu-status-line"><StatusChip tone="danger">Not loaded</StatusChip> {error}</p>
      </Card>,
    );
  }

  const totalBalance = (accounts || []).reduce((sum, a) => sum + (a.balance || 0), 0);

  // Arrow keys move between the two tabs (roving tabindex), as the tablist role promises.
  const onTabKey = (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const at = VIEWS.findIndex((v) => v.id === view);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? VIEWS.length - 1 : (at + (e.key === 'ArrowRight' ? 1 : -1) + VIEWS.length) % VIEWS.length;
    setView(VIEWS[next].id);
    tabRefs.current[VIEWS[next].id]?.focus();
  };

  return frame(
    <>
      <div className="rsv-tabs" role="tablist" aria-label="Resource server view" onKeyDown={onTabKey}>
        {VIEWS.map((v) => (
          <button
            key={v.id}
            ref={(el) => { tabRefs.current[v.id] = el; }}
            type="button"
            role="tab"
            id={`rsv-tab-${v.id}`}
            aria-selected={view === v.id}
            aria-controls="rsv-panel"
            tabIndex={view === v.id ? 0 : -1}
            className={`rsv-tab${view === v.id ? ' rsv-tab--active' : ''}`}
            onClick={() => setView(v.id)}
          >
            {v.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id="rsv-panel" aria-labelledby={`rsv-tab-${view}`}>
        <Section id="rsv-hop" kicker="1 · This hop" title={isInflow ? 'The gateway hop' : 'The sign-in hop'}>
          <Card tone="neutral" className="rsv-explainer" data-testid="rsv-explainer">
            <p className="pu-note">
              {isInflow ? (
                <>
                  <strong>In-flow resource server.</strong> After RFC 8693 exchange the agent
                  bearer targets the MCP gateway audience (
                  <code className="rsv-code">{resourceServerInfo?.targetAudience || 'mcpgateway.ping.demo'}</code>
                  ). Path B posts that token to <code className="rsv-code">/api/resource-server/identity</code>.
                  {!hasMcpToken && (
                    <> No cached TX token yet — run an agent tool or Execute in the tester to mint one.</>
                  )}
                </>
              ) : (
                <>
                  <strong>Login resource server.</strong> Decodes your session access token
                  (audience <code className="rsv-code">{resourceServerInfo?.targetAudience || 'enduser.ping.demo'}</code>
                  ) — the first hop after sign-in. Switch to <strong>In-flow RS</strong> for the
                  gateway TX hop used in the live agent path.
                </>
              )}
            </p>
            <nav className="rsv-links" aria-label="Journey pages">
              <span className="rsv-links-label">Journey pages</span>
              <Link to="/rs/olb" className="rsv-link">OLB</Link>
              <Link to="/rs/invest" className="rsv-link">Invest</Link>
              <Link to="/rs/api?tool=show_mortgage&vertical=mortgage" className="rsv-link">API RS</Link>
            </nav>
          </Card>
        </Section>

        <Section id="rsv-data" kicker="2 · What the resource server holds" title={isInflow ? 'Gateway token status' : 'Demo bank data it would serve'}>
          <CardGrid>
            {isInflow ? (
              <Card tone={hasMcpToken ? 'ok' : 'neutral'} title="In-flow hop" data-testid="rsv-inflow-hero">
                <p className="pu-status-line">
                  <StatusChip tone={hasMcpToken ? 'ok' : 'neutral'}>{hasMcpToken ? 'TX token cached' : 'No TX token yet'}</StatusChip>
                </p>
                <p className="pu-note">Probe target: <span className="pu-mono">{resourceServerInfo?.probeHint || '/api/resource-server/identity'}</span></p>
              </Card>
            ) : (
              <>
                <Card title="Accounts" data-testid="rsv-accounts">
                  <p className="pu-status-line"><StatusChip>Demo data</StatusChip></p>
                  <p className="rsv-total-label">Total balance</p>
                  <p className="rsv-total">{formatCurrency(totalBalance || 0, 'USD')}</p>
                  <p className="pu-note">{accounts?.length || 0} account{accounts?.length !== 1 ? 's' : ''}</p>
                  <ul className="rsv-accounts">
                    {(accounts || []).map((acct) => (
                      <li key={acct.id} className="rsv-account">
                        <span className="rsv-account-top">
                          <StatusChip>{(acct.accountType || 'account').replace(/_/g, ' ')}</StatusChip>
                          <span className="pu-mono">{acct.accountNumber}</span>
                        </span>
                        <span className="rsv-account-balance">{formatCurrency(acct.balance || 0, acct.currency || 'USD')}</span>
                        <span className="pu-note">{acct.name || ''}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
                {transactions && transactions.length > 0 && (
                  <Card tone="neutral" title="Recent transactions" data-testid="rsv-transactions">
                    <p className="pu-status-line"><StatusChip>Demo data</StatusChip></p>
                    <ul className="rsv-txns">
                      {transactions.map((txn) => (
                        <li key={txn.id} className="rsv-txn-row">
                          <span>{txn.description}</span>
                          <span className={`rsv-txn-amount ${txn.amount >= 0 ? 'positive' : 'negative'}`}>
                            {txn.amount >= 0 ? '+' : ''}{formatCurrency(txn.amount || 0, 'USD')}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </Card>
                )}
              </>
            )}
            <Card tone="neutral" title="Resource server info" data-testid="rsv-info">
              <ClaimList
                rows={[
                  { label: 'Name', value: resourceServerInfo?.name },
                  { label: 'Type', value: resourceServerInfo?.type },
                  { label: 'Auth Method', value: resourceServerInfo?.authMethod },
                  { label: 'Target Audience', value: resourceServerInfo?.targetAudience },
                  { label: 'Description', value: resourceServerInfo?.description },
                ]}
              />
            </Card>
          </CardGrid>
        </Section>

        <Section id="rsv-claims" kicker="3 · Token claims" title={isInflow ? 'The gateway token' : 'Your session tokens'}>
          <CardGrid>
            {accessTokenClaims ? (
              <AccessTokenPanel
                accessTokenClaims={accessTokenClaims}
                tokenMetadata={tokenMetadata}
                resourceServerInfo={resourceServerInfo}
                timeRemaining={timeRemaining}
              />
            ) : (
              <Card tone="neutral" title="Access token claims" data-testid="rsv-access-claims">
                <p className="pu-status-line"><StatusChip>No token</StatusChip></p>
                <p className="pu-note pu-empty">
                  {isInflow
                    ? 'No cached in-flow token. Use the tester below (In-flow MCP / gateway TX) — Execute mints via RFC 8693 when needed.'
                    : 'No access token claims available.'}
                </p>
              </Card>
            )}
            {!isInflow && (
              <Card tone="live" title="ID token claims" data-testid="rsv-id-claims">
                <p className="pu-status-line"><StatusChip tone="info">Decoded from the token</StatusChip></p>
                <ClaimList
                  rows={[
                    { label: 'Subject (sub)', value: idTokenClaims?.sub, glossary: CLAIM_GLOSSARY.sub },
                    { label: 'Name', value: idTokenClaims?.name, glossary: CLAIM_GLOSSARY.name },
                    { label: 'Email', value: idTokenClaims?.email, glossary: CLAIM_GLOSSARY.email },
                    { label: 'Preferred Username', value: idTokenClaims?.preferred_username, glossary: CLAIM_GLOSSARY.preferred_username },
                    { label: 'Given Name', value: idTokenClaims?.given_name, glossary: CLAIM_GLOSSARY.given_name },
                    { label: 'Family Name', value: idTokenClaims?.family_name, glossary: CLAIM_GLOSSARY.family_name },
                    { label: 'Auth Time', value: idTokenClaims?.auth_time ? formatDateTime(idTokenClaims.auth_time) || '—' : null, glossary: CLAIM_GLOSSARY.auth_time },
                    { label: 'ACR', value: idTokenClaims?.acr, glossary: CLAIM_GLOSSARY.acr },
                  ]}
                />
              </Card>
            )}
          </CardGrid>
        </Section>

        <Section id="rsv-test" kicker="4 · Try it" title="Test this resource server">
          <ResourceServerTester
            key={view}
            profile={view}
            sources={isInflow ? INFLOW_SOURCES : undefined}
            probeTargets={isInflow ? INFLOW_PROBE_TARGETS : undefined}
            executeButtonClassName="pu-btn pu-btn--primary"
            secondaryButtonClassName="pu-btn"
            titleLevel={2}
            intro={
              isInflow
                ? 'Test the in-flow RS the gateway Path B uses. Default token is the cached MCP / gateway TX (minted on Execute if missing). Probe /identity to match dual_token.'
                : 'Submit a login-session token and see how this resource server would treat it. Pick one by reference, or paste any JWT to test a failure case.'
            }
          />
          <p className="pu-note rsv-audience" data-testid="rsv-audience">
            This view expects audience:{' '}
            <code className="rsv-code">{resourceServerInfo?.targetAudience || '(not configured)'}</code>
            {isInflow ? ' (gateway TX)' : ' (login)'}
          </p>
        </Section>
      </div>
    </>,
    'OIDC Resource Server',
    isInflow
      ? 'Gateway TX hop — same /api/resource-server Path B the agent dual_token flow calls'
      : 'Login hop — enduser audience on the session access token (not the MCP exchange target)',
    isInflow ? 'IN-FLOW GATEWAY PATH' : 'LOGIN OAUTH PATH',
  );
}

// Helpers below the page so the page's own banner is the first element in the file (the pattern check reads top down).
/** Claim rows as a key/value list. A row with no value is left out. `title` is the glossary tooltip. */
function ClaimList({ rows }) {
  const shown = rows.filter((r) => r.value !== undefined && r.value !== null);
  if (shown.length === 0) return null;
  return (
    <dl className="pu-kv rsv-claims">
      {shown.flatMap((r) => [
        <dt key={`${r.label}-k`}>
          <span className={r.glossary ? 'rsv-term' : undefined} title={r.glossary || undefined}>{r.label}</span>
          {r.tag}
        </dt>,
        <dd key={`${r.label}-v`} className="pu-mono">
          {typeof r.value === 'object' ? JSON.stringify(r.value, null, 2) : String(r.value)}
        </dd>,
      ])}
    </dl>
  );
}

function ScopesBadges({ scopes, highlightBanking }) {
  if (!scopes || scopes.length === 0) return <span className="pu-note">No scopes</span>;
  return (
    <ul className="rsv-scopes" aria-label="Scopes">
      {scopes.map((s) => (
        <li
          key={s}
          className={`rsv-scope-badge ${highlightBanking && s.startsWith('banking:') ? 'rsv-scope-banking' : ''}`}
        >
          {s}
        </li>
      ))}
    </ul>
  );
}

/** Access-token claims card shared by the login and in-flow views. */
function AccessTokenPanel({ accessTokenClaims, tokenMetadata, resourceServerInfo, timeRemaining }) {
  const audValue = tokenMetadata?.audience;
  const audMatchesResource = resourceServerInfo?.targetAudience &&
    (Array.isArray(audValue)
      ? audValue.includes(resourceServerInfo.targetAudience)
      : audValue === resourceServerInfo.targetAudience);
  const aud = accessTokenClaims?.aud;
  const scopes = tokenMetadata?.scopes;

  return (
    <Card tone="live" title="Access token claims" data-testid="rsv-access-claims">
      <p className="pu-status-line">
        <StatusChip tone="info">Decoded from the token</StatusChip>
        {timeRemaining && (
          <StatusChip tone={timeRemaining === 'Expired' ? 'danger' : 'ok'}>{timeRemaining}</StatusChip>
        )}
      </p>
      <ClaimList
        rows={[
          { label: 'Subject (sub)', value: accessTokenClaims?.sub, glossary: CLAIM_GLOSSARY.sub },
          { label: 'Issuer (iss)', value: accessTokenClaims?.iss, glossary: CLAIM_GLOSSARY.iss },
          {
            label: 'Audience (aud)',
            value: aud ? (Array.isArray(aud) ? aud.join(', ') : aud) : undefined,
            glossary: CLAIM_GLOSSARY.aud,
            tag: audMatchesResource ? <StatusChip tone="ok">This resource server</StatusChip> : null,
          },
        ]}
      />
      {scopes && scopes.length > 0 && (
        <dl className="pu-kv rsv-claims">
          <dt><span className="rsv-term" title={CLAIM_GLOSSARY.scope}>Scopes</span></dt>
          <dd><ScopesBadges scopes={scopes} highlightBanking /></dd>
        </dl>
      )}
      <ClaimList
        rows={[
          { label: 'Client ID', value: accessTokenClaims?.client_id, glossary: CLAIM_GLOSSARY.client_id },
          { label: 'Authorized Party (azp)', value: accessTokenClaims?.azp, glossary: CLAIM_GLOSSARY.azp },
          { label: 'JWT ID (jti)', value: accessTokenClaims?.jti, glossary: CLAIM_GLOSSARY.jti },
          { label: 'Issued At', value: accessTokenClaims?.iat ? formatDateTime(accessTokenClaims.iat) || '—' : null, glossary: CLAIM_GLOSSARY.iat },
          { label: 'Expires At', value: accessTokenClaims?.exp ? formatDateTime(accessTokenClaims.exp) || '—' : null, glossary: CLAIM_GLOSSARY.exp },
          { label: 'ACR', value: accessTokenClaims?.acr, glossary: CLAIM_GLOSSARY.acr },
        ]}
      />
      {accessTokenClaims?.act && (
        <div className="rsv-callout rsv-callout--act" data-testid="rsv-act-box">
          <p className="rsv-callout-title">Agent acting on behalf</p>
          <ClaimList rows={[{ label: 'Actor (act)', value: accessTokenClaims.act, glossary: CLAIM_GLOSSARY.act }]} />
        </div>
      )}
      {accessTokenClaims?.may_act && (
        <div className="rsv-callout rsv-callout--may-act" data-testid="rsv-may-act-box">
          <p className="rsv-callout-title">May act (delegation pre-authorization)</p>
          <ClaimList rows={[{ label: 'may_act', value: accessTokenClaims.may_act, glossary: CLAIM_GLOSSARY.may_act }]} />
        </div>
      )}
    </Card>
  );
}

const VIEWS = [
  { id: 'login', label: 'Login RS' },
  { id: 'inflow', label: 'In-flow RS' },
];

/** The P2 banner text for the state the page is actually in (never fixed text that is false while signed out or failed). */
function bannerFor(state, isInflow, hasToken) {
  if (state === 'loading') {
    return <><strong>LOADING</strong> — asking the demo API for the resource server summaries. Nothing below is shown until it answers.</>;
  }
  if (state === 'auth') {
    return <><strong>SIGNED OUT</strong> — this page decodes the tokens of your signed-in session, so there is nothing to show until you sign in.</>;
  }
  if (state === 'error') {
    return <><strong>NOT LOADED</strong> — the demo API did not return the summaries, so nothing on this page is current.</>;
  }
  if (isInflow) {
    return hasToken ? (
      <>
        <strong>REAL GATEWAY TOKEN</strong> — the claims below are decoded by the demo API from the gateway token it cached
        after an RFC 8693 exchange (display only: this page does not verify the signature). The tester sends the token
        you choose to the demo API's resource server.
      </>
    ) : (
      <>
        <strong>NO GATEWAY TOKEN YET</strong> — the demo API has not cached an exchanged gateway token for this session, so
        there are no claims to show. The tester can still check a token you pick or paste.
      </>
    );
  }
  return (
    <>
      <strong>REAL SESSION TOKENS, DEMO BANK DATA</strong> — the claims below are decoded by the demo API from your
      signed-in session's access and ID tokens (display only: this page does not verify the signature). The balances and
      transactions come from the demo bank's data store, not a real bank. The tester sends the token you choose to the
      demo API's resource server.
    </>
  );
}
