// TokenSecurityTester.jsx — /token-security (McpGatewayConfig also imports it for a tab, but that host is no longer routed).
//
// A lesson: five deliberately broken tokens and the rejection each one earns. Honesty: this
// page is SIMULATED end to end. The BFF (routes/testTokenScenarios.js) mints a throw-away JWT
// with a hard-coded demo secret and returns a pre-written rejection per scenario; nothing is
// sent to an MCP server, a gateway or PingOne, and no validator runs. The only real call is the
// POST to this machine's BFF, which refuses it in production unless FF_TEST_TOKEN_SCENARIOS is set.
//
// Layout follows the standalone Ping UI Standard (AI-DEMO-Standalone/shared/STANDALONE-UI-PATTERNS.md):
// P2 banner first, P3 frame, P4 cards, P5 kv, P6 inspector (the shared InspectorShell), P7 chips,
// P9 buttons. Primitives: components/pingUi, styles/ping-ui.css, docs/ping-ui-primitives.md.
// The standalone shell bar is not added (the app has its own).
//
// The outcome is announced through ONE persistent live region (the hint line, #tst-exec-hint):
// a region that is mounted together with its text is often not announced, one whose text changes is.
// On a phone the three columns stack, so after a result lands the result pane is scrolled into view
// (focus is not moved: it stays on Execute, so the keyboard order is unchanged).
//
// Primary button per view state (exactly one, always Execute):
//   no scenario picked  Execute, aria-disabled, reason shown ("Pick a scenario first")
//   scenario picked     Execute
//   running             Execute, aria-disabled, "Executing..." (focus stays on it)
//   result or error     Execute again (re-run); Clear stays a secondary
import React, { useEffect, useRef, useState } from 'react';
import apiClient from '../services/apiClient';
import JsonHighlight from './shared/JsonHighlight';
import InspectorShell from './shared/InspectorShell';
import InspectorListItem from './shared/InspectorListItem';
import InspectorTabs from './shared/InspectorTabs';
import PageHeader from './common/PageHeader';
import {
  PingPage, SimBanner, PageFrame, Section, Card, StatusChip, KvList,
} from './pingUi';
import './TokenSecurityTester.css';

const SCENARIOS = [
  {
    id: 'wrong-scope',
    name: 'User Token (Wrong Scope)',
    description: 'User token lacks agent-required scopes'
  },
  {
    id: 'wrong-aud',
    name: 'User Token (Wrong Audience)',
    description: 'Token audience mismatch (BFF vs MCP)'
  },
  {
    id: 'missing-act',
    name: 'Missing Act Claim',
    description: 'No delegation proof (RFC 8693)'
  },
  {
    id: 'agent-token-user-endpoint',
    name: 'Agent Token on User Endpoint',
    description: 'Agent token used incorrectly'
  },
  {
    id: 'expired-token',
    name: 'Expired Token',
    description: 'Past expiration time'
  }
];

const OUTPUT_TABS = [
  { key: 'result', label: 'Result' },
  { key: 'teaching', label: 'Teaching' },
  { key: 'token', label: 'Token Details' },
  { key: 'raw', label: 'Request/Response' },
];

