// TokenSecurityTester.jsx
// Dark IDE three-column layout (Mock B) - Educational component for token
// validation demonstration. Shows how MCP server rejects invalid tokens with
// educational error messages.
import React, { useState } from 'react';
import apiClient from '../services/apiClient';
import JsonHighlight from './shared/JsonHighlight';
import InspectorShell from './shared/InspectorShell';
import InspectorListItem from './shared/InspectorListItem';
import InspectorTabs from './shared/InspectorTabs';
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

export default function TokenSecurityTester() {
  const [selectedScenario, setSelectedScenario] = useState(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [outputTab, setOutputTab] = useState('result');

  const handleExecute = async () => {
    if (!selectedScenario) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await apiClient.post(
        `/api/test/token-validation/scenario/${selectedScenario.id}`
      );
      setResult(response.data);
      setOutputTab('result');
    } catch (err) {
      console.error('[TokenSecurityTester] Error:', err);
      setError(
        err.response?.data?.message ||
        err.response?.data?.error ||
        err.message ||
        'Failed to run test scenario'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setResult(null);
    setError(null);
    setSelectedScenario(null);
    setOutputTab('result');
  };

  const selectScenario = (scenario) => {
    setSelectedScenario(scenario);
    setResult(null);
    setError(null);
    setOutputTab('result');
  };

  const left = (
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
            active={selectedScenario?.id === scenario.id}
            dot="sensitive"
            onClick={() => selectScenario(scenario)}
          />
        ))}
      </div>
    </>
  );

  const middle = selectedScenario ? (
    <>
      <div className="inspector-shell-form-header">
        <div className="inspector-shell-form-header__name">{selectedScenario.name}</div>
        <div className="inspector-shell-form-header__desc">{selectedScenario.description}</div>
      </div>
      <div className="inspector-shell-form-actions inspector-shell-form-actions--top">
        <button
          className="inspector-shell-btn-call"
          onClick={handleExecute}
          disabled={loading}
        >
          {loading ? 'Executing...' : 'Execute'}
        </button>
        <button className="inspector-shell-btn-clear" onClick={handleClear}>Clear</button>
      </div>
      <div className="inspector-shell-form-body">
                <div className="tst-demo-notice">
                  <span className="tst-demo-notice__icon">&#x26A0;</span>
                  <span className="tst-demo-notice__text">
                    <strong>Demonstration Feature</strong> &mdash; This is an educational
                    demonstration. It is disabled in production.
                  </span>
                </div>

        <div className="tst-scenario-info">
          <div className="inspector-shell-field">
            <label>Scenario ID <span className="type">string</span></label>
            <input type="text" value={selectedScenario.id} readOnly />
          </div>
          <div className="inspector-shell-field">
            <label>API Endpoint <span className="type">POST</span></label>
            <input
              type="text"
              value={`/api/test/token-validation/scenario/${selectedScenario.id}`}
              readOnly
            />
          </div>
        </div>

        <details className="tst-about-scenarios">
          <summary>About These Scenarios</summary>
          <div className="tst-about-scenarios__body">
            <p>
              These test scenarios demonstrate how the MCP server validates tokens and
              rejects requests that violate security controls. Each scenario intentionally
              violates a different rule:
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
      <div className="inspector-shell-form-actions">
        <button
          className="inspector-shell-btn-call"
          onClick={handleExecute}
          disabled={loading}
        >
          {loading ? 'Executing...' : 'Execute'}
        </button>
        <button className="inspector-shell-btn-clear" onClick={handleClear}>Clear</button>
        {error && <span className="inspector-shell-form-error">{error}</span>}
      </div>
    </>
  ) : (
    <div className="inspector-shell-form-empty">
      Select a scenario from the tree to inspect and execute it.
    </div>
  );

  const right = (
    <>
      <InspectorTabs
        tabs={[
          { key: 'result', label: 'Result' },
          { key: 'teaching', label: 'Teaching' },
          { key: 'token', label: 'Token Details' },
          { key: 'raw', label: 'Request/Response' },
        ]}
        activeKey={outputTab}
        onChange={setOutputTab}
      />

      {result ? (
        <>
          <div className="inspector-shell-output-body">
                {outputTab === 'result' && (
                  <div className="tst-result-panel">
                    <div className="tst-result-row">
                      <span className="tst-result-label">Error Code</span>
                      <span className="tst-result-value tst-result-value--error">
                        {result.error_code}
                      </span>
                    </div>
                    <div className="tst-result-row">
                      <span className="tst-result-label">HTTP Status</span>
                      <span className="tst-result-value tst-result-value--status">
                        {result.http_status}
                      </span>
                    </div>
                    <div className="tst-result-row">
                      <span className="tst-result-label">Scenario</span>
                      <span className="tst-result-value">
                        {result.scenario_name || result.scenario}
                      </span>
                    </div>
                    <div className="tst-result-row">
                      <span className="tst-result-label">Description</span>
                      <span className="tst-result-value">
                        {result.error_description}
                      </span>
                    </div>
                  </div>
                )}

                {outputTab === 'teaching' && (
                  <div className="tst-teaching-panel">
                    <div className="tst-teaching-header">What This Teaches</div>
                    <div className="tst-teaching-message">
                      {result.teaching_message}
                    </div>
                  </div>
                )}

                {outputTab === 'token' && (
                  <pre className="inspector-shell-output-code">
                    <JsonHighlight
                      value={result.token_details || { message: 'No token details available' }}
                      deep
                    />
                  </pre>
                )}

                {outputTab === 'raw' && (
                  <pre className="inspector-shell-output-code">
                    <JsonHighlight
                      value={{
                        request: result.request || null,
                        response: result.response || null
                      }}
                      deep
                    />
                  </pre>
                )}
              </div>

          <div className="inspector-shell-output-footer">
            <span><strong>Status:</strong> {result.http_status || 'Error'}</span>
            <span><strong>Scenario:</strong> {result.scenario_name || selectedScenario?.name}</span>
            <span><strong>Type:</strong> Token Validation</span>
          </div>
        </>
      ) : (
        <div className="inspector-shell-output-empty">
          {selectedScenario
            ? 'Click Execute to run the scenario and see the result here.'
            : 'Select a scenario and execute it to see results.'}
        </div>
      )}
    </>
  );

  return (
    <InspectorShell
      title="Token Security Tester"
      statusText={`Educational demonstration — ${SCENARIOS.length} scenarios`}
      actions={<span className="tst-topbar-badge">Demo Only</span>}
      left={left}
      middle={middle}
      right={right}
    />
  );
}
