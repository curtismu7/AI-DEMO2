// banking_api_ui/src/components/shared/InlineSpinner.js
import React from 'react';
import './LoadingOverlay.css';

/**
 * Lightweight inline spinner for use inside modals, cards, and tables.
 * Shares the .lo-spinner ring animation from LoadingOverlay.css.
 *
 * @param {object}  props
 * @param {string}  [props.label]  - Optional text label beside the spinner
 * @param {string}  [props.color]  - Override spinner color (default blue)
 * @param {string}  [props.size]   - 'sm' (default, 20px) | 'md' (28px)
 */
export default function InlineSpinner({ label, color = 'var(--brand-navy)', size = 'sm' }) {
  const dimension = size === 'md' ? 28 : 20;
  return (
    <span
      style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
      role="status"
      aria-label={label || 'Loading'}
    >
      <span
        className="lo-spinner"
        aria-hidden="true"
        style={{
          width: dimension,
          height: dimension,
          borderTopColor: color,
          flexShrink: 0,
        }}
      />
      {label && (
        <span style={{ fontSize: '0.875rem', color: '#374151' }}>{label}</span>
      )}
    </span>
  );
}