export default function TokenSecurityTester() {
  const [selectedScenario, setSelectedScenario] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [outputTab, setOutputTab] = useState('result');
  // Bumped on every run, pick and clear: a reply that arrives after the person moved on belongs to
  // a scenario that is no longer shown, so it is dropped instead of leaking into the next one.
  const runRef = useRef(0);

  const blocked = !selectedScenario || loading;

  const handleExecute = async () => {
    if (blocked) return;
    const runId = ++runRef.current;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await apiClient.post(
        `/api/test/token-validation/scenario/${selectedScenario.id}`
      );
      if (runId !== runRef.current) return;
      setResult(response.data);
      setOutputTab('result');
    } catch (err) {
      if (runId !== runRef.current) return;
      console.error('[TokenSecurityTester] Error:', err);
      setError(
        err.response?.data?.message ||
        err.response?.data?.error ||
        err.message ||
        'Failed to run test scenario'
      );
    } finally {
      if (runId === runRef.current) setLoading(false);
    }
  };

  const handleClear = () => {
    runRef.current += 1;
    setLoading(false);
    setResult(null);
    setError(null);
    setSelectedScenario(null);
    setOutputTab('result');
  };

  const selectScenario = (scenario) => {
    runRef.current += 1;
    setLoading(false);
    setSelectedScenario(scenario);
    setResult(null);
    setError(null);
    setOutputTab('result');
  };

  return (
    <PingPage className="tst-page">
      <SimBanner data-testid="tst-banner">
        <strong>SIMULATED LESSON</strong> — the BFF mints a throw-away test token (demo secret, not by PingOne)
        and replies with a pre-written rejection per scenario. No MCP server or gateway is called and no real
        validator runs.
      </SimBanner>
      <PageHeader
        eyebrow="Ping products · Utilities"
        title="Token Security Tester"
        summary="Five tokens that break one rule each, and the rejection a resource server gives for each rule."
      />
      <PageFrame>
        <Section
          id="tst-run"
          kicker="1 · Break a token on purpose"
          title="Pick a failure, run it, read why it was refused"
        >
          <InspectorShell
            title="Token validation scenarios"
            statusText={`Simulated lesson — ${SCENARIOS.length} scenarios`}
            fullHeight={false}
            left={<ScenarioList selectedId={selectedScenario?.id} onSelect={selectScenario} />}
            middle={
              <ScenarioForm
                scenario={selectedScenario}
                loading={loading}
                blocked={blocked}
                error={error}
                result={result}
                onExecute={handleExecute}
                onClear={handleClear}
              />
            }
            right={
              <ScenarioOutput
                scenario={selectedScenario}
                result={result}
                error={error}
                loading={loading}
                activeTab={outputTab}
                onTab={setOutputTab}
              />
            }
          />
        </Section>
      </PageFrame>
    </PingPage>
  );
}

function ScenarioList({ selectedId, onSelect }) {
  return (
    <>
      <div className="inspector-shell-tree-header">
        <span>Scenarios ({SCENARIOS.length})</span>
      </div>
      <div className="inspector-shell-tree-body">
        <div className="inspector-shell-tree-group__label">Failure Scenarios</div>
        {SCENARIOS.map((scenario) => (
          <InspectorListItem
            key={scenario.id}
            label={scenario.name}
            active={selectedId === scenario.id}
            dot="sensitive"
            onClick={() => onSelect(scenario)}
          />
        ))}
      </div>
    </>
  );
}

function ScenarioForm({ scenario, loading, blocked, error, result, onExecute, onClear }) {
  let hint = 'Mints a test token and asks the BFF for the rejection it earns.';
  if (!scenario) hint = 'Pick a scenario first: Execute is not available yet.';
  else if (loading) hint = 'Asking the BFF...';
  else if (error) hint = 'The run failed. Execute is available to try again.';
  else if (result) {
    hint = `Simulated rejection: ${result.scenario_name || scenario.name}, HTTP ${result.http_status}, `
      + `${result.error_code}. The result is in the result pane. Execute runs it again.`;
  }

  return (
    <>
      <div className="inspector-shell-form-header">
        <div className="inspector-shell-form-header__name">
          {scenario ? scenario.name : 'No scenario picked'}
        </div>
        <div className="inspector-shell-form-header__desc">
          {scenario ? scenario.description : 'Choose one of the five failures from the list.'}
        </div>
      </div>
      <div className="inspector-shell-form-actions inspector-shell-form-actions--top tst-actions">
        <button
          type="button"
          className="pu-btn pu-btn--primary"
          onClick={onExecute}
          aria-disabled={blocked ? 'true' : undefined}
          aria-describedby="tst-exec-hint"
          data-testid="tst-execute"
        >
          {loading ? 'Executing...' : 'Execute'}
        </button>
        <button
          type="button"
          className="pu-btn"
          onClick={onClear}
          data-testid="tst-clear"
        >
          Clear
        </button>
        <p id="tst-exec-hint" className="tst-hint" role="status" aria-live="polite">{hint}</p>
      </div>
      {error && (
        <p className="pu-status-line tst-error" role="alert" data-testid="tst-error">
          <StatusChip tone="danger">Failed</StatusChip>
          <span>{error}</span>
        </p>
      )}
      {scenario ? (
        <div className="inspector-shell-form-body">
          <KvList
            items={[
              { label: 'Scenario ID', value: scenario.id, mono: true },
              {
                label: 'API endpoint',
                value: `POST /api/test/token-validation/scenario/${scenario.id}`,
                mono: true,
              },
            ]}
          />

          <details className="tst-about">
            <summary>About These Scenarios</summary>
            <div className="tst-about__body">
              <p>
                These scenarios show the checks an MCP server applies to a token and the
                rejection that follows. Each one intentionally violates a different rule:
              </p>
              <ul>
                <li><strong>Wrong Scope:</strong> Token lacks required OAuth scopes.</li>
                <li><strong>Wrong Audience:</strong> Token issued for a different service.</li>
                <li><strong>Missing Act:</strong> Token lacks RFC 8693 delegation proof.</li>
                <li><strong>Agent Token on User Endpoint:</strong> Agent token used on user-level API.</li>
                <li><strong>Expired Token:</strong> Token past expiration time.</li>
              </ul>
            </div>
          </details>
        </div>
      ) : (
        <div className="inspector-shell-form-empty">
          Select a scenario from the list to inspect and execute it.
        </div>
      )}
    </>
  );
}

