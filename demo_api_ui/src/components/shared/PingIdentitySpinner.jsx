import React from 'react';
import LoadingTip from './LoadingTip';
import './LoadingOverlay.css';

// Inlined into the bundle (data URI) so the spinner still draws while the server is restarting.
import DEFAULT_LOGO_SRC from '../../../public/branding/ping-logo.png?inline';
const MIN_TIP_SIZE = 32;
// Every stand-alone spinner draws at this size, whatever `size` a caller passes, so the
// boot screen, the sign-in screen, the loading overlay and a modal wait are one picture.
const STANDALONE_SIZE = 56;

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
  // A tip needs room: show it on a stand-alone spinner (32px and up), never on the
  // small one inside a button or a row, nor on a decorative one. `tip` overrides.
  const showTip = tip ?? (size >= MIN_TIP_SIZE && !isDecorative);
  const rootClassName = `ping-spinner${showTip ? ' ping-spinner--tip' : ''} ${className}`.trim();
  const drawSize = showTip ? STANDALONE_SIZE : size;

  return (
    <span
      className={rootClassName}
      style={{ '--ping-spinner-size': `${drawSize}px` }}
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
          // The spinner shows while the stack restarts, so the logo fetch can fail; hide the broken-image glyph.
          onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
        />
      </span>
      {label && <span className="ping-spinner__label">{label}</span>}
      {showTip ? <LoadingTip /> : null}
    </span>
  );
}
