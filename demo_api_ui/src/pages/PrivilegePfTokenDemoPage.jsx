// /privilege-pf-token: a PingFederate-issued token, accepted by the Privilege gateway.
// The BFF mints the token and calls the real pftoken P1 Privilege Agent App; this page shows the token's claims (never the token)
// and exactly what the gateway answered, with a garbage-token control next to it.
import { useCallback, useEffect, useState } from 'react';
import EmbeddedFlowDiagram from '../components/EmbeddedFlowDiagram';
import SignInPrompt from '../components/SignInPrompt';
import { DOC_URL, FAILURES, PF_TOKEN_DIAGRAM, VERDICTS, WORKING_SETUP } from '../config/privilegePfTokenDemo';
import { getState, runDemo } from '../services/privilegePfTokenDemoService';
import './PrivilegePfTokenDemoPage.css';

function Answer({ title, result, testId }) {
  const v = VERDICTS[result.verdict] || VERDICTS.error;
  return (
    <div className={`ppt-answer ppt-answer--${v.tone}`} data-testid={testId} data-verdict={result.verdict} role="status">
      <h3>{title}</h3>
      <p><strong className="ppt-verdict">{v.label}</strong> <span className="ppt-muted">HTTP {result.status || 'none'}</span></p>
      <p>{v.note}</p>
      {result.tools?.length > 0 && (
        <ul className="ppt-tools" aria-label={`${result.tools.length} tools`}>
          {result.tools.map((t) => <li key={t}><code>{t}</code></li>)}
        </ul>
      )}
      {result.detail && <p className="ppt-muted">{result.detail}</p>}
    </div>
  );
}

// Every claim, two places: what PingFederate put in the token, and what the backend behind the gateway verified.
// An older resource server reports only named fields; map those back to their claims.
const NAMED_FIELDS = { iss: 'issuer', sub: 'subject', act: 'actor', aud: 'audience', client_id: 'clientId', scope: 'scope' };
function receivedClaims(got) {
  if (got.claims) return got.claims;
  return Object.fromEntries(Object.entries(NAMED_FIELDS).filter(([, f]) => f in got).map(([c, f]) => [c, got[f]]));
}
const show = (v) => (v == null ? '—' : typeof v === 'string' ? v : JSON.stringify(v));

