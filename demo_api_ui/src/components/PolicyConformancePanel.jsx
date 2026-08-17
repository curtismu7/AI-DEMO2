import { useCallback, useState } from 'react';
import apiClient from '../services/apiClient';
import './PolicyConformancePanel.css';

/**
 * Policy conformance — run every comparable chip use case and show whether the
 * control that fired is the control the catalog CLAIMS fires.
 *
 * This is deliberately NOT the existing per-card verdict. That one compares the
 * token-chain evidence a run produced, and DENY / STEP_UP / HITL all produce the
 * same chain shape — so four different controls can each render green while three
 * enforce the wrong one. `expectedOutcome` is what tells them apart, and until
 * now nothing compared it to what actually happened.
 *
 * The "all four the same" case gets its own callout because it is the failure
 * that reads as success: a uniform column of identical outcomes looks tidy.
 */
export default function PolicyConformancePanel({ vertical }) {
  const [state, setState] = useState('idle'); // idle | running | done | error
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);

  const run = useCallback(async () => {
    setState('running');
    setError(null);
    setRows([]);
    setSummary(null);
    try {
      // Runs every comparable use case sequentially against the live gateway
      // (12+ real agent turns for banking alone) — apiClient's global 10s
      // timeout was firing before the batch could finish, so this call never
      // completed. Override it for this one slow, deliberately-sequential call.
      const res = await apiClient.post('/api/use-cases/conformance/run', { vertical }, { timeout: 120000 });
      const data = res?.data || {};
      if (!data.success) throw new Error(data.error || 'run failed');
      setRows(data.rows || []);
      setSummary(data.summary || null);
      setState('done');
    } catch (e) {
      setError(e?.response?.data?.error || e.message || 'run failed');
      setState('error');
    }
  }, [vertical]);

  return (
    <section className="pcp" aria-label="Policy conformance">
      <header className="pcp__head">
        <div>
          <h3 className="pcp__title">Policy conformance</h3>
          <p className="pcp__sub">
            Runs every chip use case and compares the control that actually fired against the
            one the catalog declares. The per-card verdict checks the token chain; this checks
            the outcome.
          </p>
        </div>
        <button type="button" className="pcp__run" onClick={run} disabled={state === 'running'}>
          {state === 'running' ? 'Running…' : 'Run all policies'}
        </button>
      </header>

      {state === 'running' && (
        <p className="pcp__note">
          Running each use case in turn against the live gateway — this takes a moment. They are
          sequential on purpose: run concurrently, and one chip&apos;s consent challenge lands in
          the middle of the next.
        </p>
      )}

      {state === 'error' && <p className="pcp__error">❌ {error}</p>}

      {summary && (
        <p className={summary.failed ? 'pcp__summary pcp__summary--bad' : 'pcp__summary pcp__summary--ok'}>
          {summary.failed
            ? `❌ ${summary.failed} of ${summary.total} enforced a different control than declared.`
            : `✅ All ${summary.total} enforced the control they declare.`}
          {summary.collapsed && (
            <span className="pcp__collapsed">
              {' '}⚠️ Every use case returned <code>{summary.collapsed}</code> — distinct controls
              are demoing as one.
            </span>
          )}
        </p>
      )}

      {rows.length > 0 && (
        <div className="pcp__tablewrap">
          <table className="pcp__table">
            <thead>
              <tr>
                <th scope="col">Use case</th>
                <th scope="col">Declared</th>
                <th scope="col">Actual</th>
                <th scope="col">Reply</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={r.ok ? 'pcp__row' : 'pcp__row pcp__row--bad'}>
                  <th scope="row">
                    <span className="pcp__uc">{r.id}</span> {r.title}
                  </th>
                  <td><code>{r.expected}</code></td>
                  <td>
                    <code>{r.actual}</code> {r.ok ? '✅' : '❌'}
                  </td>
                  <td className="pcp__reply" title={r.error || r.reply}>
                    {r.error ? `error: ${r.error}` : r.reply}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
