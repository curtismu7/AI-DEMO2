import React, { useEffect, useState } from 'react';
import '../styles/PingOneSetup.css';

export default function PingOneSetup() {
  const [credentials, setCredentials] = useState({
    environmentId: '',
    clientId: '',
    clientSecret: '',
  });
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [prefilled, setPrefilled] = useState(false);

  // Pre-fill the form with the worker credentials configured on the server.
  // These remain fully editable; the fetch just seeds them for convenience.
  useEffect(() => {
    const token = sessionStorage.getItem('id_token') || localStorage.getItem('id_token');
    fetch('/api/pingone/setup/defaults', {
      headers: { ...(token && { Authorization: `Bearer ${token}` }) },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        setCredentials({
          environmentId: data.environmentId || '',
          clientId: data.clientId || '',
          clientSecret: data.clientSecret || '',
        });
        if (data.environmentId || data.clientId || data.clientSecret) {
          setPrefilled(true);
        }
      })
      .catch(() => {
        // No defaults available (e.g. not signed in) — leave fields blank.
      });
  }, []);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setCredentials((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const clearResults = () => {
    setError(null);
    setResults(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    clearResults();

    try {
      const token = sessionStorage.getItem('id_token') || localStorage.getItem('id_token');
      const response = await fetch('/api/pingone/setup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify(credentials),
      });

      const data = await response.json();
      response.ok ? setResults(data) : setError(data.error || 'Setup failed');
    } catch (err) {
      setError(err.message || 'Network error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="pingone-setup-page">
      <div className="setup-container">
        <h1>🔧 PingOne MCP Setup</h1>
        <p className="subtitle">Provision PingOne worker credentials for MCP connectivity</p>

        <div className="setup-content">
          {/* Form Section */}
          <div className="setup-form-section">
            <h2>Enter Credentials</h2>
            {prefilled && (
              <p className="prefill-note">
                ✓ Pre-filled from server configuration — edit any field if needed.
              </p>
            )}
            <form onSubmit={handleSubmit} className="setup-form">
              <div className="form-group">
                <label htmlFor="environmentId">Environment ID</label>
                <input
                  type="text"
                  id="environmentId"
                  name="environmentId"
                  value={credentials.environmentId}
                  onChange={handleInputChange}
                  placeholder="e.g., 01d89b06-66d5-430e-9f28-65636843788b"
                  required
                  disabled={loading}
                />
              </div>

              <div className="form-group">
                <label htmlFor="clientId">Worker App Client ID</label>
                <input
                  type="text"
                  id="clientId"
                  name="clientId"
                  value={credentials.clientId}
                  onChange={handleInputChange}
                  placeholder="e.g., 89ad8921-2e90-4b58-93bd-9ec72bd33ad5"
                  required
                  disabled={loading}
                />
              </div>

              <div className="form-group">
                <label htmlFor="clientSecret">Worker App Client Secret</label>
                <input
                  type="password"
                  id="clientSecret"
                  name="clientSecret"
                  value={credentials.clientSecret}
                  onChange={handleInputChange}
                  placeholder="Paste your client secret"
                  required
                  disabled={loading}
                />
              </div>

              <button
                type="submit"
                className="btn btn-primary"
                disabled={loading || !credentials.environmentId || !credentials.clientId || !credentials.clientSecret}
              >
                {loading ? 'Testing...' : '✓ Run Setup & Test'}
              </button>
            </form>
          </div>

          {/* Results Section */}
          {results && (
            <div className={`results-section ${results.success ? 'success' : 'partial'}`}>
              <h2>{results.success ? '✅ Setup Successful' : '⚠️ Setup Incomplete'}</h2>

              <div className="steps-breakdown">
                <div className={`step ${results.steps.tokenAcquisition.success ? 'passed' : 'failed'}`}>
                  <div className="step-title">
                    {results.steps.tokenAcquisition.success ? '✓' : '✗'} Worker Token
                  </div>
                  <div className="step-detail">
                    {results.steps.tokenAcquisition.success
                      ? 'Successfully acquired token from PingOne'
                      : `Failed: ${results.steps.tokenAcquisition.error}`}
                  </div>
                </div>

                <div className={`step ${results.steps.gatewayConnectivity.success ? 'passed' : 'failed'}`}>
                  <div className="step-title">
                    {results.steps.gatewayConnectivity.success ? '✓' : '✗'} Hosted MCP Connectivity
                  </div>
                  <div className="step-detail">
                    {results.steps.gatewayConnectivity.success
                      ? 'Hosted PingOne MCP server is reachable'
                      : `Failed: ${results.steps.gatewayConnectivity.error}`}
                  </div>
                </div>

                <div className={`step ${results.steps.toolCall.success ? 'passed' : 'failed'}`}>
                  <div className="step-title">
                    {results.steps.toolCall.success ? '✓' : '✗'} Tool Call
                  </div>
                  <div className="step-detail">
                    {results.steps.toolCall.success
                      ? `Found ${results.steps.toolCall.toolsFound} tools available`
                      : `Failed: ${results.steps.toolCall.error}`}
                  </div>
                  {results.steps.toolCall.tools.length > 0 && (
                    <div className="tools-list">
                      <strong>Available tools:</strong>
                      <ul>
                        {results.steps.toolCall.tools.slice(0, 5).map((tool) => (
                          <li key={tool.name}>{tool.name}</li>
                        ))}
                        {results.steps.toolCall.tools.length > 5 && (
                          <li>+ {results.steps.toolCall.tools.length - 5} more</li>
                        )}
                      </ul>
                    </div>
                  )}
                </div>
              </div>

              {results.nextSteps && (
                <div className="next-steps">
                  <h3>Next Steps:</h3>
                  <ol>
                    {results.nextSteps.map((step, idx) => (
                      <li key={idx}>{step}</li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          )}

          {/* Error Section */}
          {error && (
            <div className="error-section">
              <h3>❌ Error</h3>
              <p>{error}</p>
              <p className="error-hint">
                Check your credentials in PingOne console and ensure the worker app has admin roles.
              </p>
            </div>
          )}

          {/* Help Section */}
          <div className="help-section">
            <h3>ℹ️ Where to find your credentials:</h3>
            <ul>
              <li><strong>Environment ID:</strong> PingOne Admin Console → Environment → Settings</li>
              <li><strong>Client ID & Secret:</strong> PingOne Admin Console → Applications → Your Worker App → Credentials</li>
              <li><strong>Admin Roles:</strong> Ensure the app has Environment Admin &amp; Identity Data Admin roles</li>
            </ul>
          </div>

          {/* Hosted Remote MCP Server */}
          <div className="help-section">
            <h3>🔌 Connect an IDE (hosted Remote MCP Server)</h3>
            <p>
              For interactive OAuth access from Claude Code, Cursor, or VS Code — separate from
              the worker credentials above — connect to PingOne&apos;s hosted admin MCP server:
            </p>
            <code className="mcp-url">
              https://mcp.pingone.com/admin/{credentials.environmentId || '{envId}'}/mcp
            </code>
          </div>
        </div>
      </div>
    </div>
  );
}
