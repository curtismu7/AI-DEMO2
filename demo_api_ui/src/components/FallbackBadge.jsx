import React, { useState } from 'react';
import './FallbackBadge.css';

/**
 * Lightweight fallback mode indicator badge
 * Shows when manifest failed to load and we're using vertical-inferred fallback chips
 */
export default function FallbackBadge({ isFallback, verticalId, onDismiss }) {
  const [visible, setVisible] = useState(isFallback);

  if (!visible || !isFallback) return null;

  const handleDismiss = () => {
    setVisible(false);
    if (onDismiss) onDismiss();
  };

  const verticalLabel = verticalId
    ? verticalId.replace('-', ' ').charAt(0).toUpperCase() + verticalId.replace('-', ' ').slice(1)
    : 'Unknown';

  return (
    <div className="fallback-badge" role="alert" aria-live="polite">
      <span className="fallback-badge-text">
        ⚠️ Fallback mode ({verticalLabel}) — fix manifest loading
      </span>
      <button
        className="fallback-badge-close"
        onClick={handleDismiss}
        aria-label="Dismiss fallback badge"
      >
        ×
      </button>
    </div>
  );
}
