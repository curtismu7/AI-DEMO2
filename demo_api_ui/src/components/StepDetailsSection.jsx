/**
 * StepDetailsSection Component
 * Expandable step details with timestamps, headers, tokens, validation
 * Uses native HTML <details> element for expand/collapse
 */
import React from 'react';
import './StepDetailsSection.css';

function StatusBadge({ status }) {
  const labels = {
    active: 'In Progress',
    done: 'Complete',
    pending: 'Waiting',
    error: 'Error'
  };
  return (
    <span className={`step-details-badge step-details-badge--${status}`}>
      {labels[status] || status}
    </span>
  );
}

function ValidityCheckRow({ check }) {
  return (
    <div className="step-details-check">
      <span className={`step-details-check-status step-details-check-status--${check.status}`}>
        {check.status === 'pass' ? '✓' : '⚠'}
      </span>
      <span className="step-details-check-label">{check.label}</span>
      {check.detail && (
        <span className="step-details-check-detail">{check.detail}</span>
      )}
    </div>
  );
}

function WarningRow({ warning }) {
  const levelIcons = {
    warning: '⚠️',
    info: 'ℹ️',
    error: '❌'
  };
  return (
    <div className={`step-details-warning step-details-warning--${warning.level}`}>
      <span className="step-details-warning-icon">
        {levelIcons[warning.level] || '•'}
      </span>
      <span className="step-details-warning-text">{warning.text}</span>
    </div>
  );
}

function CodeBlock({ label, content }) {
  const contentStr = typeof content === 'object' ? JSON.stringify(content, null, 2) : content;
  return (
    <div className="step-details-code-block">
      {label && <div className="step-details-code-label">{label}</div>}
      <pre className="step-details-code">{contentStr}</pre>
    </div>
  );
}

function ClaimsList({ claims }) {
  return (
    <div className="step-details-claims">
      {Object.entries(claims).map(([key, value]) => (
        <div key={key} className="step-details-claim">
          <span className="step-details-claim-key">{key}</span>
          <span className="step-details-claim-value">
            {typeof value === 'object' ? JSON.stringify(value) : String(value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function HttpSection({ request, response, label = 'HTTP Exchange' }) {
  return (
    <div className="step-details-http-section">
      <div className="step-details-subsection-title">{label}</div>

      <div className="step-details-http-exchange">
        <div className="step-details-http-part">
          <div className="step-details-http-header">
            <span className="step-details-http-method">{request.method}</span>
            <span className="step-details-http-endpoint">{request.endpoint}</span>
          </div>
          {request.headers && (
            <div className="step-details-http-details">
              <div className="step-details-http-label">Headers:</div>
              <CodeBlock content={request.headers} />
            </div>
          )}
          {request.body && (
            <div className="step-details-http-details">
              <div className="step-details-http-label">Body:</div>
              <CodeBlock content={request.body} />
            </div>
          )}
        </div>

        <div className="step-details-http-arrow">→</div>

        <div className="step-details-http-part">
          <div className="step-details-http-header step-details-http-response">
            <span className="step-details-http-status">{response.status}</span>
          </div>
          {response.body && (
            <div className="step-details-http-details">
              <div className="step-details-http-label">Response:</div>
              <CodeBlock content={response.body} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function StepDetailsSection({ step }) {
  if (!step) return null;

  const {
    number,
    title,
    timestamp,
    status,
    summary,
    expandedContent = {}
  } = step;

  const {
    what = '',
    httpRequest = null,
    httpResponse = null,
    tokenStructure = null,
    validationChecks = [],
    warnings = []
  } = expandedContent;

  return (
    <div className="step-details-container">
      <details className="step-details-element">
        {/* Summary (always visible) */}
        <summary className="step-details-summary">
          <div className="step-details-summary-content">
            <div className="step-details-step-number">{number}</div>
            <div className="step-details-step-info">
              <div className="step-details-step-title">{title}</div>
              <div className="step-details-step-meta">
                <span className="step-details-timestamp">
                  {timestamp}
                </span>
                <StatusBadge status={status} />
              </div>
            </div>
          </div>
          <div className="step-details-summary-indicator">
            <span className="step-details-toggle-icon">▶</span>
          </div>
        </summary>

        {/* Expanded content */}
        <div className="step-details-expanded">
          {/* Summary description */}
          {summary && (
            <div className="step-details-section">
              <div className="step-details-section-title">Summary</div>
              <p className="step-details-text">{summary}</p>
            </div>
          )}

          {/* What happens */}
          {what && (
            <div className="step-details-section">
              <div className="step-details-section-title">What Happens</div>
              <p className="step-details-text">{what}</p>
            </div>
          )}

          {/* HTTP Request/Response */}
          {httpRequest && httpResponse && (
            <HttpSection
              request={httpRequest}
              response={httpResponse}
              label="HTTP Request & Response"
            />
          )}

          {/* Token Structure */}
          {tokenStructure && (
            <div className="step-details-section">
              <div className="step-details-section-title">Token Structure</div>
              <div className="step-details-token-meta">
                <div className="step-details-token-meta-row">
                  <span className="step-details-label">Type:</span>
                  <span className="step-details-value">{tokenStructure.type}</span>
                </div>
                <div className="step-details-token-meta-row">
                  <span className="step-details-label">Role:</span>
                  <span className="step-details-value">{tokenStructure.role}</span>
                </div>
              </div>

              {tokenStructure.claims && (
                <div className="step-details-claims-section">
                  <div className="step-details-subsection-title">JWT Claims</div>
                  <ClaimsList claims={tokenStructure.claims} />
                </div>
              )}
            </div>
          )}

          {/* Validation Checks */}
          {validationChecks.length > 0 && (
            <div className="step-details-section">
              <div className="step-details-section-title">Validation Checks</div>
              <div className="step-details-checks">
                {validationChecks.map((check, idx) => (
                  <ValidityCheckRow key={idx} check={check} />
                ))}
              </div>
            </div>
          )}

          {/* Warnings */}
          {warnings.length > 0 && (
            <div className="step-details-section">
              <div className="step-details-section-title">Important Notes</div>
              <div className="step-details-warnings">
                {warnings.map((warning, idx) => (
                  <WarningRow key={idx} warning={warning} />
                ))}
              </div>
            </div>
          )}
        </div>
      </details>
    </div>
  );
}
