import React, { useState, useCallback } from 'react';
import apiClient from '../services/apiClient';
import './PingOneAudit.css';

/**
 * PingOneAudit component — displays resource and scope validation results.
 * Shows two tables:
 * 1. Resource Configuration — validate existence and attributes
 * 2. Scope Audit — compare current vs expected scopes
 */
export default function PingOneAudit() {
  const [auditResults, setAuditResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [auditedAt, setAuditedAt] = useState(null);

  /** Fetch audit results from the API */
  const handleRefreshAudit = useCallback(async () => {
    setLoading(true);
    setError(null);
    setAuditResults(null);

    try {
      const { data } = await apiClient.get('/api/pingone/audit');
      if (data && data.status === 'success') {
        setAuditResults(data);
        setAuditedAt(data.auditedAt);
      } else {
        setError(data?.error || 'Audit returned unexpected response format');
      }
    } catch (err) {
      if (err.response?.status === 401) {
        setError('Not authenticated. Please sign in to view audit results.');
      } else {
        const msg = err?.response?.data?.message || err?.message || 'Failed to fetch audit results';
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  /** Get CSS class and label for resource status badges */
  function getResourceStatusClass(status) {
    const classMap = {
      CORRECT: 'status-correct',
      CONFIG_ERROR: 'status-error',
      MISSING: 'status-missing',
      UNEXPECTED: 'status-warning',
    };
    return classMap[status] || 'status-unknown';
  }

  /** Get CSS class and label for scope status badges */
  function getScopeStatusClass(status) {
    const classMap = {
      CORRECT: 'status-correct',
      MISMATCH: 'status-error',
      NEEDS_REVIEW: 'status-warning',
      ERROR: 'status-missing',
    };
    return classMap[status] || 'status-unknown';
  }

  /** Format timestamp for display */
  function formatTimestamp(isoString) {
    try {
      return new Date(isoString).toLocaleString();
    } catch {
      return isoString;
    }
  }

  // Render: Loading state
  if (loading) {
    return (
      <div className="pingone-audit-container">
        <div className="pingone-audit-loading">
          <div className="spinner" />
          <p>Auditing PingOne resources and scopes...</p>
        </div>
      </div>
    );
  }

  // Render: Error state
  if (error) {
    return (
      <div className="pingone-audit-container">
        <div className="pingone-audit-error">
          <p className="error-message">⚠️ {error}</p>
          <button className="pingone-audit-button pingone-audit-button--primary" onClick={handleRefreshAudit}>
            Retry Audit
          </button>
        </div>
      </div>
    );
  }

  // Render: Initial state (no audit run yet)
  if (!auditResults) {
    return (
      <div className="pingone-audit-container">
        <h3 className="pingone-audit-title">PingOne Configuration Audit</h3>
        <div className="pingone-audit-empty">
          <p>Click <strong>Run Audit</strong> to validate your PingOne resource configuration.</p>
          <button className="pingone-audit-button pingone-audit-button--primary" onClick={handleRefreshAudit}>
            Run Audit
          </button>
        </div>
      </div>
    );
  }

  const { resourceValidation = [], scopeAudit = [] } = auditResults;

  return (
    <div className="pingone-audit-container">
      <div className="pingone-audit-header">
        <h3 className="pingone-audit-title">PingOne Configuration Audit</h3>
        <div className="pingone-audit-meta">
          {auditedAt && <span className="pingone-audit-timestamp">Last run: {formatTimestamp(auditedAt)}</span>}
          <button
            className="pingone-audit-button pingone-audit-button--secondary"
            onClick={handleRefreshAudit}
            disabled={loading}
          >
            {loading ? 'Auditing...' : 'Refresh Audit'}
          </button>
        </div>
      </div>

      {/* Table 1: Resource Configuration */}
      <section className="pingone-audit-section">
        <h4 className="pingone-audit-section-title">Resource Configuration</h4>
        {resourceValidation.length === 0 ? (
          <p className="pingone-audit-empty-message">No resources found in audit results.</p>
        ) : (
          <div className="pingone-audit-table-wrapper">
            <table className="pingone-audit-table">
              <thead>
                <tr>
                  <th>Resource Name</th>
                  <th>Audience URI</th>
                  <th>Auth Method</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {resourceValidation.map((resource, idx) => (
                  <tr key={idx} className={`resource-row-${resource.status.toLowerCase()}`}>
                    <td className="resource-name">{resource.resourceName}</td>
                    <td className="audience-uri">
                      <code>{resource.audienceUri || '(not found)'}</code>
                    </td>
                    <td className="auth-method">{resource.authMethod || '—'}</td>
                    <td className="status-cell">
                      <span className={`status-badge ${getResourceStatusClass(resource.status)}`}>
                        {resource.status}
                      </span>
                      {resource.message && (
                        <div className="status-message">{resource.message}</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Table 2: Scope Audit */}
      <section className="pingone-audit-section">
        <h4 className="pingone-audit-section-title">Scope Audit</h4>
        {scopeAudit.length === 0 ? (
          <p className="pingone-audit-empty-message">No scope audit results found. Check resource validation first.</p>
        ) : (
          <div className="pingone-audit-table-wrapper">
            <table className="pingone-audit-table pingone-audit-table--scopes">
              <thead>
                <tr>
                  <th>Resource Name</th>
                  <th>Expected Scopes</th>
                  <th>Current Scopes</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {scopeAudit.map((audit, idx) => (
                  <tr key={idx} className={`scope-row-${audit.status.toLowerCase()}`}>
                    <td className="resource-name">{audit.resourceName}</td>
                    <td className="scopes-column">
                      {audit.expectedScopes && audit.expectedScopes.length > 0 ? (
                        <div className="scopes-list">
                          {audit.expectedScopes.map((scope, i) => (
                            <span key={i} className="scope-tag scope-tag--expected">
                              {scope}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="scopes-empty">(none expected)</span>
                      )}
                    </td>
                    <td className="scopes-column">
                      {audit.currentScopes && audit.currentScopes.length > 0 ? (
                        <div className="scopes-list">
                          {audit.currentScopes.map((scope, i) => (
                            <span key={i} className="scope-tag scope-tag--current">
                              {scope}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="scopes-empty">(none)</span>
                      )}
                    </td>
                    <td className="status-cell">
                      <span className={`status-badge ${getScopeStatusClass(audit.status)}`}>
                        {audit.status}
                      </span>
                      {audit.mismatches && (
                        <div className="mismatches-info">
                          {audit.mismatches.missing && audit.mismatches.missing.length > 0 && (
                            <div className="mismatch-item">
                              <strong>Missing:</strong> {audit.mismatches.missing.join(', ')}
                            </div>
                          )}
                          {audit.mismatches.extra && audit.mismatches.extra.length > 0 && (
                            <div className="mismatch-item">
                              <strong>Extra:</strong> {audit.mismatches.extra.join(', ')}
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Summary counts */}
      {resourceValidation.length > 0 && scopeAudit.length > 0 && (
        <div className="pingone-audit-summary">
          <div className="summary-stat">
            <span className="summary-label">Resources Correct:</span>
            <span className="summary-value">
              {resourceValidation.filter((r) => r.status === 'CORRECT').length} / {resourceValidation.length}
            </span>
          </div>
          <div className="summary-stat">
            <span className="summary-label">Scopes Correct:</span>
            <span className="summary-value">
              {scopeAudit.filter((r) => r.status === 'CORRECT').length} / {scopeAudit.length}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
