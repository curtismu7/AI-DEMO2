import React from 'react';
import './TRiSMSlide.css';

/**
 * Get a contextual hint for what the user can try in the live demo.
 */
function getDemoHint(liveDemo) {
  switch (liveDemo) {
    case 'trust':
      return 'Navigate to the Dashboard and click "Get Transactions" to see the Agent Flow Diagram light up with each step. Click "Show Tokens" to decode the claims.';
    case 'risk':
      return 'Go to Admin → Security Testing tab to run token validation scenarios against the MCP server. See how wrong tokens are rejected.';
    case 'security':
      return 'Click "Show Tokens" on any agent operation to see scope isolation between user and agent tokens. Compare what each identity can access.';
    case 'governance':
      return 'Go to Admin → Control Center to see the kill switch, consent controls, and forensic audit trail. Try the red button (demo mode).';
    case 'lifecycle':
      return 'Watch the Agent Flow Diagram during any operation — it shows real-time metrics, request traces, and health status for the agent.';
    case 'identity':
      return 'Compare the decoded user token vs agent token. Notice different scopes, audiences, and the act delegation claim that proves who acts for whom.';
    default:
      return 'Explore the demo to see this principle in action.';
  }
}

/**
 * TRiSMSlide — Renders a single AI TRiSM principle slide with:
 *   - Principle title and explanation
 *   - Feature cards showing how the demo meets the principle
 *   - Live demo hint section
 *
 * Props:
 *   slide — object from SLIDES array in TRiSMTrainingPanel
 */
export default function TRiSMSlide({ slide }) {
  if (!slide) return null;

  return (
    <div className="trism-slide">
      {/* Header */}
      <div className="trism-slide-header">
        <span className="trism-slide-icon">{slide.icon}</span>
        <div>
          <h3 className="trism-slide-title">
            Principle {slide.principleNumber}: {slide.title}
          </h3>
          <p className="trism-slide-subtitle">{slide.subtitle}</p>
        </div>
      </div>

      {/* What it means */}
      <div className="trism-slide-section">
        <h4>What it means</h4>
        <p className="trism-slide-explanation">{slide.whatItMeans}</p>
      </div>

      {/* How our demo meets it */}
      <div className="trism-slide-section">
        <h4>How our demo meets it</h4>
        <div className="trism-feature-list">
          {slide.howWeMeetIt.map((item, i) => (
            <div key={i} className="trism-feature-card">
              <div className="trism-feature-name">✓ {item.feature}</div>
              <div className="trism-feature-component">{item.component}</div>
              <div className="trism-feature-desc">{item.description}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Live Demo */}
      <div className="trism-slide-section trism-demo-section">
        <h4>🎬 Try it live</h4>
        <div className="trism-demo-placeholder">
          <p className="trism-demo-hint">
            {getDemoHint(slide.liveDemo)}
          </p>
        </div>
      </div>
    </div>
  );
}
