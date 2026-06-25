import React from 'react';

/**
 * Derives token category from a label string or event metadata.
 * Returns 'subject' | 'actor' | 'mcp' | null
 */
export function deriveTokenCategory(label, eventId, eventTokenType) {
  // Priority 1: event.id (most reliable for token chain events)
  if (eventId === 'user-token') return 'subject';
  if (eventId === 'agent-actor-token') return 'actor';
  if (eventId === 'exchanged-token' || eventId === 'exchanged-token-fallback') return 'mcp';
  if (eventId === 'exchange-in-progress' || eventId === 'exchange-failed') return 'mcp';

  // Priority 2: event.tokenType from backend
  if (eventTokenType === 'user' || eventTokenType === 'subject') return 'subject';
  if (eventTokenType === 'agent' || eventTokenType === 'actor') return 'actor';
  if (eventTokenType === 'mcp' || eventTokenType === 'gateway') return 'mcp';

  // Priority 3: label string analysis (fallback for DecodedTokenPanel etc.)
  if (label) {
    const l = label.toLowerCase();
    if (l.startsWith('subject:') || l.includes('subject')) return 'subject';
    if (l.startsWith('actor:') || l.includes('actor')) return 'actor';
    if (l.includes('mcp') || l.includes('gateway')) return 'mcp';
    if (l.includes('agent')) return 'actor';
    if (l.includes('worker')) return 'actor';
  }

  return null;
}

const TOKEN_COLORS = {
  subject: '#dc2626',
  actor: '#2563eb',
  mcp: '#16a34a',
};

const TOKEN_LABELS = {
  subject: 'Subject Token (RFC 8693 §2.1)',
  actor: 'Actor Token (RFC 8693 §2.2)',
  mcp: 'MCP-Scoped Access Token (RFC 8693 §3.2)',
};

/**
 * Small colored dot indicating token type.
 * @param {{ type: 'subject'|'actor'|'mcp'|null, size?: number }} props
 */
export function TokenColorDot({ type, size = 10 }) {
  if (!type || !TOKEN_COLORS[type]) return null;
  return (
    <span
      className={`token-color-dot token-color-dot--${type}`}
      title={TOKEN_LABELS[type]}
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: '50%',
        backgroundColor: TOKEN_COLORS[type],
        flexShrink: 0,
        marginRight: 6,
      }}
      aria-label={TOKEN_LABELS[type]}
    />
  );
}

/**
 * Compact inline legend showing all three token color indicators.
 */
export function TokenColorLegend() {
  return (
    <div className="token-color-legend" style={{
      display: 'flex',
      flexWrap: 'wrap',
      gap: '0.5rem 1rem',
      alignItems: 'center',
      padding: '0.4rem 0.75rem',
      fontSize: '0.76rem',
      color: '#374151',
      borderBottom: '1px solid #1e293b',
    }}>
      <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>Token Types:</span>
      {Object.entries(TOKEN_COLORS).map(([type, color]) => (
        <span key={type} style={{ display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
          <span style={{
            display: 'inline-block',
            flexShrink: 0,
            width: 8,
            height: 8,
            borderRadius: '50%',
            backgroundColor: color,
          }} />
          <span>{TOKEN_LABELS[type]}</span>
        </span>
      ))}
    </div>
  );
}

/** Returns the hex color for a token category (for use in non-React contexts like HTML templates). */
export function getTokenColor(type) {
  return TOKEN_COLORS[type] || null;
}
