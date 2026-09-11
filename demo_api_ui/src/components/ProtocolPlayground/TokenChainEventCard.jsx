import React from 'react';
import './TokenChainEventCard.css';

const STATUS_ICONS = {
  success: '✓',
  permit: '✓',
  deny: '✕',
  error: '❌',
  pending: '⚠️'
};

/** Status chip shared by the event card and ActivityPanel's chain rows. */
export function StatusBadge({ status }) {
  if (!status) return null;
  return <span className={`event-status event-status--${status}`}>{STATUS_ICONS[status] || status}</span>;
}

/**
 * Card-based display of a token-chain event (real or synthesized from step result).
 * Reuses Token Chain visual language via shared CSS classes.
 */
export default function TokenChainEventCard({ event }) {
  if (!event) return null;

  return (
    <div className="token-chain-event-card">
      <div className="event-card-header">
        <div className="event-card-label">
          {event.label || 'Step'}
        </div>
        <StatusBadge status={event.status} />
      </div>

      {event.explanation && (
        <div className="event-card-explanation">
          {event.explanation}
        </div>
      )}

      {event.claims && event.claims.length > 0 && (
        <div className="event-card-claims">
          {event.claims.map((claim, idx) => (
            <div key={idx} className="claim-row">
              <span className="claim-key">{claim.key}</span>
              <span className="claim-value">{claim.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
