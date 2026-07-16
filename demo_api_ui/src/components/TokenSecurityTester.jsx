// TokenSecurityTester.jsx
// Dark IDE three-column layout (Mock B) - Educational component for token
// validation demonstration. Shows how MCP server rejects invalid tokens with
// educational error messages.
import React, { useState } from 'react';
import apiClient from '../services/apiClient';
import JsonHighlight from './shared/JsonHighlight';
import './PingOneMcpInspector.css';
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

  return (
    <div className="p1mcp-page">
      {/* Top bar */}
      <div className="p1mcp-topbar">
        <span className="p1mcp-topbar__dot" />
        <h1>Token Security Tester</h1>
        <span className="p1mcp-topbar__status">
          Educational demonstration &mdash; {SCENARIOS.length} scenarios
        </span>
        <div className="p1mcp-topbar__right">
          <span className="tst-topbar-badge">Demo Only</span>
        </div>
      </div>

      {/* Three-column grid */}
      <div className="p1mcp-grid">
        {/* Column 1: Tree - Scenarios */}
        <div className="p1mcp-col-tree">
          <div className="p1mcp-tree-header">
            <span>Scenarios ({SCENARIOS.length})</span>
          </div>
          <div className="p1mcp-tree-body">
            <div className="p1mcp-tree-group">
              <div className="p1mcp-tree-group__label">Failure Scenarios</div>
              {SCENARIOS.map((scenario) => (
                <div
                  key={scenario.id}
                  className={`p1mcp-tree-item ${selectedScenario?.id === scenario.id ? 'p1mcp-tree-item--active' : ''}`}
                  onClick={() => selectScenario(scenario)}
                >
                  <span className="p1mcp-tree-item__dot p1mcp-tree-item__dot--error" />
                  <span className="tst-tree-item-text">{scenario.name}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Column 2: Form */}
        <div className="p1mcp-col-form">
          {selectedScenario ? (
            <>
              <div className="p1mcp-form-header">
                <div className="p1mcp-form-header__name">{selectedScenario.name}</div>
                <div className="p1mcp-form-header__desc">{selectedScenario.description}</div>
              </div>
              <div className="p1mcp-form-body">
                <div className="tst-demo-notice">
                  <span className="tst-demo-notice__icon">&#x26A0;</span>
                  <span className="tst-demo-notice__text">
                    <strong>Demonstration Feature</strong> &mdash; This is an educational
                    demonstration. It is disabled in production.
                  </span>
                </div>

                <div className="tst-scenario-info">
                  <div className="p1mcp-field">
                    <label>Scenario ID <span className="type">string</span></label>
                    <input type="text" value={selectedScenario.id} readOnly />
                  </div>
                  <div className="p1mcp-field">
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
              <div className="p1mcp-form-actions">
                <button
                  className="p1mcp-btn-call"
                  onClick={handleExecute}
                  disabled={loading}
                >
                  {loading ? 'Executing...' : 'Execute'}
                </button>
                <button className="p1mcp-btn-clear" onClick={handleClear}>Clear</button>
                {error && <span className="p1mcp-form-error">{error}</span>}
              </div>
            </>
          ) : (
            <div className="p1mcp-form-empty">
              Select a scenario from the tree to inspect and execute it.
            </div>
          )}
        </div>

        {/* Column 3: Output */}
        <div className="p1mcp-col-output">
          <div className="p1mcp-output-tabs">
            <button
              className={`p1mcp-output-tab ${outputTab === 'result' ? 'p1mcp-output-tab--active' : ''}`}
              onClick={() => setOutputTab('result')}
            >Result</button>
            <button
              className={`p1mcp-output-tab ${outputTab === 'teaching' ? 'p1mcp-output-tab--active' : ''}`}
              onClick={() => setOutputTab('teaching')}
            >Teaching</button>
            <button
              className={`p1mcp-output-tab ${outputTab === 'token' ? 'p1mcp-output-tab--active' : ''}`}
              onClick={() => setOutputTab('token')}
            >Token Details</button>
            <button
              className={`p1mcp-output-tab ${outputTab === 'raw' ? 'p1mcp-output-tab--active' : ''}`}
              onClick={() => setOutputTab('raw')}
            >Request/Response</button>
          </div>

          {result ? (
            <>
              <div className="p1mcp-output-body">
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
                  <pre className="p1mcp-output-code jh-dark">
                    <JsonHighlight
                      value={result.token_details || { message: 'No token details available' }}
                      deep
                    />
                  </pre>
                )}

                {outputTab === 'raw' && (
                  <pre className="p1mcp-output-code jh-dark">
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

              <div className="p1mcp-output-footer">
                <span><strong>Status:</strong> {result.http_status || 'Error'}</span>
                <span><strong>Scenario:</strong> {result.scenario_name || selectedScenario?.name}</span>
                <span><strong>Type:</strong> Token Validation</span>
              </div>
            </>
          ) : (
            <div className="p1mcp-output-empty">
              {selectedScenario
                ? 'Click Execute to run the scenario and see the result here.'
                : 'Select a scenario and execute it to see results.'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
