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
// P7 chips, P9 buttons. The pattern primitives are shared (components/pingUi,
// styles/ping-ui.css, docs/ping-ui-primitives.md); this page keeps only its own
// stage list and tables in PrivilegeSaasAccessPage.css. The standalone shell bar
// is not added (the app has its own).

import { useMemo, useState } from 'react';
import PrivilegeLiveCheck from '../components/privilege/PrivilegeLiveCheck';
import PageHeader from '../components/common/PageHeader';
import {
  PingPage, SimBanner, PageFrame, Section, CardGrid, Card, StatusChip, KvList,
} from '../components/pingUi';
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
    <PingPage className="psa-page">
      <SimBanner data-testid="psa-banner">
        <strong>SIMULATED WALKTHROUGH</strong> — the request, approval, grant and expiry stages on this page
        are a deterministic simulation. Nothing is granted on GitHub, GitLab, Salesforce, Snowflake,
        Databricks or Google Workspace. The one live call is the gateway check at the bottom: it goes through
        this machine's BFF to the Privilege AI Gateway, but the tool it calls is a fictional sample, not a real entitlement ledger.
      </SimBanner>
      <PageHeader
        eyebrow="Ping products · Privilege · Platform Update Nov 2026 (new)"
        title="SaaS Access Management"
        summary="Just-in-time, time-bound access to the systems engineers actually use: requestable, approved, time-bound, automatically removed — with a receipt for every grant and nightly drift detection."
      />
      <PageFrame>
        <Section
          id="psa-req"
          kicker="1 · Request and receipt"
          title="One JIT model, humans and agents alike"
          lede="An engineer asking for a warehouse role and an agent asking for a peer's capability are the same decision, recorded the same way, in one audit trail."
        >
          <CardGrid>
            <Card title="Request">
              <label className="pu-label" htmlFor="psa-scenario">Scenario</label>
              <select
                id="psa-scenario"
                className="pu-select"
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
              <KvList
                items={[
                  { label: 'Platform', value: platform.name },
                  { label: 'TTL', value: `${scenario.ttlHours}h` },
                  { label: 'Approvers', value: scenario.approvers.join(', ') },
                ]}
              />
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
                        <StatusChip tone={state === 'done' ? 'ok' : state === 'current' ? 'info' : 'neutral'}>
                          {state === 'done' ? 'Done' : state === 'current' ? 'Current' : 'Upcoming'}
                        </StatusChip>
                      </span>
                      <span className="psa-stage__note">{s.note}</span>
                    </li>
                  );
                })}
              </ol>
              <div className="pu-actions">
                <button
                  type="button"
                  className="pu-btn pu-btn--primary"
                  onClick={advance}
                  aria-disabled={stageIdx >= SAAS_STAGES.length - 1 ? 'true' : undefined}
                  data-testid="psa-advance"
                >
                  {stageIdx === 0 ? 'Submit for approval' : stageIdx === 1 ? 'Record approval' : stageIdx === 2 ? 'Let the TTL elapse' : 'Complete'}
                </button>
                <button type="button" className="pu-btn" onClick={reset} data-testid="psa-reset">Reset</button>
              </div>
            </Card>

            <Card title="Receipt" tone="neutral">
              {receipt ? (
                <div data-testid="psa-receipt">
                  <p className="pu-status-line"><StatusChip tone="info">Sample receipt</StatusChip> Sample grant {receipt.ref}</p>
                  <KvList
                    items={[
                      { label: 'Sample grant ref', value: receipt.ref, mono: true },
                      { label: 'Grant', value: receipt.grant },
                      { label: 'Platform', value: receipt.platform },
                      { label: 'Would expire', value: receipt.expires, mono: true },
                    ]}
                  />
                  <p className="pu-note">
                    Sample receipt: nothing was granted and no grant exists, so there is nothing to remove. In the
                    product, the reaper removes a grant when its window closes, even if the workflow that made it
                    is long finished.
                  </p>
                </div>
              ) : (
                <div>
                  <p className="pu-status-line"><StatusChip tone="neutral">No sample yet</StatusChip></p>
                  <p className="pu-note pu-empty">Advance the request to the grant stage to see the sample receipt this cycle would produce.</p>
                </div>
              )}
            </Card>
          </CardGrid>
        </Section>

        <Section id="psa-platforms" kicker="2 · Connected platforms" title="Platform matrix">
          <Card tone="neutral">
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
          </Card>
        </Section>

        <Section
          id="psa-drift"
          kicker="3 · Drift detection"
          title="Access granted outside Privilege is surfaced"
          lede="Every grant is recorded and reconciled against the platform nightly, so access granted outside Privilege is surfaced instead of silently accumulating."
        >
          <Card tone="neutral">
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
            <p className="pu-note">
              Walkthrough only: this page does not grant anything on GitHub, Snowflake or any connected platform.
            </p>
          </Card>
        </Section>

        <Section id="psa-live" kicker="4 · Live check" title="Call a tool through the gateway (sample data)">
          <Card tone="live">
            <p className="pu-status-line"><StatusChip tone="info">Live call</StatusChip> The allow or deny decision below comes from the gateway. The tool behind it is a fictional sample, so any record it returns is made-up data.</p>
            <PrivilegeLiveCheck
              tool="get_access_grants"
              args={{ resource: 'payments-api' }}
              label="Call a sample tool through the gateway"
              buttonClassName="pu-btn"
              statusChip
            />
          </Card>
        </Section>
      </PageFrame>
    </PingPage>
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
