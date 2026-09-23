import { useEffect, useState } from 'react';
import { useThemeOptional } from '../context/ThemeContext';
import SignInPrompt from './SignInPrompt';
import PingIdentitySpinner from './shared/PingIdentitySpinner';
import './PromptFooPage.css';

/**
 * PromptFoo eval runner page (/promptfoo).
 *
 * Two suites — agent correctness and red-team probes — run via the BFF
 * (allow-listed, npx promptfoo) against the live /api/agent/invoke endpoint.
 * Results render as a pass/fail matrix with output snippets, matching the
 * InspectorShell three-pane philosophy: pick a suite, run it, read results.
 */

const PASS = '✅';

export default function PromptFooPage({ user }) {
  const { theme } = useThemeOptional();
  const [suites, setSuites] = useState([]);
  const [running, setRunning] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [expandedCase, setExpandedCase] = useState(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/admin/promptfoo/suites', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => { if (alive) setSuites(d.suites || []); })
      .catch((e) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, []);

  const run = async (suiteKey) => {
    setRunning(suiteKey);
    setResult(null);
    setError('');
    try {
      const res = await fetch('/api/admin/promptfoo/run', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suite: suiteKey }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`);
      setResult(data);
    } catch (e) {
      setError(e.message || 'Run failed');
    } finally {
      setRunning(null);
    }
  };

  if (!user) return <SignInPrompt />;

  return (
    <div className={`promptfoo-page ${theme ? `theme-${theme}` : ''}`} data-testid="promptfoo-page">
      <header className="promptfoo-page__header">
        <h1>PromptFoo Evaluations</h1>
        <p className="promptfoo-page__lead">
          Run eval suites against the live agent endpoint. Correctness checks assert
          real store values in reply text; red-team probes assert no secret or
          system-prompt leakage. Runs via <code>npx promptfoo</code> on the BFF —
          allow-listed configs only.
        </p>
      </header>

      <section className="promptfoo-page__suites">
        {error && <div className="promptfoo-page__error" role="alert">{error}</div>}
        {!suites.length && !error && (
          <div className="promptfoo-page__loading"><PingIdentitySpinner label="Loading PromptFoo suites…" /> Loading suites…</div>
        )}
        {suites.map((s) => (
          <div key={s.key} className="promptfoo-page__suite" data-testid={`suite-${s.key}`}>
            <div className="promptfoo-page__suite-info">
              <h2>{s.label}</h2>
              <p>{s.description}</p>
              <code className="promptfoo-page__config">{s.config}</code>
            </div>
            <div className="promptfoo-page__suite-actions">
              <button
                type="button"
                className="promptfoo-page__run-btn"
                disabled={!!running}
                onClick={() => run(s.key)}
              >
                {running === s.key ? 'Running…' : 'Run eval'}
              </button>
              {running === s.key && <PingIdentitySpinner label={`Running ${s.label} evaluation…`} />}
            </div>
          </div>
        ))}
      </section>

      {result && (
        <section className="promptfoo-page__results" data-testid="promptfoo-results">
          <header className="promptfoo-page__results-header">
            <h2>
              Results — {result.suite}{' '}
              <span
                className={`promptfoo-page__verdict ${result.exitCode === 0 ? 'pass' : 'fail'}`}
              >
                {result.exitCode === 0 ? 'PASSED' : 'FAILED'}
              </span>
            </h2>
            {result.result?.stats && (
              <p className="promptfoo-page__stats">
                {result.result.passCount} passed · {result.result.failCount} failed
              </p>
            )}
            {result.error && (
              <div className="promptfoo-page__error">
                Exit {result.exitCode}: {result.error}
                {result.stderr && <pre>{result.stderr}</pre>}
              </div>
            )}
          </header>
          {result.result?.cases?.length > 0 && (
            <table className="promptfoo-page__table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Case</th>
                  <th>Output</th>
                </tr>
              </thead>
              <tbody>
                {result.result.cases.map((c, i) => (
                  <tr
                    key={`${c.description}-${c.promptSnippet}`.slice(0, 80)}
                    className={c.success ? 'pass' : 'fail'}
                  >
                    <td>{c.success ? PASS : '❌'}</td>
                    <td>{c.description || `case ${i + 1}`}</td>
                    <td>
                      <button
                        type="button"
                        className="promptfoo-page__expand"
                        onClick={() => setExpandedCase(expandedCase === i ? null : i)}
                      >
                        {expandedCase === i ? 'Hide' : 'Show'}
                      </button>
                      {expandedCase === i && (
                        <pre className="promptfoo-page__output">{c.outputSnippet || '(empty)'}</pre>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      <section className="promptfoo-page__cli">
        <h2>Run from the CLI</h2>
        <p>For full matrices, thresholds and CI gating use the CLI directly:</p>
        <pre><code>{`cd demo_api_server
npx promptfoo@latest eval -c promptfoo/agent-eval.yaml   # correctness matrix
npx promptfoo@latest eval -c promptfoo/redteam-eval.yaml # red-team probes
npx promptfoo@latest view                                 # web UI with diffs`}</code></pre>
        <p className="promptfoo-page__hint">
          Requires the stack running on <code>localhost:3001</code> (the configs target
          the live <code>/api/agent/invoke</code> endpoint). Assertions flag the
          heuristics-catalog fallback, unknown-action errors, and leaked secrets.
        </p>
      </section>
    </div>
  );
}
