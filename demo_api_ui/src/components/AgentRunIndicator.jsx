import React from 'react';
import PingIdentitySpinner from './shared/PingIdentitySpinner';

/**
 * The agent's "still working" bubble: the dancing red Ping P from the shared
 * spinner plus a short note saying what it is doing (one mark, one note). It
 * replaces the three typing dots, so every wait in the agent looks the same.
 * The mark is decorative; the note is the one status for assistive tech.
 */
export function AgentWorkingMark({ label = 'Working…' }) {
  return (
    <div className="banking-agent-msg-bubble ba-run-indicator" role="status" aria-live="polite">
      <PingIdentitySpinner size={36} label={label} aria-hidden="true" />
      <span className="ba-run-indicator__label">{label}</span>
    </div>
  );
}

/**
 * A full assistant-side row for a run the agent started (the A2A access review,
 * the agent chain) that is still working; the reel fills as hops arrive.
 */
export default function AgentRunIndicator({ label }) {
  return (
    <div className="banking-agent-msg assistant typing" data-testid="agent-run-indicator">
      <div>
        <AgentWorkingMark label={label} />
      </div>
    </div>
  );
}
