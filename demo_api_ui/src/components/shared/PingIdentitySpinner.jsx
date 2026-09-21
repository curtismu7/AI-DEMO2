import React from 'react';
import './LoadingOverlay.css';

/**
 * Shared Ping identity loading mark.
 *
 * The mark stays recognizable at overlay and inline sizes. The motion is a
 * small lift/tilt/pulse rather than a generic circular loader, and the global
 * reduced-motion rule leaves the identity visible without animating it.
 */
export default function PingIdentitySpinner({
  label,
  size = 88,
  className = '',
  ...ariaProps
}) {
  const isDecorative = ariaProps['aria-hidden'] === true || ariaProps['aria-hidden'] === 'true';
  const rootClassName = `ping-spinner ${className}`.trim();

  return (
    <span
      className={rootClassName}
      style={{ '--ping-spinner-size': `${size}px` }}
      role={isDecorative ? undefined : 'status'}
      aria-live={isDecorative ? undefined : 'polite'}
      aria-label={isDecorative ? undefined : (label || 'Loading')}
      {...ariaProps}
    >
      <span className="ping-spinner__ring ping-spinner__ring--outer" aria-hidden="true" />
      <span className="ping-spinner__ring ping-spinner__ring--inner" aria-hidden="true" />
      <svg className="ping-spinner__mark" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
        <rect width="64" height="64" rx="14" fill="currentColor" />
        <text x="32" y="42" textAnchor="middle" fontFamily="system-ui, -apple-system, sans-serif" fontSize="30" fontWeight="800" fill="#fff">P</text>
      </svg>
      {label && <span className="ping-spinner__label">{label}</span>}
    </span>
  );
}
