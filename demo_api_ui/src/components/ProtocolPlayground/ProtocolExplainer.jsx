import React from 'react';

/**
 * Spec context for the selected protocol — which document defines it, what
 * problem it solves, and why it matters once an AI agent is the one holding
 * the token. Renders nothing when a flow carries no spec metadata.
 */
export default function ProtocolExplainer({ spec }) {
  if (!spec) return null;

  return (
    <div className="pp-explainer">
      <div className="pp-explainer__spec">
        <a
          className="pp-explainer__badge"
          href={spec.url}
          target="_blank"
          rel="noreferrer noopener"
        >
          {spec.label}
        </a>
        <span className="pp-explainer__title">{spec.title}</span>
      </div>

      {spec.why && (
        <p className="pp-explainer__para">
          <span className="pp-explainer__lead">What it solves</span>
          {spec.why}
        </p>
      )}

      {spec.ai && (
        <p className="pp-explainer__para pp-explainer__para--ai">
          <span className="pp-explainer__lead">Why it matters for AI agents</span>
          {spec.ai}
        </p>
      )}
    </div>
  );
}
