import React from 'react';
import SpinnerTip from './SpinnerTip';
import './LoadingOverlay.css';

// Spinners this big are waiting on something; smaller ones sit in buttons and rows.
const TIP_MIN_SIZE = 40;

const DEFAULT_LOGO_SRC = '/branding/ping-logo.svg';

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
  tip,
  ...ariaProps
}) {
  const isDecorative = ariaProps['aria-hidden'] === true || ariaProps['aria-hidden'] === 'true';
  const isCustomLogo = Boolean(logoSrc);
  // Default: show the tip card on large, non-decorative, non-inline spinners.
  const showTip = tip ?? (size >= TIP_MIN_SIZE && !isDecorative && !className.includes('ping-spinner--inline'));
  const rootClassName = `ping-spinner ${showTip ? 'ping-spinner--with-tip' : ''} ${className}`.replace(/\s+/g, ' ').trim();

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
      {showTip && <SpinnerTip />}
    </span>
  );
}
