// demo_api_ui/src/components/AuthButton.jsx
import React from 'react';
import './AuthButton.css';

/**
 * AuthButton — shared button for sign-in and dismiss actions.
 *
 * @param {'customer'|'admin'|'ghost'} props.variant
 * @param {function} props.onClick
 * @param {boolean} [props.disabled]
 * @param {string} [props.className] - extra CSS classes
 * @param {React.ReactNode} props.children
 */
export default function AuthButton({ variant = 'customer', onClick, disabled = false, className = '', children, ...rest }) {
  return (
    <button
      type="button"
      className={`auth-btn auth-btn--${variant}${className ? ' ' + className : ''}`}
      onClick={onClick}
      disabled={disabled}
      {...rest}
    >
      {children}
    </button>
  );
}
