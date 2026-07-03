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
 * ClaimDetailsModal
 * @param {boolean} isOpen - Whether the modal is visible
 * @param {string} tokenType - Token type: 'user', 'agent', or 'mcp'
 * @param {function} onClose - Callback when modal should close
 */
function ClaimDetailsModal({ isOpen, tokenType, onClose }) {
  if (!isOpen) return null;

  const claims = TOKEN_CLAIMS[tokenType] || [];
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
          <h2 className="utfi-modal-title">{title}</h2>
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
