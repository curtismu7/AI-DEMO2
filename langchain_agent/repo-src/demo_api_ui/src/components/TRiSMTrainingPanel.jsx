import React, { useState, useEffect, useCallback } from 'react';
import TRiSMSlide from './TRiSMSlide';
import './TRiSMTrainingPanel.css';

/**
 * SLIDES — All six AI TRiSM principles with demo content.
 * Each slide maps a Gartner principle to real features in the banking demo.
 */
const SLIDES = [
  {
    id: 'trust',
    principleNumber: 1,
    title: 'Trust & Transparency',
    subtitle: 'Make AI explainable and auditable',
    icon: '🔍',
    whatItMeans: 'Users understand what the agent is doing. Agent behavior is explainable and auditable. Clear lineage from request → decision → action.',
    howWeMeetIt: [
      { feature: 'Agent Flow Diagram', component: 'AgentFlowDiagramPanel', description: 'Visual step-by-step trace of agent execution: user request → token exchange → MCP call → tool execution' },
      { feature: 'Token Chain Display', component: 'TokenChainDisplay', description: 'Decode and show all tokens used in the delegation chain with sub, act, aud, scope claims' },
      { feature: 'Transparent Errors', component: 'Phase 156', description: 'Educational error messages explain WHY operations fail — not just error codes' },
      { feature: 'Audit Logs', component: 'AgentFlowDiagramService', description: 'Every action logged with context: timestamp, actor, claims, result' }
    ],
    liveDemo: 'trust'
  },
  {
    id: 'risk',
    principleNumber: 2,
    title: 'Risk Management & Assurance',
    subtitle: 'Test failures, cap blast radius, monitor in real-time',
    icon: '⚠️',
    whatItMeans: 'Identify potential failures (bias, drift, cascade errors). Test and validate agent behavior. Monitor for anomalies in real-time.',
    howWeMeetIt: [
      { feature: 'Token Validation Tests', component: 'TokenSecurityTester', description: 'Try sending wrong tokens to MCP — see scope/audience rejection' },
      { feature: 'Rate Limiting', component: 'agentRateLimitMiddleware', description: 'Prevent cascade errors: 10 requests/min cap, auto-kill after 5 violations' },
      { feature: 'State Capture', component: 'killSwitchService', description: 'Freeze agent state on failure for forensic analysis' },
      { feature: 'Error Scenarios', component: 'Admin Security Tab', description: 'Run all 5 failure scenarios to validate security controls' }
    ],
    liveDemo: 'risk'
  },
  {
    id: 'security',
    principleNumber: 3,
    title: 'Security & Privacy by Design',
    subtitle: 'Encrypt everything, validate all tokens, minimize access',
    icon: '🔒',
    whatItMeans: 'Protect data flowing through the system. Prevent prompt injection, token theft, data exfiltration. Use encryption and secure channels.',
    howWeMeetIt: [
      { feature: 'Token Scope Isolation', component: 'Middleware', description: 'User tokens access user resources; agent tokens access agent resources — never mixed' },
      { feature: 'Delegation Chain', component: 'RFC 8693', description: 'act claim proves agent acts ON BEHALF of user, not AS user' },
      { feature: 'Session Security', component: 'sessionResolver', description: 'HTTP-only cookies prevent XSS access to tokens' },
      { feature: 'Data Minimization', component: 'may_act claim', description: 'Agent only sees data it needs for the specific operation' }
    ],
    liveDemo: 'security'
  },
  {
    id: 'governance',
    principleNumber: 4,
    title: 'Governance, Compliance & Accountability',
    subtitle: 'Define policies, roles, guardrails with human oversight',
    icon: '📋',
    whatItMeans: 'Define who can build, deploy, and use AI. Clear policies and roles. Audit trail for compliance — regulators, auditors, legal.',
    howWeMeetIt: [
      { feature: 'Admin Console', component: '/admin', description: 'Central control point for policies, settings, and agent management' },
      { feature: 'Kill Switch', component: 'RedButton', description: 'Emergency override: reason-tracked, logged, irreversible revocation' },
      { feature: 'User Consent', component: 'AgentConsentModal', description: 'User explicitly approves agent actions — consent logged in audit trail' },
      { feature: 'Immutable Audit', component: 'auditLogService', description: 'Compliance-grade logging: who, what, when, why — append-only' }
    ],
    liveDemo: 'governance'
  },
  {
    id: 'lifecycle',
    principleNumber: 5,
    title: 'Lifecycle Management & Observability',
    subtitle: 'Treat agent as a live product with continuous monitoring',
    icon: '🔄',
    whatItMeans: 'Treat AI like a product: requirements → build → test → deploy → monitor → retire. Continuous observability with logs, metrics, traces, feedback.',
    howWeMeetIt: [
      { feature: 'Health Metrics', component: 'AgentFlowDiagramPanel', description: 'Real-time request count, error rate, latency monitoring' },
      { feature: 'Request Tracing', component: 'agentFlowDiagramService', description: 'Full request trace from entry to MCP tool execution' },
      { feature: 'Smart Alerts', component: 'Rate limit violations', description: 'Anomalies trigger auto-kill + alert for immediate response' },
      { feature: 'Token Lifecycle', component: 'Token refresh', description: 'Monitor token freshness, refresh before expiry, track age' }
    ],
    liveDemo: 'lifecycle'
  },
  {
    id: 'identity',
    principleNumber: 6,
    title: 'Identity, Access & Least Privilege',
    subtitle: 'Agent = first-class identity with minimal permissions',
    icon: '🪪',
    whatItMeans: 'Agent is a first-class identity (like a user). Strong authentication via OAuth. Least privilege: agent only accesses what it needs — never more.',
    howWeMeetIt: [
      { feature: 'Agent as Identity', component: 'PingOne', description: 'Registered as separate application with own Client ID in PingOne' },
      { feature: 'OAuth (Not Password)', component: 'Client Credentials', description: 'Agent uses client_id + client_secret — never user passwords' },
      { feature: 'Scoped Tokens', component: 'Token validation', description: 'Agent limited to agent, mcp:* scopes — no profile, no read' },
      { feature: 'Delegation Proof', component: 'Token Exchange', description: 'act = who acts, sub = on whose behalf, aud = where it can be used' }
    ],
    liveDemo: 'identity'
  }
];

