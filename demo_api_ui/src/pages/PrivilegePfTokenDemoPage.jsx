// /privilege-pf-token: a PingFederate-issued token, accepted by the Privilege gateway.
// The BFF mints the token and calls the real pftoken P1 Privilege Agent App; this page shows the token's claims (never the token)
// and exactly what the gateway answered, with a garbage-token control next to it.
//
// Layout follows the standalone Ping UI Standard (AI-DEMO-Standalone/shared/STANDALONE-UI-PATTERNS.md) through the shared
// primitives (components/pingUi, docs/ping-ui-primitives.md): P2 banner first, P3 frame, P4 cards, P5 kv, P7 chips with a
// word. Skipped: P6 (inspector layout: this is not a tester with a tree and a form) and P8 (the path diagram is the
// shared EmbeddedFlowDiagram, which keeps its own boxes and its own Simulate/Reset controls).
//
// P9, one primary per view: the one primary is the Run button, in every state (signed out, not configured, idle, running,
// result, error). When it cannot act it is disabled (off while signed out or not configured, aria-disabled while a run is
// in flight so keyboard focus stays on it); it never moves or swaps for another control.
// Nothing else on this page is a page-owned primary. Two shared controls are outside it: the sign-in strip's own CTA
// (SignInPrompt, shown only when signed out) and the diagram's own step controls.
import { useCallback, useEffect, useState } from 'react';
import EmbeddedFlowDiagram from '../components/EmbeddedFlowDiagram';
import PageHeader from '../components/common/PageHeader';
import SignInPrompt from '../components/SignInPrompt';
import {
  PingPage, SimBanner, PageFrame, Section, CardGrid, Card, StatusChip, KvList,
} from '../components/pingUi';
import { CEDAR_POLICY, DOC_URL, FAILURES, PF_TOKEN_DIAGRAM, PRIVILEGE_CAN, PRIVILEGE_CANNOT, VERDICTS, WORKING_SETUP } from '../config/privilegePfTokenDemo';
import { getState, runDemo } from '../services/privilegePfTokenDemoService';
import './PrivilegePfTokenDemoPage.css';

// VERDICTS name their tone 'bad'; the primitives call it 'danger'. The verdict word is always shown (P7).
const TONE = { ok: 'ok', warn: 'warn', bad: 'danger' };
const verdictOf = (key) => VERDICTS[key] || VERDICTS.error;

// Every claim, two places: what PingFederate put in the token, and what the backend behind the gateway verified.
// An older resource server reports only named fields; map those back to their claims.
const NAMED_FIELDS = { iss: 'issuer', sub: 'subject', act: 'actor', aud: 'audience', client_id: 'clientId', scope: 'scope' };
function receivedClaims(got) {
  if (got.claims) return got.claims;
  return Object.fromEntries(Object.entries(NAMED_FIELDS).filter(([, f]) => f in got).map(([c, f]) => [c, got[f]]));
}
const show = (v) => (v == null ? '—' : typeof v === 'string' ? v : JSON.stringify(v));

// The working setup, one card per layer (PingFederate, the Privilege identity, the key, the grant ...).
const SETUP_LAYERS = WORKING_SETUP.reduce((acc, r) => {
  const found = acc.find((l) => l.layer === r.layer);
  if (found) found.items.push({ label: r.setting, value: r.value });
  else acc.push({ layer: r.layer, items: [{ label: r.setting, value: r.value }] });
  return acc;
}, []);

// A /run body is usable when PingFederate refused to mint (mint.error, shown on its own) or when both gateway answers are there.
const hasAnswers = (data) => Boolean(data?.mint?.error || (data?.pfToken && data?.garbage));

// A recorded "Status" is a measurement; anything else is a gap and gets the warning tone.
const measured = (status) => /^measured/i.test(status);

