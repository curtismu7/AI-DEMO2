// /privilege-google-secrets — Privilege Hubs · Google Secret Manager custodian.
//
// An AI agent needs a Google credential. It never touches GCP directly: it
// presents its Privilege agent access key to the Hubs gateway, the gateway's
// policy decides allow/deny per secret, and on allow the Hubs custodian
// releases the secret (masked here — the browser never receives the full
// value). The deny path shows the same agent asking for an out-of-scope
// secret and being refused by the gateway's policy, not by our code.
//
// Honesty banner mirrors the sibling Privilege pages: the gateway round-trip
// is live (agent key → initialize → tools/call), while the Google side is
// whatever the gateway's custodian is wired to.

import { useEffect, useState } from 'react';
import PrivilegeLiveCheck from '../components/privilege/PrivilegeLiveCheck';
import PageHeader from '../components/common/PageHeader';
import {
  PingPage, SimBanner, PageFrame, Section, CardGrid, Card, StatusChip, KvList,
} from '../components/pingUi';
import { fetchGoogleSecret, fetchGoogleSecretsStatus } from '../lib/privilegeGoogleSecretsClient';
import './PrivilegeGoogleSecretsPage.css';

const SCENARIOS = [
  {
    key: 'allowed',
    label: 'In-scope secret — get_google_secret',
    tool: 'get_google_secret',
    args: { secret: 'projects/demo/secrets/google-agent-credential' },
    expectation: 'ALLOW',
    expectationTone: 'ok',
    story: 'The agent is registered in Privilege and its policy grants it this Google secret. Hubs brokers the read; the agent never sees a GCP API key.',
  },
  {
    key: 'denied',
    label: 'Out-of-scope secret — get_google_billing_secret',
    tool: 'get_google_billing_secret',
    args: { secret: 'projects/demo/secrets/google-billing-credential' },
    expectation: 'DENY',
    expectationTone: 'bad',
    story: 'Same agent, different secret. The policy does not grant billing secrets, so Hubs refuses — the refusal is the product.',
  },
];

