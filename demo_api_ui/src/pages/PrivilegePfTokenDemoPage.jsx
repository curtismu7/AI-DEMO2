// /privilege-pf-token: a PingFederate-issued token, accepted by the Privilege gateway.
// The BFF mints the token and calls the real pftoken door; this page shows the token's claims (never the token)
// and exactly what the gateway answered, with a garbage-token control next to it.
import { useCallback, useEffect, useState } from 'react';
import EmbeddedFlowDiagram from '../components/EmbeddedFlowDiagram';
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

export default function PrivilegePfTokenDemoPage() {
  const [state, setState] = useState(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [problem, setProblem] = useState('');

  useEffect(() => {
    getState().then(({ data }) => setState(data)).catch(() => setState({ configured: false }));
  }, []);

  const run = useCallback(async () => {
    setRunning(true);
    setProblem('');
    try {
      const { status, data } = await runDemo();
      if (status === 401) setProblem('Sign in to the demo app to run this.');
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
          An agent presents a <strong>PingFederate-issued JWT</strong> to a Privilege MCP door. The gateway verifies it against a
          non-human identity, maps it to the agent&apos;s key, applies the key&apos;s grant, and returns the tools. Nothing is mocked.
        </p>
      </header>

      <section className="ppt-card" aria-labelledby="ppt-run-h">
        <h2 id="ppt-run-h">1. Run it</h2>
        {state && (
          <p className="ppt-muted" data-testid="ppt-target">
            Client <code>{state.clientId}</code> at <code>{state.issuer}</code>, door <code>{state.doorUrl}</code>
          </p>
        )}
        {state && !state.configured && (
          <p className="ppt-warn" data-testid="ppt-not-configured">
            Not configured: the PingFederate client secret is not set on the api-server, so the run button is off.
          </p>
        )}
        <button type="button" className="ppt-btn" onClick={run} disabled={running || !state?.configured} data-testid="ppt-run">
          {running ? 'Running…' : 'Mint a PingFederate token and call the door'}
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
              </>
            )}
            <p className="ppt-muted">Run at {result.at}.</p>
          </div>
        )}
      </section>

      <section className="ppt-card" aria-labelledby="ppt-setup-h">
        <h2 id="ppt-setup-h">2. What has to be true</h2>
        <p className="ppt-muted">Every row at the same time. Verified 2026-10-26.</p>
        <table className="ppt-table" data-testid="ppt-setup">
          <thead><tr><th>Where</th><th>Setting</th><th>Value</th></tr></thead>
          <tbody>{WORKING_SETUP.map((r) => <tr key={`${r.layer}-${r.setting}`}><td>{r.layer}</td><td>{r.setting}</td><td>{r.value}</td></tr>)}</tbody>
        </table>
      </section>

      <section className="ppt-card" aria-labelledby="ppt-fail-h">
        <h2 id="ppt-fail-h">3. When it does not work</h2>
        <p className="ppt-muted">The client only sees 401 or 403. The gateway log says which layer refused it.</p>
        <table className="ppt-table" data-testid="ppt-failures">
          <thead><tr><th>You see</th><th>Gateway log</th><th>Fix</th></tr></thead>
          <tbody>{FAILURES.map((f) => <tr key={f.log}><td>{f.seen}</td><td><code>{f.log}</code></td><td>{f.fix}</td></tr>)}</tbody>
        </table>
      </section>

      <section aria-labelledby="ppt-flow-h">
        <h2 id="ppt-flow-h">4. The path</h2>
        <EmbeddedFlowDiagram
          config={PF_TOKEN_DIAGRAM}
          title="PingFederate token through the Privilege gateway"
          ariaLabel="PingFederate token through the Privilege gateway"
          testId="ppt-diagram"
          pingStyle
        />
      </section>

      <p className="ppt-muted">
        Full setup, screenshots and troubleshooting: <a href={DOC_URL} target="_blank" rel="noreferrer">PF-TOKEN-EXCHANGE-PASS-AGENT-TOKEN.md</a>.
      </p>
    </div>
  );
}
