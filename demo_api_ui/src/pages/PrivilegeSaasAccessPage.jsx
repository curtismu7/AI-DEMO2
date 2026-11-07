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
//
// Layout follows the standalone Ping UI Standard (AI-DEMO-Standalone/shared/
// STANDALONE-UI-PATTERNS.md): P2 banner first, P3 frame, P4 cards, P5 kv,
// P7 chips, P9 buttons. The pattern classes are re-created under .psa-page with
// this app's tokens; the standalone shell bar is not added (the app has its own).

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

/** Status chip: a leading dot plus the word. Never colour alone. */
function Chip({ tone, children }) {
  return (
    <span className={`psa-chip psa-chip--${tone}`}>
      <span className="psa-chip__dot" aria-hidden="true" />
      {children}
    </span>
  );
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
      <div className="psa-banner-wrap">
        <div className="psa-banner" role="note" data-testid="psa-banner">
          <strong>SIMULATED WALKTHROUGH</strong> — the request, approval, grant and expiry stages on this page
          are a deterministic simulation. Nothing is granted on GitHub, GitLab, Salesforce, Snowflake,
          Databricks or Google Workspace. The one real call is the ledger check at the bottom: it goes through
          this machine's BFF to the Privilege AI Gateway.
        </div>
      </div>
      <PageHeader
        eyebrow="Ping products · Privilege · Platform Update Nov 2026 (new)"
        title="SaaS Access Management"
        summary="Just-in-time, time-bound access to the systems engineers actually use: requestable, approved, time-bound, automatically removed — with a receipt for every grant and nightly drift detection."
      />
      <div className="psa-body">
        <section aria-labelledby="psa-req">
          <p className="psa-kicker">1 · Request and receipt</p>
          <h2 id="psa-req" className="psa-h2">One JIT model, humans and agents alike</h2>
          <p className="psa-lede">
            An engineer asking for a warehouse role and an agent asking for a peer's capability are the same
            decision, recorded the same way, in one audit trail.
          </p>
          <div className="psa-card-grid">
            <div className="psa-card">
              <h3 className="psa-h3">Request</h3>
              <label className="psa-label" htmlFor="psa-scenario">Scenario</label>
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
              <dl className="psa-kv">
                <dt>Platform</dt><dd>{platform.name}</dd>
                <dt>TTL</dt><dd>{scenario.ttlHours}h</dd>
                <dt>Approvers</dt><dd>{scenario.approvers.join(', ')}</dd>
              </dl>
              <ol className="psa-stages" data-testid="psa-stages">
                {SAAS_STAGES.map((s, i) => {
                  const state = i < stageIdx ? 'done' : i === stageIdx ? 'current' : 'upcoming';
                  return (
                    <li
                      key={s.id}
                      className={`psa-stage psa-stage--${state}`}
                      aria-current={i === stageIdx ? 'step' : undefined}
                    >
                      <span className="psa-stage__head">
                        <strong>{s.label}</strong>
                        <Chip tone={state === 'done' ? 'ok' : state === 'current' ? 'info' : 'neutral'}>
                          {state === 'done' ? 'Done' : state === 'current' ? 'Current' : 'Upcoming'}
                        </Chip>
                      </span>
                      <span className="psa-stage__note">{s.note}</span>
                    </li>
                  );
                })}
              </ol>
              <div className="psa-actions">
                <button
                  type="button"
                  className="psa-btn psa-btn--primary"
                  onClick={advance}
                  disabled={stageIdx >= SAAS_STAGES.length - 1}
                  data-testid="psa-advance"
                >
                  {stageIdx === 0 ? 'Submit for approval' : stageIdx === 1 ? 'Record approval' : stageIdx === 2 ? 'Let the TTL elapse' : 'Complete'}
                </button>
                <button type="button" className="psa-btn" onClick={reset} data-testid="psa-reset">Reset</button>
              </div>
            </div>

            <div className={`psa-card ${receipt ? 'psa-card--ok' : 'psa-card--neutral'}`}>
              <h3 className="psa-h3">Receipt</h3>
              {receipt ? (
                <div data-testid="psa-receipt">
                  <p className="psa-status-line"><Chip tone="ok">Issued</Chip> Grant {receipt.ref}</p>
                  <dl className="psa-kv">
                    <dt>Grant ref</dt><dd className="psa-mono">{receipt.ref}</dd>
                    <dt>Grant</dt><dd>{receipt.grant}</dd>
                    <dt>Platform</dt><dd>{receipt.platform}</dd>
                    <dt>Expires</dt><dd className="psa-mono">{receipt.expires}</dd>
                  </dl>
                  <p className="psa-note">
                    The reaper removes the grant when the window closes, even if the workflow that made it is long finished.
                  </p>
                </div>
              ) : (
                <div>
                  <p className="psa-status-line"><Chip tone="neutral">Not issued</Chip></p>
                  <p className="psa-note psa-empty">Advance the request to the grant stage to see the receipt this cycle would issue.</p>
                </div>
              )}
            </div>
          </div>
        </section>

        <section aria-labelledby="psa-platforms">
          <p className="psa-kicker">2 · Connected platforms</p>
          <h2 id="psa-platforms" className="psa-h2">Platform matrix</h2>
          <div className="psa-card psa-card--neutral">
            <div className="psa-table-wrap">
              <table className="psa-table" data-testid="psa-matrix">
                <thead><tr><th scope="col">Platform</th><th scope="col">Grantable</th><th scope="col">Connection</th></tr></thead>
                <tbody>
                  {SAAS_PLATFORMS.map((p) => (
                    <tr key={p.id}>
                      <td data-label="Platform">{p.name}</td>
                      <td data-label="Grantable">{p.grants}</td>
                      <td data-label="Connection">{p.connection}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section aria-labelledby="psa-drift">
          <p className="psa-kicker">3 · Drift detection</p>
          <h2 id="psa-drift" className="psa-h2">Access granted outside Privilege is surfaced</h2>
          <p className="psa-lede">
            Every grant is recorded and reconciled against the platform nightly, so access granted outside
            Privilege is surfaced instead of silently accumulating.
          </p>
          <div className="psa-card psa-card--neutral">
            <div className="psa-table-wrap">
              <table className="psa-table" data-testid="psa-drift-rows">
                <thead><tr><th scope="col">Grant</th><th scope="col">Subject</th><th scope="col">Source</th><th scope="col">Detected by</th></tr></thead>
                <tbody>
                  {SAAS_DRIFT_ROWS.map((r) => (
                    <tr key={r.grant + r.subject}>
                      <td data-label="Grant">{r.grant}</td>
                      <td data-label="Subject">{r.subject}</td>
                      <td data-label="Source">{r.source}</td>
                      <td data-label="Detected by">{r.detected}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="psa-note">
              Walkthrough only: this page does not grant anything on GitHub, Snowflake or any connected platform.
            </p>
          </div>
        </section>

        <section aria-labelledby="psa-live">
          <p className="psa-kicker">4 · Live check</p>
          <h2 id="psa-live" className="psa-h2">Read the entitlement ledger for real</h2>
          <div className="psa-card psa-card--live">
            <p className="psa-status-line"><Chip tone="info">Live call</Chip> Not simulated: the verdict below comes from the gateway.</p>
            <PrivilegeLiveCheck
              tool="get_access_grants"
              args={{ resource: 'payments-api' }}
              label="Read the live entitlement ledger through Privilege"
              buttonClassName="psa-btn"
              statusChip
            />
          </div>
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
