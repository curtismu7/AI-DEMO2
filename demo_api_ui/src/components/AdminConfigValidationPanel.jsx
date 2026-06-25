/**
 * AdminConfigValidationPanel — Diagnose system configuration issues
 *
 * Dashboard for admins/ops to verify auth system configuration:
 *   - JWKS endpoint reachability
 *   - Token endpoint accessibility
 *   - Token exchanger configuration
 *   - Feature flags enabled/disabled
 *   - Environment variable status
 *
 * Shows real-time probe results from backend /api/admin/startup-checks
 */

import React, { useState, useEffect } from 'react';
import './AdminConfigValidationPanel.css';

function AdminConfigValidationPanel({ apiBaseUrl = '' }) {
  const [validations, setValidations] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastChecked, setLastChecked] = useState(null);

  const fetchValidations = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${apiBaseUrl}/api/admin/startup-checks`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      setValidations(data);
      setLastChecked(new Date());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchValidations();
  }, []);

  if (loading) {
    return (
      <div className="admin-config-panel loading">
        <div className="spinner">⟳</div>
        <p>Loading configuration checks...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="admin-config-panel error">
        <h2>Configuration Check Failed</h2>
        <p className="error-message">
          Could not fetch configuration status: <code>{error}</code>
        </p>
        <button onClick={fetchValidations} className="btn-refresh">
          Retry
        </button>
      </div>
    );
  }

  if (!validations) {
    return <div className="admin-config-panel">No configuration data available.</div>;
  }

  const { passed, results, timestamp } = validations;

  return (
    <div className={`admin-config-panel ${passed ? 'passed' : 'failed'}`}>
      <div className="panel-header">
        <h2>
          {passed ? '✓ Configuration Valid' : '✗ Configuration Issues Detected'}
        </h2>
        <div className="header-actions">
          <button onClick={fetchValidations} className="btn-refresh" title="Refresh checks">
            🔄 Refresh
          </button>
        </div>
      </div>

      <div className="panel-metadata">
        <small>
          Last checked: {lastChecked ? lastChecked.toLocaleString() : 'Never'}
          {timestamp && ` (server: ${new Date(timestamp).toLocaleString()})`}
        </small>
      </div>

      <div className="validation-groups">
        {/* Connectivity Checks */}
        <div className="validation-group">
          <h3>Connectivity Checks</h3>

          <CheckRow
            name="JWKS Endpoint"
            result={results.jwks}
            docLink="/docs/errors/JWKS_UNAVAILABLE"
            details={{
              what: 'PingOne public key endpoint (JWT signature verification)',
              fix: 'Verify PINGONE_ENVIRONMENT_ID is correct',
            }}
          />

          <CheckRow
            name="Token Endpoint"
            result={results.token}
            docLink="/docs/errors/SESSION_EXPIRED"
            details={{
              what: 'PingOne OAuth 2.0 token endpoint',
              fix: 'Verify token endpoint is accessible from server',
            }}
          />

          <CheckRow
            name="Token Exchanger"
            result={results.exchanger}
            docLink="/docs/errors/TOKEN_EXCHANGE_FAILED"
            details={{
              what: 'RFC 8693 token exchange client',
              fix: 'Verify PINGONE_TOKEN_EXCHANGER_CLIENT_ID and credentials',
            }}
          />
        </div>

        {/* Required Environment Variables */}
        {validations.required && (
          <div className="validation-group">
            <h3>Required Configuration</h3>

            {validations.required.map((check) => (
              <div key={check.name} className={`check-row ${check.status}`}>
                <div className="check-indicator">{check.status === 'ok' ? '✓' : '✗'}</div>
                <div className="check-info">
                  <span className="check-name">{check.name}</span>
                  {check.value && (
                    <span className="check-value">
                      {check.masked ? `${check.value.slice(0, 8)}***` : check.value}
                    </span>
                  )}
                  {check.message && <span className="check-message">{check.message}</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Feature Flags */}
        {validations.features && (
          <div className="validation-group">
            <h3>Feature Flags</h3>

            {validations.features.map((feature) => (
              <div key={feature.tag} className="feature-item">
                <span className={`feature-badge ${feature.enabled ? 'enabled' : 'disabled'}`}>
                  {feature.enabled ? '●' : '○'}
                </span>
                <span className="feature-name">{feature.tag}</span>
                {feature.description && (
                  <span className="feature-desc">{feature.description}</span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Debug Info */}
        {validations.debug && (
          <details className="validation-group debug-group">
            <summary>Debug Information</summary>
            <pre className="debug-content">{JSON.stringify(validations.debug, null, 2)}</pre>
          </details>
        )}
      </div>

      <div className="panel-footer">
        <p className="footer-note">
          {passed
            ? 'All configuration checks passed. System is ready to serve requests.'
            : 'Configuration issues detected. See above for details and recommended fixes.'}
        </p>
        <p className="footer-docs">
          For more information, see the{' '}
          <a href="/docs/configuration" target="_blank" rel="noopener noreferrer">
            Configuration Guide
          </a>
        </p>
      </div>
    </div>
  );
}

/**
 * Individual check result row
 */
function CheckRow({ name, result, docLink, details }) {
  const status = result?.ok ? 'ok' : 'failed';
  const statusText = result?.ok ? '✓' : '✗';
  const errorMsg = result?.error || 'Unknown error';

  return (
    <div className={`check-row ${status}`}>
      <div className="check-indicator">{statusText}</div>
      <div className="check-info">
        <div className="check-header">
          <span className="check-name">{name}</span>
          {result?.status && <span className="check-status">HTTP {result.status}</span>}
        </div>
        {!result?.ok && <span className="check-error">{errorMsg}</span>}
        {details && <CheckDetails details={details} docLink={docLink} />}
      </div>
    </div>
  );
}

/**
 * Expandable details for a check
 */
function CheckDetails({ details, docLink }) {
  const [expanded, setExpanded] = useState(false);

  if (!details) return null;

  return (
    <div className="check-details">
      <button
        className="btn-expand"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        {expanded ? '▼' : '▶'} Details
      </button>

      {expanded && (
        <div className="details-content">
          {details.what && (
            <p>
              <strong>What:</strong> {details.what}
            </p>
          )}
          {details.fix && (
            <p>
              <strong>Fix:</strong> {details.fix}
            </p>
          )}
          {docLink && (
            <p>
              <a href={docLink} target="_blank" rel="noopener noreferrer">
                Read documentation →
              </a>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default AdminConfigValidationPanel;