export default function PrivilegePfTokenDemoPage() {
  const [state, setState] = useState(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [problem, setProblem] = useState('');

  useEffect(() => {
    // 401 here is the hosted-access wall (no session), not a missing secret.
    getState()
      .then(({ status, data }) => setState(status === 401 ? { signedOut: true } : data))
      .catch(() => setState({ configured: false }));
  }, []);

  const run = useCallback(async () => {
    if (running) return; // aria-disabled while running, not disabled: a disabled button drops keyboard focus
    setRunning(true);
    setProblem('');
    try {
      const { status, data } = await runDemo();
      if (status === 401) setState((s) => ({ ...s, signedOut: true }));
      else if (status === 503) setProblem('The PingFederate client secret is not set on the api-server (PF_TOKEN_DEMO_CLIENT_SECRET).');
      else if (!hasAnswers(data)) {
        // A 500, a proxy error page or error JSON: there is nothing to show as a result, so say so in words.
        const why = typeof data?.message === 'string' ? data.message : typeof data?.error === 'string' ? data.error : '';
        setProblem(`The run did not return a result (HTTP ${status}).${why ? ` ${why}` : ''}`);
      } else setResult(data);
    } catch (e) {
      setProblem(e.message);
    } finally {
      setRunning(false);
    }
  }, [running]);

  return (
    <PingPage className="ppt-page" data-testid="ppt-page">
      <SimBanner data-testid="ppt-banner">
        <strong>LIVE RUN, RECORDED NOTES</strong> — the Run button in section 1 is not simulated: through this machine&apos;s BFF it
        mints a real PingFederate token and calls the real Privilege gateway, and what comes back is the gateway&apos;s own answer. It
        needs a signed-in session and the PingFederate client secret on the api-server; without them the button is off and nothing
        is called. Sections 2 to 4 are recorded notes (measured 2026-10-26 and 2026-10-27), not checked live, and the diagram&apos;s
        Simulate control only animates the path.
      </SimBanner>
      <PageHeader
        eyebrow="Ping products · Privilege · Federated Identity"
        title="PingFederate token on Privilege"
        summary="An agent presents a PingFederate-issued JWT to a P1 Privilege Agent App. The gateway verifies it against a Federated Identity, maps it to the agent's key, applies the key's grant, and returns the tools."
      />
      <PageFrame>
        <Section
          id="ppt-run-h"
          kicker="1 · Run it"
          title="Mint a token, call the agent app"
          lede="The token itself stays on the server: the page gets its claims and the gateway's answers."
        >
          {state?.signedOut && (
            <SignInPrompt variant="strip" message="Sign in to the demo app to mint a PingFederate token and run this." />
          )}
          <Card tone="live" data-testid="ppt-section-run">
            <p className="pu-status-line"><StatusChip tone="info">Live call</StatusChip> Not simulated: the answers below come from PingFederate and the gateway.</p>
            {state?.issuer && (
              <div data-testid="ppt-target">
                <KvList
                  items={[
                    { label: 'Client', value: state.clientId, mono: true },
                    { label: 'Issuer', value: state.issuer, mono: true },
                    { label: 'Agent App', value: state.doorUrl, mono: true },
                  ]}
                />
              </div>
            )}
            {state && !state.signedOut && !state.configured && (
              <p className="pu-status-line" data-testid="ppt-not-configured">
                <StatusChip tone="warn">Not configured</StatusChip>
                The PingFederate client secret is not set on the api-server, so the run button is off.
              </p>
            )}
            {problem && (
              <p className="pu-status-line" role="alert" data-testid="ppt-problem">
                <StatusChip tone="danger">Failed</StatusChip>
                {problem}
              </p>
            )}
            <div className="pu-actions">
              <button type="button" className="pu-btn pu-btn--primary" onClick={run} disabled={!state?.configured} aria-disabled={running || undefined} data-testid="ppt-run">
                {running ? 'Running…' : 'Mint a PingFederate token and call the agent app'}
              </button>
            </div>
          </Card>

          {result && (
            <div className="ppt-result" data-testid="ppt-result">
              {result.mint?.error ? (
                <Card tone="danger" title="PingFederate did not issue a token">
                  <p className="pu-status-line" data-testid="ppt-mint-error">
                    <StatusChip tone="danger">Failed</StatusChip>
                    PingFederate did not issue a token (HTTP {result.mint.status}): {result.mint.error}
                  </p>
                </Card>
              ) : (
                <>
                  <Card tone="ok" title="The token's claims (the token itself stays on the server)">
                    <p className="pu-status-line"><StatusChip tone="ok">Issued</StatusChip> By PingFederate, just now.</p>
                    <pre className="ppt-code" data-testid="ppt-claims" tabIndex={0} aria-label="The token's claims">{JSON.stringify(result.mint?.claims, null, 2)}</pre>
                  </Card>
                  <CardGrid>
                    <Answer title="PingFederate token" result={result.pfToken} testId="ppt-answer-pf" />
                    <Answer title="Control: a garbage token" result={result.garbage} testId="ppt-answer-garbage" />
                  </CardGrid>
                  {result.tiers?.length > 0 && <ScopeTiers tiers={result.tiers} />}
                  {result.cedar?.length > 0 && <CedarCheck cases={result.cedar} />}
                  {result.backend && <BackendReceived result={result.backend} claims={result.mint?.claims} />}
                </>
              )}
              <p className="pu-note">Run at <span className="pu-mono">{result.at}</span>.</p>
            </div>
          )}
        </Section>

        <Section id="ppt-scope-h" kicker="2 · Scope" title="What Privilege does here, and what it can't">
          <details className="ppt-fold" open data-testid="ppt-section-scope">
            <summary>Show or hide the two tables</summary>
            <Card tone="neutral" title="Privilege does">
              <div className="ppt-table-wrap">
                <table className="ppt-table" data-testid="ppt-can">
                  <thead><tr><th scope="col">What</th><th scope="col">How</th><th scope="col">Status</th></tr></thead>
                  <tbody>
                    {PRIVILEGE_CAN.map((r) => (
                      <tr key={r.what}>
                        <td data-label="What">{r.what}</td>
                        <td data-label="How">{r.how}</td>
                        <td data-label="Status"><StatusChip tone={measured(r.status) ? 'ok' : 'warn'}>{r.status}</StatusChip></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            <Card tone="neutral" title="Privilege can't (yet)">
              <div className="ppt-table-wrap">
                <table className="ppt-table" data-testid="ppt-cannot">
                  <thead><tr><th scope="col">What</th><th scope="col">Why, and what to use instead</th></tr></thead>
                  <tbody>
                    {PRIVILEGE_CANNOT.map((r) => (
                      <tr key={r.what}>
                        <td data-label="What">{r.what}</td>
                        <td data-label="Why, and what to use instead">{r.how}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </details>
        </Section>

        <Section
          id="ppt-setup-h"
          kicker="3 · Setup"
          title="What has to be true"
          lede="Every row at the same time. Recorded from the working configuration, verified 2026-10-26; this page does not re-check it."
        >
          <details className="ppt-fold" open data-testid="ppt-section-setup">
            <summary>Show or hide the settings</summary>
            <div data-testid="ppt-setup">
              <CardGrid>
                {SETUP_LAYERS.map((l) => (
                  <Card key={l.layer} tone="neutral" title={l.layer}>
                    <KvList items={l.items} />
                  </Card>
                ))}
              </CardGrid>
            </div>
          </details>
        </Section>

        <Section
          id="ppt-fail-h"
          kicker="4 · Troubleshooting"
          title="When it does not work"
          lede="The client only sees 401 or 403. The gateway log says which layer refused it."
        >
          <details className="ppt-fold" open data-testid="ppt-section-fail">
            <summary>Show or hide the failures</summary>
            <div data-testid="ppt-failures">
              <CardGrid>
                {FAILURES.map((f) => (
                  <Card key={f.log} tone="warn">
                    <p className="pu-status-line"><StatusChip tone="warn">{f.seen}</StatusChip>What you see</p>
                    <KvList
                      items={[
                        { label: 'Gateway log', value: f.log, mono: true },
                        { label: 'Fix', value: f.fix },
                      ]}
                    />
                  </Card>
                ))}
              </CardGrid>
            </div>
          </details>
        </Section>

        <Section id="ppt-flow-h" kicker="5 · The path" title="How the token travels">
          <Card tone="neutral" className="ppt-flow" data-testid="ppt-section-flow" role="region" aria-label="The path diagram and its steps" tabIndex={0}>
            <p className="pu-status-line"><StatusChip tone="neutral">Explainer</StatusChip>Simulate animates the path; it calls nothing.</p>
            <EmbeddedFlowDiagram
              config={PF_TOKEN_DIAGRAM}
              title="PingFederate token through the Privilege gateway"
              ariaLabel="PingFederate token through the Privilege gateway"
              testId="ppt-diagram"
              pingStyle
            />
          </Card>
        </Section>

        <p className="pu-note">
          Full setup, screenshots and troubleshooting: <a href={DOC_URL} target="_blank" rel="noreferrer">PF-TOKEN-EXCHANGE-PASS-AGENT-TOKEN.md</a>.
        </p>
      </PageFrame>
    </PingPage>
  );
}

// Result pieces. Declared after the page: the pattern check reads the file top to bottom and wants the banner first.
function VerdictChip({ verdict, status }) {
  const v = verdictOf(verdict);
  return (
    <>
      <StatusChip tone={TONE[v.tone]}>{v.label}</StatusChip>
      {' '}
      <span className="pu-mono">HTTP {status || 'none'}</span>
    </>
  );
}

function Answer({ title, result, testId }) {
  const v = verdictOf(result.verdict);
  return (
    <Card tone={TONE[v.tone]} title={title} data-testid={testId} data-verdict={result.verdict} role="status">
      <p className="pu-status-line"><VerdictChip verdict={result.verdict} status={result.status} /></p>
      <p className="pu-note">{v.note}</p>
      {result.tools?.length > 0 && (
        <ul className="ppt-tools" aria-label={`${result.tools.length} tools`}>
          {result.tools.map((t) => <li key={t}><code>{t}</code></li>)}
        </ul>
      )}
      {result.detail && <p className="pu-note">{result.detail}</p>}
    </Card>
  );
}

function BackendReceived({ result, claims }) {
  const got = result.received;
  const backendClaims = got ? receivedClaims(got) : {};
  const names = [...new Set([...Object.keys(claims || {}), ...Object.keys(backendClaims)])];
  if (!got) return <Answer title="What the backend received" result={result} testId="ppt-backend" />;
  const v = verdictOf(result.verdict);
  return (
    <Card tone={TONE[v.tone]} title="What the backend received" data-testid="ppt-backend" data-verdict={result.verdict} role="status">
      <p className="pu-status-line"><VerdictChip verdict={result.verdict} status={result.status} /></p>
      <p className="pu-note">
        The MCP server behind the P1 Privilege Agent App <code>pftoken-rs</code> verified the bearer itself and its <code>whoami</code> tool reports it.
        It is the agent&apos;s own PingFederate token: the gateway checked it and passed it through, it did not swap in its own.
        Every claim in the token is listed.
      </p>
      <div className="ppt-table-wrap">
        <table className="ppt-table">
          <thead><tr><th scope="col">Claim</th><th scope="col">PingFederate issued</th><th scope="col">Backend received</th><th scope="col">Same</th></tr></thead>
          <tbody>
            {names.map((claim) => {
              const same = show(claims?.[claim]) === show(backendClaims[claim]);
              return (
                <tr key={claim} data-testid={`ppt-backend-${claim}`} data-same={same}>
                  <td data-label="Claim"><code>{claim}</code></td>
                  <td data-label="PingFederate issued"><code>{show(claims?.[claim])}</code></td>
                  <td data-label="Backend received"><code>{show(backendClaims[claim])}</code></td>
                  <td data-label="Same"><StatusChip tone={same ? 'ok' : 'danger'}>{same ? 'Same' : 'Differs'}</StatusChip></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// Same agent, same app, three scopes: the grant's rules pick the tools by the scope in the token.
function ScopeTiers({ tiers }) {
  return (
    <Card tone="neutral" title="Same agent, different scope" data-testid="ppt-tiers">
      <p className="pu-note">
        Three PingFederate tokens for the same agent, differing only in <code>scope</code>, sent to the same P1 Privilege Agent App.
        The agent key&apos;s grant has one rule per tier, each requiring a scope: Privilege picks the tools from the token.
      </p>
      <div className="ppt-table-wrap">
        <table className="ppt-table">
          <thead><tr><th scope="col">Scope in the token</th><th scope="col">Privilege answered</th><th scope="col">Tools</th></tr></thead>
          <tbody>
            {tiers.map((t) => (
              <tr key={t.key} data-testid={`ppt-tier-${t.key}`} data-verdict={t.verdict}>
                <td data-label="Scope in the token"><code>{t.scope}</code></td>
                <td data-label="Privilege answered"><VerdictChip verdict={t.verdict} status={t.status} /></td>
                <td data-label="Tools">{t.tools?.length ? `${t.tools.length}: ${t.tools.join(', ')}` : t.detail || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// The same tool call, two tokens: the AI policy (Cedar) reads the token's scopes and blocks one.
function CedarCheck({ cases }) {
  return (
    <Card tone="neutral" title="Cedar blocks by scope" data-testid="ppt-cedar">
      <p className="pu-note">
        Both tokens have <code>opensearch:admin</code>, so the grant allows <code>SearchIndexTool</code>. This AI policy then
        reads the token&apos;s scopes and blocks the call unless it also has <code>opensearch:search</code>:
      </p>
      <pre className="ppt-code" tabIndex={0} aria-label="The Cedar policy">{CEDAR_POLICY}</pre>
      <div className="ppt-table-wrap">
        <table className="ppt-table">
          <thead><tr><th scope="col">Scope in the token</th><th scope="col">SearchIndexTool</th><th scope="col">What came back</th></tr></thead>
          <tbody>
            {cases.map((c) => (
              <tr key={c.key} data-testid={`ppt-cedar-${c.key}`} data-verdict={c.verdict}>
                <td data-label="Scope in the token"><code>{c.scope}</code></td>
                <td data-label="SearchIndexTool"><VerdictChip verdict={c.verdict} status={c.status} /></td>
                <td data-label="What came back">{c.message || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
