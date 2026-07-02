import React from 'react';
import { createPortal } from 'react-dom';
import '../styles/TokenChainRedesign.css';

/**
 * TokenLegendModal - Modal popup displaying token type legend
 *
 * Renders a 3-column grid of token types with color swatches:
 * - User Token: Customer access token from PingOne (Pink gradient)
 * - Agent Token: BFF-delegated token via RFC 8693 (Purple gradient)
 * - MCP Token: Resource-scoped access token (Green gradient)
 *
 * Props:
 * - isOpen (bool): Controls modal visibility
 * - onClose (function): Callback when modal is closed (overlay click or × button)
 */
export default function TokenLegendModal({ isOpen, onClose }) {
  if (!isOpen) return null;

  const legendItems = [
    {
      id: 'user',
      title: 'User Token',
      description: 'Customer access token from PingOne',
      gradientClass: 'tlm-swatch--user',
    },
    {
      id: 'agent',
      title: 'Agent Token',
      description: 'BFF-delegated token via RFC 8693',
      gradientClass: 'tlm-swatch--agent',
    },
    {
      id: 'mcp',
      title: 'MCP Token',
      description: 'Resource-scoped access token',
      gradientClass: 'tlm-swatch--mcp',
    },
  ];

  const handleOverlayClick = (e) => {
    // Only close if clicking the overlay itself, not the modal content
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const modal = (
    <div className="tlm-overlay" onClick={handleOverlayClick}>
      <div className="tlm-modal-content">
        <div className="tlm-modal-header">
          <h2 className="tlm-modal-title">Token Legend</h2>
          <button
            className="tlm-close-btn"
            onClick={onClose}
            aria-label="Close modal"
            title="Close (Esc)"
          >
            ×
          </button>
        </div>

        <div className="tlm-modal-body">
          <div className="tlm-legend-grid">
            {legendItems.map(item => (
              <div key={item.id} className="tlm-legend-item">
                <div className={`tlm-swatch ${item.gradientClass}`}></div>
                <div className="tlm-item-title">{item.title}</div>
                <div className="tlm-item-description">{item.description}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
