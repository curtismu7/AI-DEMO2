import React from 'react';
import './TokenChainEventCard.css';

/**
 * Card-based display of a token-chain event (real or synthesized from step result).
 * Reuses Token Chain visual language via shared CSS classes.
 */
export default function TokenChainEventCard({ event }) {
  if (!event) return null;

  const statusBadge = () => {
    if (!event.status) return null;
    const icons = {
      success: '✓',
      permit: '✓',
      deny: '✕',
      error: '❌',
      pending: '⏳'
    };
    const icon = icons[event.status] || event.status;
    return <span className={`event-status event-status--${event.status}`}>{icon}</span>;
  };

  return (
    <div className="token-chain-event-card">
      <div className="event-card-header">
        <div className="event-card-label">
          {event.label || 'Step'}
        </div>
        {statusBadge()}
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
