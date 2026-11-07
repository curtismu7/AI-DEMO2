// /privilege-saas-access — SaaS Access Management (Platform Update, page 21).
//
// Just-in-time, time-bound access to GitHub, GitLab, Salesforce, Snowflake,
// Databricks and Google Workspace: request, approve, expire and revoke, with a
// receipt per grant and a reaper that removes access on expiry. The same JIT
// model the platform applies to agent access — only the subject differs.
//
// Honesty: the request/approve/expire walkthrough is a deterministic state
// machine in this page, not a live grant against GitHub or Snowflake. The
// connected-platform table restates the platform matrix from the update.

import { useMemo, useState } from 'react';
import PrivilegeLiveCheck from '../components/privilege/PrivilegeLiveCheck';
import PageHeader from '../components/common/PageHeader';
import {
  SAAS_PLATFORMS,
  SAAS_REQUEST_SCENARIOS,
  SAAS_STAGES,
  SAAS_DRIFT_ROWS,
} from '../config/privilegePlatformUpdateDemos';
import './PrivilegeSaasAccessPage.css';

const STAGE_INDEX = Object.fromEntries(SAAS_STAGES.map((s, i) => [s.id, i]));

function fmtExpiry(hours) {
  const d = new Date(Date.now() + hours * 3600 * 1000);
  return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

export default function PrivilegeSaasAccessPage() {
  const [scenarioKey, setScenarioKey] = useState(SAAS_REQUEST_SCENARIOS[0].key);
  const [stage, setStage] = useState('requested');
  const [receipt, setReceipt] = useState(null);

  const scenario = useMemo(
    () => SAAS_REQUEST_SCENARIOS.find((s) => s.key === scenarioKey) ?? SAAS_REQUEST_SCENARIOS[0],
    [scenarioKey],
  );
  const platform = SAAS_PLATFORMS.find((p) => p.id === scenario.platform);
  const stageIdx = STAGE_INDEX[stage];

  const pickScenario = (key) => {
    setScenarioKey(key);
    setStage('requested');
    setReceipt(null);
  };

  const advance = () => {
    if (stageIdx >= SAAS_STAGES.length - 1) return;
    const next = SAAS_STAGES[stageIdx + 1];
    setStage(next.id);
    if (next.id === 'granted') {
      setReceipt({
        ref: `grt-${Math.abs(hash(scenario.key)) % 0xfffff}`.padEnd(10, '0').slice(0, 10),
        expires: fmtExpiry(scenario.ttlHours),
        grant: scenario.grant,
        platform: platform.name,
      });
    }
  };

  const reset = () => {
    setStage('requested');
    setReceipt(null);
  };

  return (
    <div className="psa-page">
      <PageHeader
        eyebrow="Ping products · Privilege · Platform Update Nov 2026 (new)"
        title="SaaS Access Management"
        summary="Just-in-time, time-bound access to the systems engineers actually use: requestable, approved, time-bound, automatically removed — with a receipt for every grant and nightly drift detection."
      />
      <div className="psa-body">
        <section className="psa-panel" aria-labelledby="psa-req">
          <h2 id="psa-req">One JIT model, humans and agents alike</h2>
          <p>
            An engineer asking for a warehouse role and an agent asking for a peer's capability are the same
            decision, recorded the same way, in one audit trail.
          </p>
          <div className="psa-grid">
            <div className="psa-col">
              <label className="psa-label" htmlFor="psa-scenario">Request</label>
              <select
                id="psa-scenario"
                className="psa-select"
                value={scenarioKey}
                onChange={(e) => pickScenario(e.target.value)}
                data-testid="psa-scenario"
              >
                {SAAS_REQUEST_SCENARIOS.map((s) => {
                  const p = SAAS_PLATFORMS.find((pl) => pl.id === s.platform);
                  return <option key={s.key} value={s.key}>{p.name} — {s.grant}</option>;
                })}
              </select>
              <p className="psa-justification">{scenario.justification}</p>
              <p className="psa-muted">
                TTL {scenario.ttlHours}h · approvers: {scenario.approvers.join(', ')}
              </p>
              <ol className="psa-stages" data-testid="psa-stages">
                {SAAS_STAGES.map((s, i) => (
                  <li
                    key={s.id}
                    className={`psa-stage ${i < stageIdx ? 'psa-stage--done' : i === stageIdx ? 'psa-stage--current' : ''}`.trim()}
                    aria-current={i === stageIdx ? 'step' : undefined}
                  >
                    <strong>{s.label}</strong>
                    <span>{s.note}</span>
                  </li>
                ))}
              </ol>
              <div className="psa-actions">
                <button type="button" className="btn btn-primary" onClick={advance} disabled={stageIdx >= SAAS_STAGES.length - 1} data-testid="psa-advance">
                  {stageIdx === 0 ? 'Submit for approval' : stageIdx === 1 ? 'Record approval' : stageIdx === 2 ? 'Let the TTL elapse' : 'Complete'}
                </button>
                <button type="button" className="btn btn-secondary" onClick={reset} data-testid="psa-reset">Reset</button>
              </div>
            </div>
            <div className="psa-col">
              <span className="psa-label">Receipt</span>
              {receipt ? (
                <div className="psa-receipt" data-testid="psa-receipt">
                  <p><strong>Grant {receipt.ref}</strong></p>
                  <p>{receipt.grant} on {receipt.platform}</p>
                  <p className="psa-muted">Expires {receipt.expires} — the reaper removes it when the window closes, even if the workflow that made the grant is long finished.</p>
                </div>
              ) : (
                <p className="psa-muted psa-empty">Advance the request to the grant stage to see the receipt this cycle would issue.</p>
              )}
              <h3 className="psa-h3">Platform matrix</h3>
              <div className="psa-table-wrap">
              <table className="psa-table" data-testid="psa-matrix">
                <thead><tr><th scope="col">Platform</th><th scope="col">Grantable</th><th scope="col">Connection</th></tr></thead>
                <tbody>
                  {SAAS_PLATFORMS.map((p) => (
                    <tr key={p.id}><td>{p.name}</td><td>{p.grants}</td><td>{p.connection}</td></tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          </div>
        </section>

        <section className="psa-panel" aria-labelledby="psa-drift">
          <h2 id="psa-drift">Drift detection</h2>
          <p>
            Every grant is recorded and reconciled against the platform nightly, so access granted outside
            Privilege is surfaced instead of silently accumulating.
          </p>
          <div className="psa-table-wrap">
          <table className="psa-table" data-testid="psa-drift-rows">
            <thead><tr><th scope="col">Grant</th><th scope="col">Subject</th><th scope="col">Source</th><th scope="col">Detected by</th></tr></thead>
            <tbody>
              {SAAS_DRIFT_ROWS.map((r) => (
                <tr key={r.grant + r.subject}><td>{r.grant}</td><td>{r.subject}</td><td>{r.source}</td><td>{r.detected}</td></tr>
              ))}
            </tbody>
          </table>
          </div>
          <p className="psa-muted">
            Walkthrough only: this page does not grant anything on GitHub, Snowflake or any connected platform.
          </p>
          <PrivilegeLiveCheck
            tool="get_access_grants"
            args={{ resource: 'payments-api' }}
            label="Read the live entitlement ledger through Privilege"
          />
        </section>
      </div>
    </div>
  );
}

/** Deterministic small hash so the receipt ref is stable per scenario. */
function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i += 1) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  return h;
}
