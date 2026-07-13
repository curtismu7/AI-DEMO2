/**
 * ClaimDetailsModal Component
 * Displays JWT claims for a specific token type (user, agent, mcp)
 * Renders claims dynamically based on tokenType prop
 */
import React from 'react';
import { createPortal } from 'react-dom';
import { TOKEN_CLAIMS } from '../constants/tokenClaims';
import '../styles/TokenChainRedesign.css';

/**
 * Builds the claim rows to render. With no live claims (or an empty object),
 * returns the static educational example set unchanged — same as before this
 * function existed. With live claims, shows only the fields actually present
 * on this run's token (real values), pairing each with the static RFC
 * description when we have one for that key, so the teaching content survives
 * without ever putting a canned example value next to a real token.
 */
function buildClaimRows(tokenType, liveClaims) {
  const staticClaims = TOKEN_CLAIMS[tokenType] || [];
  if (!liveClaims || typeof liveClaims !== "object" || Object.keys(liveClaims).length === 0) {
    return { claims: staticClaims, isLive: false };
  }
  const descriptionByKey = new Map(staticClaims.map((c) => [c.key, c.description]));
  const claims = Object.entries(liveClaims).map(([key, value]) => ({
    key,
    value: value && typeof value === "object" ? JSON.stringify(value) : String(value),
    description: descriptionByKey.get(key) || "Live value from this run.",
  }));
  return { claims, isLive: true };
}

/**
 * ClaimDetailsModal
 * @param {boolean} isOpen - Whether the modal is visible
 * @param {string} tokenType - Token type: 'user', 'agent', or 'mcp'
 * @param {Object} [liveClaims] - This run's real claims for tokenType, e.g.
 *   { sub, aud, scope, act, ... }. When omitted/empty, falls back to the
 *   static educational example set for tokenType.
 * @param {function} onClose - Callback when modal should close
 */
function ClaimDetailsModal({ isOpen, tokenType, liveClaims, onClose }) {
  if (!isOpen) return null;

  const { claims, isLive } = buildClaimRows(tokenType, liveClaims);
  const titleMap = {
    user: 'User Token Claims',
    agent: 'Agent Token Claims',
    mcp: 'MCP Token Claims',
  };
  const title = titleMap[tokenType] || 'Token Claims';

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const modalContent = (
    <div className="utfi-modal-backdrop" onClick={handleBackdropClick}>
      <div className="utfi-modal-container">
        <div className="utfi-modal-header">
          <div className="utfi-modal-title-group">
            <h2 className="utfi-modal-title">{title}</h2>
            {isLive && <span className="utfi-modal-live-badge">Live — this run</span>}
          </div>
          <button
            className="utfi-modal-close"
            onClick={onClose}
            aria-label="Close modal"
          >
            ×
          </button>
        </div>
        <div className="utfi-modal-body">
          <div className="utfi-claims-list">
            {claims.map((claim, index) => (
              <div key={index} className="utfi-claim-item">
                <div className="utfi-claim-key">{claim.key}</div>
                <div className="utfi-claim-value">{claim.value}</div>
                <div className="utfi-claim-description">{claim.description}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="utfi-modal-footer">
          <button
            className="utfi-modal-button utfi-modal-button--primary"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}

export default ClaimDetailsModal;
