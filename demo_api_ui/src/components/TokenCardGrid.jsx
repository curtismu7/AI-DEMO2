/**
 * TokenCardGrid — 3-column card grid for User/Agent/MCP tokens
 * - Responsive: 3 cols (desktop) → 2 cols (tablet) → 1 col (mobile)
 * - Color-coded borders: User pink, Agent purple, MCP green
 * - Shows abbreviated claims on each card
 * - "Inspect" buttons open claims modal
 */
import React, { useState } from 'react';
import './TokenCardGrid.css';

const TOKEN_TYPES = {
  user: {
    id: 'user',
    label: 'User Token',
    color: '#ec4899', // pink
    icon: '👤',
    description: 'Customer access token (RFC 6749 §6.3)',
  },
  agent: {
    id: 'agent',
    label: 'Agent Token',
    color: '#9333ea', // purple
    icon: '🤖',
    description: 'BFF-delegated MCP token (RFC 8693 §4)',
  },
  mcp: {
    id: 'mcp',
    label: 'MCP Token',
    color: '#10b981', // green
    icon: '🔐',
    description: 'Resource-scoped access token (RFC 8707)',
  },
};

const ABBREVIATED_CLAIMS = ['sub', 'aud', 'scope', 'act', 'exp'];

function abbreviateClaim(key, value) {
  if (!value) return null;

  // Handle arrays and objects
  if (Array.isArray(value)) {
    return value.join(', ').substring(0, 40);
  }
  if (typeof value === 'object') {
    return JSON.stringify(value).substring(0, 40);
  }

  const str = String(value);

  // Truncate long strings
  if (str.length > 40) {
    return str.substring(0, 37) + '…';
  }

  return str;
}

function TokenCardGridItem({ type, tokenData = null, onInspect }) {
  const typeConfig = TOKEN_TYPES[type];
  if (!typeConfig) return null;

  const claims = tokenData?.payload || {};
  const presentClaims = ABBREVIATED_CLAIMS.filter(
    (k) => claims[k] !== undefined && claims[k] !== null
  );

  return (
    <div className="tcg-card" data-token-type={type}>
      <div
        className="tcg-card__header"
        style={{ borderLeftColor: typeConfig.color }}
      >
        <div className="tcg-card__header-content">
          <span className="tcg-card__icon">{typeConfig.icon}</span>
          <div className="tcg-card__titles">
            <h3 className="tcg-card__title">{typeConfig.label}</h3>
            <p className="tcg-card__description">{typeConfig.description}</p>
          </div>
        </div>
      </div>

      <div className="tcg-card__body">
        {presentClaims.length > 0 ? (
          <div className="tcg-card__claims">
            {presentClaims.map((key) => {
              const value = claims[key];
              const abbreviated = abbreviateClaim(key, value);
              return abbreviated ? (
                <div key={key} className="tcg-card__claim-row">
                  <span className="tcg-card__claim-key">{key}:</span>
                  <code className="tcg-card__claim-value" title={String(value)}>
                    {abbreviated}
                  </code>
                </div>
              ) : null;
            })}
          </div>
        ) : (
          <div className="tcg-card__empty">No claims available</div>
        )}
      </div>

      <div className="tcg-card__footer">
        <button
          className="tcg-card__inspect-btn"
          onClick={() => onInspect(type, tokenData)}
          aria-label={`Inspect ${typeConfig.label}`}
        >
          Inspect
        </button>
      </div>
    </div>
  );
}


/**
 * TokenCardGrid — 3-column responsive grid of token cards
 *
 * Props:
 *  - userToken: decoded user token object { payload: {...} }
 *  - agentToken: decoded agent token object { payload: {...} }
 *  - mcpToken: decoded MCP token object { payload: {...} }
 *  - onInspectToken: callback(type, tokenData) fired when Inspect button clicked
 */
export default function TokenCardGrid({
  userToken = null,
  agentToken = null,
  mcpToken = null,
  onInspectToken = () => {},
}) {
  const [hoveredCard, setHoveredCard] = useState(null);

  const handleInspect = (type, tokenData) => {
    onInspectToken(type, tokenData);
  };

  return (
    <div
      className="tcg-grid"
      onMouseLeave={() => setHoveredCard(null)}
    >
      <TokenCardGridItem
        type="user"
        tokenData={userToken}
        onInspect={handleInspect}
      />
      <TokenCardGridItem
        type="agent"
        tokenData={agentToken}
        onInspect={handleInspect}
      />
      <TokenCardGridItem
        type="mcp"
        tokenData={mcpToken}
        onInspect={handleInspect}
      />
    </div>
  );
}

