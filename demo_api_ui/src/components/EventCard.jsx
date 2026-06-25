// demo_api_ui/src/components/EventCard.jsx
import React, { useState } from 'react';
import './EventCard.css';

const BADGE_TYPES = new Set([
  'user_request',
  'agent_thinking',
  'tool_call',
  'token_exchange',
  'result',
  'error',
]);

function badgeClass(type) {
  return BADGE_TYPES.has(type) ? `ec-badge--${type}` : 'ec-badge--unknown';
}

function badgeLabel(type) {
  return (type || 'unknown').replace(/_/g, ' ');
}

function formatTime(isoString) {
  if (!isoString) return '';
  try {
    return new Date(isoString).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return isoString;
  }
}

function serializeDetails(details) {
  if (details === undefined || details === null) return null;
  if (typeof details === 'string') return details;
  try {
    return JSON.stringify(details, null, 2);
  } catch {
    return String(details);
  }
}

/**
 * Renders a single stream event with a badge, plain-English message,
 * and an optional collapsible technical-details section.
 *
 * @param {{ event: import('../context/EventStreamContext').StreamEvent }} props
 */
export default function EventCard({ event }) {
  const [expanded, setExpanded] = useState(false);

  const { type, timestamp, message, details } = event;
  const detailsText = serializeDetails(details);
  const hasDetails = detailsText !== null;

  return (
    <div className={`ec-card${type === 'error' ? ' ec-card--error' : ''}`} data-event-type={type}>
      <div
        className="ec-header"
        onClick={hasDetails ? () => setExpanded((v) => !v) : undefined}
        role={hasDetails ? 'button' : undefined}
        tabIndex={hasDetails ? 0 : undefined}
        aria-expanded={hasDetails ? expanded : undefined}
        onKeyDown={hasDetails ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded((v) => !v); } } : undefined}
      >
        <span className="ec-timestamp">{formatTime(timestamp)}</span>
        <span className={`ec-badge ${badgeClass(type)}`}>{badgeLabel(type)}</span>
        <span className="ec-message">{message}</span>
        {hasDetails && (
          <span className={`ec-toggle${expanded ? ' ec-toggle--open' : ''}`} aria-hidden>▼</span>
        )}
      </div>

      {hasDetails && expanded && (
        <div className="ec-details">
          <pre>{detailsText}</pre>
        </div>
      )}
    </div>
  );
}
