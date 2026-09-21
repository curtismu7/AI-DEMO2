// banking_api_ui/src/components/shared/InlineSpinner.js
import React from 'react';
import PingIdentitySpinner from './PingIdentitySpinner';

/**
 * Lightweight Ping identity mark for use inside modals, cards, and tables.
 *
 * @param {object}  props
 * @param {string}  [props.label]  - Optional text label beside the spinner
 * @param {string}  [props.size]   - 'sm' (default, 20px) | 'md' (28px)
 */
export default function InlineSpinner({ label, size = 'sm' }) {
  const dimension = size === 'md' ? 28 : 20;
  return <PingIdentitySpinner size={dimension} label={label} className="ping-spinner--inline" />;
}
