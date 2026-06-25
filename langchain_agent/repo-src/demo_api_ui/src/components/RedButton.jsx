/**
 * RedButton.jsx
 * 
 * AI Safety Red Button Component
 * Large, prominent red circle for stopping agents
 */

import React from 'react';
import './RedButton.css';

/**
 * RedButton Component
 * @param {string} agentId - ID of agent to stop
 * @param {boolean} isRevoked - Is agent already revoked?
 * @param {Function} onKillClick - Callback when clicked
 */
export default function RedButton({ agentId, isRevoked, onKillClick }) {
  const handleClick = () => {
    if (!isRevoked && onKillClick) {
      onKillClick();
    }
  };

  return (
    <div className="red-button-container">
      <button
        className="red-button"
        onClick={handleClick}
        disabled={isRevoked}
        aria-label={isRevoked ? 'Agent already revoked' : 'Stop agent immediately'}
        title={isRevoked ? 'Agent already revoked' : 'Stop agent immediately (irreversible)'}
      >
        <span className="red-button-icon">🔴</span>
        <span className="red-button-label">STOP AGENT</span>
      </button>
      {isRevoked && (
        <div className="red-button-status">
          <span className="status-badge revoked">REVOKED</span>
        </div>
      )}
    </div>
  );
}