function BackendReceived({ result, claims }) {
  const got = result.received;
  const backendClaims = got ? receivedClaims(got) : {};
  const names = [...new Set([...Object.keys(claims || {}), ...Object.keys(backendClaims)])];
  if (!got) return <Answer title="What the backend received" result={result} testId="ppt-backend" />;
  return (
    <div className="ppt-answer ppt-answer--ok" data-testid="ppt-backend" data-verdict={result.verdict} role="status">
      <h3>What the backend received</h3>
      <p>
        The MCP server behind the P1 Privilege Agent App <code>pftoken-rs</code> verified the bearer itself and its <code>whoami</code> tool reports it.
        It is the agent&apos;s own PingFederate token: the gateway checked it and passed it through, it did not swap in its own.
        Every claim in the token is listed.
      </p>
      <table className="ppt-table">
        <thead><tr><th>Claim</th><th>PingFederate issued</th><th>Backend received</th><th>Same</th></tr></thead>
        <tbody>
          {names.map((claim) => {
            const same = show(claims?.[claim]) === show(backendClaims[claim]);
            return (
              <tr key={claim} data-testid={`ppt-backend-${claim}`} data-same={same}>
                <td><code>{claim}</code></td><td><code>{show(claims?.[claim])}</code></td><td><code>{show(backendClaims[claim])}</code></td><td>{same ? 'yes' : 'no'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

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
    setRunning(true);
    setProblem('');
    try {
      const { status, data } = await runDemo();
      if (status === 401) setState((s) => ({ ...s, signedOut: true }));
      else if (status === 503) setProblem('The PingFederate client secret is not set on the api-server (PF_TOKEN_DEMO_CLIENT_SECRET).');
      else setResult(data);
    } catch (e) {
      setProblem(e.message);
    } finally {
      setRunning(false);
    }
  }, []);

  return (
    <div className="ppt-page" data-testid="ppt-page">
      <header>
        <h1>PingFederate token on Privilege</h1>
        <p className="ppt-lede">
          An agent presents a <strong>PingFederate-issued JWT</strong> to a P1 Privilege Agent App. The gateway verifies it against a
          non-human identity, maps it to the agent&apos;s key, applies the key&apos;s grant, and returns the tools. Nothing is mocked.
        </p>
      </header>

      <details className="ppt-card ppt-section" open data-testid="ppt-section-run">
        <summary><h2 id="ppt-run-h">1. Run it</h2></summary>
        {state?.signedOut && (
          <SignInPrompt variant="strip" message="Sign in to the demo app to mint a PingFederate token and run this." />
        )}
        {state?.issuer && (
          <p className="ppt-muted" data-testid="ppt-target">
            Client <code>{state.clientId}</code> at <code>{state.issuer}</code>, P1 Privilege Agent App <code>{state.doorUrl}</code>
          </p>
        )}
        {state && !state.signedOut && !state.configured && (
          <p className="ppt-warn" data-testid="ppt-not-configured">
            Not configured: the PingFederate client secret is not set on the api-server, so the run button is off.
          </p>
        )}
        <button type="button" className="ppt-btn" onClick={run} disabled={running || !state?.configured} data-testid="ppt-run">
          {running ? 'Running…' : 'Mint a PingFederate token and call the agent app'}
        </button>
        {problem && <p className="ppt-warn" role="alert" data-testid="ppt-problem">{problem}</p>}

        {result && (
          <div className="ppt-result" data-testid="ppt-result">
            {result.mint?.error ? (
              <p className="ppt-warn" data-testid="ppt-mint-error">PingFederate did not issue a token (HTTP {result.mint.status}): {result.mint.error}</p>
            ) : (
              <>
                <div className="ppt-claims">
                  <h3>The token&apos;s claims (the token itself stays on the server)</h3>
                  <pre data-testid="ppt-claims">{JSON.stringify(result.mint?.claims, null, 2)}</pre>
                </div>
                <div className="ppt-answers">
                  <Answer title="PingFederate token" result={result.pfToken} testId="ppt-answer-pf" />
                  <Answer title="Control: a garbage token" result={result.garbage} testId="ppt-answer-garbage" />
                </div>
                {result.backend && <BackendReceived result={result.backend} claims={result.mint?.claims} />}
              </>
            )}
            <p className="ppt-muted">Run at {result.at}.</p>
          </div>
        )}
      </details>

      <details className="ppt-card ppt-section" open data-testid="ppt-section-setup">
        <summary><h2 id="ppt-setup-h">2. What has to be true</h2></summary>
        <p className="ppt-muted">Every row at the same time. Verified 2026-10-26.</p>
        <table className="ppt-table" data-testid="ppt-setup">
          <thead><tr><th>Where</th><th>Setting</th><th>Value</th></tr></thead>
          <tbody>{WORKING_SETUP.map((r) => <tr key={`${r.layer}-${r.setting}`}><td>{r.layer}</td><td>{r.setting}</td><td>{r.value}</td></tr>)}</tbody>
        </table>
      </details>

      <details className="ppt-card ppt-section" open data-testid="ppt-section-fail">
        <summary><h2 id="ppt-fail-h">3. When it does not work</h2></summary>
        <p className="ppt-muted">The client only sees 401 or 403. The gateway log says which layer refused it.</p>
        <table className="ppt-table" data-testid="ppt-failures">
          <thead><tr><th>You see</th><th>Gateway log</th><th>Fix</th></tr></thead>
          <tbody>{FAILURES.map((f) => <tr key={f.log}><td>{f.seen}</td><td><code>{f.log}</code></td><td>{f.fix}</td></tr>)}</tbody>
        </table>
      </details>

      <details className="ppt-section" open data-testid="ppt-section-flow">
        <summary><h2 id="ppt-flow-h">4. The path</h2></summary>
        <EmbeddedFlowDiagram
          config={PF_TOKEN_DIAGRAM}
          title="PingFederate token through the Privilege gateway"
          ariaLabel="PingFederate token through the Privilege gateway"
          testId="ppt-diagram"
          pingStyle
        />
      </details>

      <p className="ppt-muted">
        Full setup, screenshots and troubleshooting: <a href={DOC_URL} target="_blank" rel="noreferrer">PF-TOKEN-EXCHANGE-PASS-AGENT-TOKEN.md</a>.
      </p>
    </div>
  );
}