/**
 * TRiSMTrainingPanel — Slide-out panel teaching AI TRiSM principles with
 * references to real features in the banking demo.
 *
 * Props:
 *   isOpen  — controls visibility
 *   onClose — callback to close the panel
 */
export default function TRiSMTrainingPanel({ isOpen, onClose }) {
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const [showGlossary, setShowGlossary] = useState(false);

  const goPrev = useCallback(() => {
    setActiveSlideIndex(i => Math.max(0, i - 1));
    setShowGlossary(false);
  }, []);

  const goNext = useCallback(() => {
    setActiveSlideIndex(i => Math.min(SLIDES.length - 1, i + 1));
    setShowGlossary(false);
  }, []);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') goPrev();
      else if (e.key === 'ArrowRight') goNext();
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose, goPrev, goNext]);

  if (!isOpen) return null;

  return (
    <div className="trism-panel-overlay" onClick={onClose}>
      <div className="trism-panel" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="trism-panel-header">
          <div className="trism-panel-header-left">
            <h2>📚 AI TRiSM Training</h2>
            <p className="trism-panel-subtitle">Trust, Risk &amp; Security Management for AI Agents</p>
          </div>
          <div className="trism-panel-header-right">
            <button
              className={`trism-glossary-toggle ${showGlossary ? 'active' : ''}`}
              onClick={() => setShowGlossary(!showGlossary)}
              aria-label="Toggle glossary"
            >
              📖 Glossary
            </button>
            <button className="trism-panel-close" onClick={onClose} aria-label="Close training panel">
              &times;
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="trism-panel-content">
          {showGlossary
            ? <TRiSMGlossaryInline />
            : <TRiSMSlide slide={SLIDES[activeSlideIndex]} />
          }
        </div>

        {/* Footer Navigation */}
        {!showGlossary && (
          <div className="trism-panel-footer">
            <button
              onClick={goPrev}
              disabled={activeSlideIndex === 0}
              className="trism-nav-btn trism-nav-prev"
            >
              ← Previous
            </button>

            <div className="trism-nav-dots">
              {SLIDES.map((s, i) => (
                <button
                  key={s.id}
                  className={`trism-dot ${i === activeSlideIndex ? 'active' : ''}`}
                  onClick={() => setActiveSlideIndex(i)}
                  aria-label={`Go to slide ${i + 1}: ${s.title}`}
                  title={s.title}
                >
                  {s.icon}
                </button>
              ))}
            </div>

            <button
              onClick={goNext}
              disabled={activeSlideIndex === SLIDES.length - 1}
              className="trism-nav-btn trism-nav-next"
            >
              Next →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Inline glossary (kept in same file to avoid circular dependency issues
 * with Plan 02 integration). Can be extracted later if needed.
 */
function TRiSMGlossaryInline() {
  const terms = [
    { term: 'AI TRiSM', definition: 'AI Trust, Risk and Security Management — Gartner\'s framework for making AI systems reliable, secure, and governed.' },
    { term: 'Trust & Transparency', definition: 'Making AI decisions explainable, auditable, and understandable to stakeholders.' },
    { term: 'Risk Management', definition: 'Identifying, assessing, and mitigating potential AI failures including bias, drift, and cascade errors.' },
    { term: 'Security by Design', definition: 'Building security into AI systems from the start: encryption, scope isolation, data minimization.' },
    { term: 'Governance', definition: 'Policies, roles, and guardrails that define who can build, deploy, and use AI systems.' },
    { term: 'Lifecycle Management', definition: 'Treating AI as a product with requirements, testing, deployment, monitoring, and retirement phases.' },
    { term: 'Least Privilege', definition: 'Granting only the minimum permissions needed. Agents get agent scopes, not user scopes.' },
    { term: 'Token Exchange', definition: 'RFC 8693 mechanism where an agent exchanges its token + user token for a delegated token with act claim.' },
    { term: 'Delegation Chain', definition: 'Cryptographic proof that Agent X is acting on behalf of User Y, visible in the act JWT claim.' },
    { term: 'Kill Switch', definition: 'Emergency mechanism to immediately revoke an agent\'s OAuth credentials and freeze its state.' },
    { term: 'Rate Limiting', definition: 'Capping the number of requests per time window to prevent cascade failures and resource exhaustion.' },
    { term: 'Audit Trail', definition: 'Immutable log of all sensitive operations — who did what, when, and why — for compliance and forensics.' },
    { term: 'PKCE', definition: 'Proof Key for Code Exchange — prevents authorization code interception in OAuth flows.' },
    { term: 'MCP', definition: 'Model Context Protocol — standard for AI agents to discover and call tools via a secure server.' },
    { term: 'BFF', definition: 'Backend for Frontend — server-side proxy that keeps tokens and secrets away from the browser.' },
    { term: 'act Claim', definition: 'JWT claim identifying the actor (agent) in a delegation scenario. Proves who is performing the action.' },
    { term: 'may_act Claim', definition: 'JWT claim specifying which agents are authorized to act on behalf of a user.' },
    { term: 'Scope Isolation', definition: 'Ensuring user tokens and agent tokens have different, non-overlapping permission sets.' }
  ];

  return (
    <div className="trism-glossary">
      <h4>📖 AI TRiSM Glossary</h4>
      <p className="trism-glossary-intro">
        Key terms used throughout this training and the banking demo.
      </p>
      <dl className="trism-glossary-list">
        {terms.map(item => (
          <div key={item.term} className="trism-glossary-entry">
            <dt className="trism-glossary-term">{item.term}</dt>
            <dd className="trism-glossary-def">{item.definition}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