// Phone width: the shell stacks its columns (InspectorShell.css, max-width 768px).
const NARROW = '(max-width: 768px)';

function ScenarioOutput({ scenario, result, error, loading, activeTab, onTab }) {
  const bodyRef = useRef(null);

  // When a result arrives on a stacked layout it sits far below Execute: bring it into view.
  useEffect(() => {
    if (!result || typeof window.matchMedia !== 'function' || !window.matchMedia(NARROW).matches) return;
    const pane = bodyRef.current?.closest('.inspector-shell-col-right') || bodyRef.current;
    if (pane && typeof pane.scrollIntoView === 'function') pane.scrollIntoView({ block: 'start' });
  }, [result]);

  let emptyText = 'Select a scenario and execute it to see results.';
  if (scenario) emptyText = 'Click Execute to run the scenario and see the result here.';
  if (scenario && loading) emptyText = 'Waiting for the BFF to answer...';
  if (scenario && error && !loading) emptyText = 'No result: the run failed (see the Failed message under Execute). Execute tries again.';

  return (
    <>
      <InspectorTabs tabs={OUTPUT_TABS} activeKey={activeTab} onChange={onTab} />

      {result ? (
        <>
          <div className="inspector-shell-output-body" ref={bodyRef}>
            {activeTab === 'result' && (
              <Card
                tone="neutral"
                title={result.scenario_name || result.scenario}
                data-testid="tst-result"
              >
                <p className="pu-status-line">
                  <StatusChip tone="info">Simulated rejection</StatusChip>
                  <span>Simulated: the reply is pre-written, no server judged this token.</span>
                </p>
                <KvList
                  items={[
                    { label: 'Error code', value: result.error_code, mono: true },
                    { label: 'HTTP status', value: result.http_status, mono: true },
                    { label: 'Scenario', value: result.scenario_name || result.scenario },
                    { label: 'Description', value: result.error_description },
                  ]}
                />
              </Card>
            )}

            {activeTab === 'teaching' && (
              <Card tone="neutral" title="What This Teaches">
                <p className="pu-note tst-teaching">{result.teaching_message}</p>
              </Card>
            )}

            {activeTab === 'token' && (
              <Card tone="neutral" title="Claims of the test token">
                <p className="pu-note">
                  Minted by this machine's BFF with a demo secret for the lesson. PingOne did not issue it.
                </p>
                <pre className="inspector-shell-output-code">
                  <JsonHighlight
                    value={result.token_details || { message: 'No token details available' }}
                    deep
                  />
                </pre>
              </Card>
            )}

            {activeTab === 'raw' && (
              <Card tone="neutral" title="Request and response as the BFF wrote them">
                <p className="pu-note">
                  Nothing was sent to the endpoint named here: the BFF built both sides of the exchange.
                </p>
                <pre className="inspector-shell-output-code">
                  <JsonHighlight
                    value={{
                      request: result.request || null,
                      response: result.response || null
                    }}
                    deep
                  />
                </pre>
              </Card>
            )}
          </div>

          <div className="inspector-shell-output-footer">
            <span><strong>Status:</strong> {result.http_status || 'Error'}</span>
            <span><strong>Scenario:</strong> {result.scenario_name || scenario?.name}</span>
            <span><strong>Type:</strong> Token Validation</span>
          </div>
        </>
      ) : (
        <div className="inspector-shell-output-empty">
          {emptyText}
        </div>
      )}
    </>
  );
}