export default function PrivilegeGoogleSecretsPage() {
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState('');
  const [scenarioKey, setScenarioKey] = useState(SCENARIOS[0].key);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    fetchGoogleSecretsStatus()
      .then((s) => { if (alive) setStatus(s); })
      .catch((e) => { if (alive) setStatusError(e.message); });
    return () => { alive = false; };
  }, []);

  const scenario = SCENARIOS.find((s) => s.key === scenarioKey) ?? SCENARIOS[0];

  const run = async (reveal = false) => {
    setRunning(true);
    setError('');
    setResult(null);
    try {
      const r = await fetchGoogleSecret(scenario.tool, scenario.args, { reveal });
      setResult(r);
    } catch (e) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  };

  const reset = () => { setResult(null); setError(''); };

  return (
    <PingPage className="pgs-page">
      <SimBanner data-testid="pgs-banner">
        <strong>PRIVILEGE HUBS DEMO</strong> — the gateway round-trip on this page is live: the BFF
        authenticates with the Privilege agent access key and performs a real MCP tools/call against the
        Hubs gateway; the gateway&apos;s own policy decides the verdict. Secret values are masked before
        they reach this page — the browser never receives a full credential.
      </SimBanner>
      <PageHeader
        eyebrow="Ping products · Privilege · Hubs · Google Secret Manager"
        title="Google secrets, brokered by Privilege"
        summary="An AI agent needs a Google credential. Instead of a static key in an env var, it asks Privilege Hubs: agent key in, policy decision, secret out — with the denial path just as real."
      />
      <PageFrame>
        <Section
          id="pgs-status"
          kicker="0 · Wiring"
          title="What is configured on this machine"
          lede="The BFF holds the agent key in its vault; the gateway URL points at the Hubs mesh frontend."
        >
          <CardGrid>
            <Card title="Connection status">
              {statusError
                ? <StatusChip tone="bad">Status unavailable — {statusError}</StatusChip>
                : (
                  <KvList
                    items={[
                      { label: 'Agent key configured', value: status ? (status.agentKeyConfigured ? 'Yes (vault)' : 'No — add PRIVILEGE_A2A_MAIN_AGENT_KEY') : '…' },
                      { label: 'Gateway', value: status?.gatewayUrl ?? '…' },
                      { label: 'Allowlisted tools', value: status?.tools?.join(', ') ?? '…' },
                    ]}
                  />
                )}
            </Card>
            <Card title="The story in one line">
              <p className="pgs-story">
                Google Secret Manager holds the credential; Privilege Hubs holds the policy.
                The agent holds neither — it holds an agent key.
              </p>
            </Card>
          </CardGrid>
        </Section>

        <Section
          id="pgs-run"
          kicker="1 · Ask for a secret"
          title="Same agent, two secrets, one policy"
          lede="Pick a scenario and fire the request. The verdict comes from the gateway — this page only renders it."
        >
          <CardGrid>
            <Card title="Request">
              <label className="pu-label" htmlFor="pgs-scenario">Scenario</label>
              <select
                id="pgs-scenario"
                className="pu-select"
                value={scenarioKey}
                onChange={(e) => { setScenarioKey(e.target.value); reset(); }}
                data-testid="pgs-scenario"
              >
                {SCENARIOS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
              <p className="pgs-story">{scenario.story}</p>
              <div className="pgs-actions">
                <button
                  type="button"
                  className="pu-button pu-button--primary"
                  onClick={() => run(false)}
                  disabled={running}
                  data-testid="pgs-run"
                >
                  {running ? 'Asking Hubs…' : `Fetch secret (expect ${scenario.expectation})`}
                </button>
                <button
                  type="button"
                  className="pu-button"
                  onClick={() => run(true)}
                  disabled={running}
                  data-testid="pgs-run-reveal"
                >
                  Fetch with masked preview
                </button>
                <button type="button" className="pu-button" onClick={reset} disabled={running}>Reset</button>
              </div>
              <p className="pgs-expect">
                Expected: <StatusChip tone={scenario.expectationTone}>{scenario.expectation}</StatusChip>
              </p>
            </Card>
            <Card title="Gateway verdict">
              {error && <p data-testid="pgs-error"><StatusChip tone="bad">{error}</StatusChip></p>}
              {result && (
                <div data-testid="pgs-result">
                  <KvList
                    items={[
                      { label: 'Decision', value: <StatusChip tone={result.decision === 'allowed' ? 'ok' : 'bad'}>{result.decision}</StatusChip> },
                      { label: 'Decided by', value: result.by },
                      { label: 'HTTP status', value: String(result.status) },
                      { label: 'Latency', value: `${result.latencyMs} ms` },
                    ]}
                  />
                  <pre className="pgs-output" data-testid="pgs-upstream">{result.upstream}</pre>
                </div>
              )}
              {!result && !error && <p className="pgs-story">No request yet.</p>}
            </Card>
          </CardGrid>
        </Section>

        <Section
          id="pgs-why"
          kicker="2 · Why this is better than a static key"
          title="The three properties the demo proves"
          lede="Each one is visible in the round-trip above, not claimed in a slide."
        >
          <CardGrid>
            <Card title="No secret in the agent">
              The agent authenticates with its agent access key. Even on allow, the browser-side demo
              only ever sees a masked preview — the full credential never leaves the Hubs/custodian side.
            </Card>
            <Card title="Policy per secret">
              Allow and deny are two rows in the same policy, evaluated by the gateway. Rotating or
              revoking Google access is a policy change, not a redeploy of the agent.
            </Card>
            <Card title="Audit trail">
              Every fetch — allowed or refused — is recorded by Hubs with the agent identity,
              the secret requested, and the decision.
            </Card>
          </CardGrid>
        </Section>

        <PrivilegeLiveCheck />
      </PageFrame>
    </PingPage>
  );
}
