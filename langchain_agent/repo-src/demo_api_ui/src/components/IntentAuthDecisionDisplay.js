import React from "react";
import "./IntentAuthDecisionDisplay.css";

/**
 * IntentAuthDecisionDisplay
 * Shows intent authorization decision details: confidence, risk score, authority score
 *
 * Props:
 *   decision — { intent, confidence, riskScore, authorityScore, recommendation, reason }
 *   compact — if true, shows minimal format; if false, detailed format
 */
export default function IntentAuthDecisionDisplay({ decision, compact = false }) {
  if (!decision) return null;

  const renderScoreBadge = (label, score, isUndefined = false) => {
    if (isUndefined || score === undefined) {
      return (
        <div className="iad-score-badge iad-score-badge--undefined">
          <span className="iad-score-label">{label}</span>
          <span className="iad-score-value">—</span>
        </div>
      );
    }

    const percentage = Math.round(score * 100);
    const bgColor =
      score > 0.7 ? "#10b981" : score > 0.5 ? "#f59e0b" : "#ef4444";

    return (
      <div className="iad-score-badge" style={{ "--score-bg": bgColor }}>
        <span className="iad-score-label">{label}</span>
        <span className="iad-score-value">{percentage}%</span>
      </div>
    );
  };

  if (compact) {
    return (
      <div className="iad-compact">
        <div className="iad-compact-row">
          <span className="iad-compact-label">Intent:</span>
          <span className="iad-compact-value">{decision.intent}</span>
        </div>
        <div className="iad-compact-row">
          <span className="iad-compact-label">Confidence:</span>
          <span className="iad-compact-value">
            {Math.round(decision.confidence * 100)}%
          </span>
        </div>
        {decision.riskScore !== undefined && (
          <div className="iad-compact-row">
            <span className="iad-compact-label">Risk:</span>
            <span className="iad-compact-value">
              {Math.round(decision.riskScore * 100)}%
            </span>
          </div>
        )}
        {decision.reason && (
          <div className="iad-compact-reason">{decision.reason}</div>
        )}
      </div>
    );
  }

  return (
    <div className="iad-container">
      <div className="iad-header">
        <h4 className="iad-title">Intent Authorization Analysis</h4>
      </div>

      <div className="iad-intent-section">
        <div className="iad-intent-label">Parsed Intent:</div>
        <div className="iad-intent-value">{decision.intent}</div>
      </div>

      <div className="iad-scores-grid">
        {renderScoreBadge("Confidence", decision.confidence)}
        {renderScoreBadge("Risk", decision.riskScore)}
        {renderScoreBadge(
          "Authority",
          decision.authorityScore,
          decision.authorityScore === undefined
        )}
      </div>

      {decision.reason && (
        <div className="iad-reason-section">
          <div className="iad-reason-label">Decision:</div>
          <div className="iad-reason-text">{decision.reason}</div>
        </div>
      )}

      {decision.recommendation && (
        <div className="iad-recommendation">
          <strong>Recommendation: </strong>
          {decision.recommendation === "permit" && (
            <span className="iad-recommendation--permit">✅ PERMIT</span>
          )}
          {decision.recommendation === "deny" && (
            <span className="iad-recommendation--deny">❌ DENY</span>
          )}
          {decision.recommendation === "consent_required" && (
            <span className="iad-recommendation--consent">
              ☑️ CONSENT REQUIRED
            </span>
          )}
        </div>
      )}
    </div>
  );
}
