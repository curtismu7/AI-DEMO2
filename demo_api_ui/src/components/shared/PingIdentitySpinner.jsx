import React from 'react';
import './LoadingOverlay.css';

const DEFAULT_LOGO_SRC = '/assets/ping-identity-logo.png';

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
  logoSrc,
  className = '',
  ...ariaProps
}) {
  const isDecorative = ariaProps['aria-hidden'] === true || ariaProps['aria-hidden'] === 'true';
  const isCustomLogo = Boolean(logoSrc);
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
      <span className="ping-spinner__visual" aria-hidden="true">
        <span className="ping-spinner__ring ping-spinner__ring--outer" />
        <span className="ping-spinner__ring ping-spinner__ring--inner" />
        <img
          className={`ping-spinner__mark ping-spinner__mark--dancing ${isCustomLogo ? 'ping-spinner__custom-mark' : 'ping-spinner__default-mark'}`}
          src={logoSrc || DEFAULT_LOGO_SRC}
          alt=""
        />
      </span>
      {label && <span className="ping-spinner__label">{label}</span>}
    </span>
  );
}
