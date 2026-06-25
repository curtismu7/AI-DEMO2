import React, { useState } from 'react';
import apiClient from '../services/apiClient';
import './TokenSecurityTester.css';

/**
 * TokenSecurityTester - Educational component for token validation demonstration
 * Shows how MCP server rejects invalid tokens with educational error messages
 * 
 * Phase 158: Add Token Validation Test Scenarios
 */
export default function TokenSecurityTester() {
  const [selectedScenario, setSelectedScenario] = useState('wrong-scope');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const scenarios = [
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

  const handleRunTest = async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await apiClient.post(
        `/api/test/token-validation/scenario/${selectedScenario}`
      );
      setResult(response.data);
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

  return (
    <div className="token-security-tester">
      {/* Demo Warning Banner */}
      <div className="tester-warning-banner">
        <div className="warning-icon">⚠️</div>
        <div className="warning-text">
          <strong>Demonstration Feature</strong>
          <p>This is an educational demonstration. It is disabled in production.</p>
        </div>
      </div>

      {/* Scenario Selector */}
      <div className="tester-controls">
        <div className="tester-control-group">
          <label htmlFor="scenario-select" className="tester-label">
            Select Test Scenario:
          </label>
          <select
            id="scenario-select"
            value={selectedScenario}
            onChange={(e) => setSelectedScenario(e.target.value)}
            className="tester-select"
            disabled={loading}
          >
            {scenarios.map((scenario) => (
              <option key={scenario.id} value={scenario.id}>
                {scenario.name} — {scenario.description}
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={handleRunTest}
          disabled={loading}
          className="tester-button"
        >
          {loading ? 'Running Test...' : 'Run Test'}
        </button>
      </div>

      {/* Error Display */}
      {error && (
        <div className="tester-error-box">
          <div className="error-icon">✕</div>
          <div className="error-content">
            <strong>Error:</strong>
            <p>{error}</p>
          </div>
        </div>
      )}

      {/* Results Display */}
      {result && (
        <div className="tester-result-box">
          <div className="result-header">
            <h3>{result.scenario_name || result.scenario}</h3>
            <span className="result-http-status">{result.http_status}</span>
          </div>

          {/* Error Code and Description */}
          <div className="result-section">
            <div className="result-row">
              <label>Error Code:</label>
              <span className="result-error-code">{result.error_code}</span>
            </div>
            <div className="result-row">
              <label>Error Description:</label>
              <span className="result-error-description">
                {result.error_description}
              </span>
            </div>
          </div>

          {/* Teaching Message (Highlighted) */}
          <div className="result-teaching-box">
            <div className="teaching-header">
              <strong>💡 What This Teaches:</strong>
            </div>
            <div className="teaching-message">
              {result.teaching_message}
            </div>
          </div>

          {/* Token Details (Collapsible) */}
          {result.token_details && (
            <details className="result-details">
              <summary>Token Details</summary>
              <div className="token-details-content">
                <div className="detail-row">
                  <strong>Subject (sub):</strong>
                  <code>{result.token_details.sub}</code>
                </div>
                <div className="detail-row">
                  <strong>Audience (aud):</strong>
                  <code>{result.token_details.aud}</code>
                </div>
                <div className="detail-row">
                  <strong>Issued At (iat):</strong>
                  <code>{result.token_details.iat}</code>
                </div>
                <div className="detail-row">
                  <strong>Expires (exp):</strong>
                  <code>{result.token_details.exp}</code>
                </div>
                <div className="detail-row">
                  <strong>Scopes:</strong>
                  <code>{result.token_details.scopes?.join(' ')}</code>
                </div>
                {result.token_details.has_act_claim !== undefined && (
                  <div className="detail-row">
                    <strong>Has act Claim:</strong>
                    <code>{String(result.token_details.has_act_claim)}</code>
                  </div>
                )}
                {result.token_details.act_claim && (
                  <div className="detail-row">
                    <strong>Act Claim:</strong>
                    <pre className="detail-json">
                      {JSON.stringify(result.token_details.act_claim, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </details>
          )}

          {/* Request/Response Details */}
          {result.request && (
            <details className="result-details">
              <summary>Request Details</summary>
              <div className="request-response-content">
                <pre>{JSON.stringify(result.request, null, 2)}</pre>
              </div>
            </details>
          )}

          {result.response && (
            <details className="result-details">
              <summary>API Response</summary>
              <div className="request-response-content">
                <pre>{JSON.stringify(result.response, null, 2)}</pre>
              </div>
            </details>
          )}
        </div>
      )}

      {/* Scenarios Reference */}
      <div className="tester-footer">
        <details className="scenarios-reference">
          <summary>About These Scenarios</summary>
          <div className="scenarios-description">
            <p>
              These test scenarios demonstrate how the MCP server validates tokens and rejects
              requests that violate security controls. Each scenario intentionally violates a
              different rule:
            </p>
            <ul>
              <li>
                <strong>Wrong Scope:</strong> Token lacks required OAuth scopes. This ensures
                only authorized applications can delegate operations to agents.
              </li>
              <li>
                <strong>Wrong Audience:</strong> Token was issued for a different service. This
                prevents token reuse attacks across services.
              </li>
              <li>
                <strong>Missing Act:</strong> Token lacks RFC 8693 delegation proof. This
                ensures non-delegated user tokens cannot be used for agent operations.
              </li>
              <li>
                <strong>Agent Token on User Endpoint:</strong> Agent token used on a user-level
                API. This prevents agents from acting outside their authorized scope.
              </li>
              <li>
                <strong>Expired Token:</strong> Token past expiration time. This limits the
                window for stolen tokens to be useful.
              </li>
            </ul>
          </div>
        </details>
      </div>
    </div>
  );
}
