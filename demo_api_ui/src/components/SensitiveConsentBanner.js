import React, { useState } from 'react';

/**
 * SensitiveConsentBanner
 *
 * Inline banner rendered inside the agent chat panel when the agent calls
 * get_sensitive_account_details and the BFF returns consent_required: true.
 *
 * Props:
 *   onReveal: () => Promise<void>  — called when user clicks Reveal; parent handles POST
 *   onDeny:   () => void           — called when user clicks Deny
 *   loading:  boolean              — true while Reveal POST is in flight
 */
export default function SensitiveConsentBanner({ onReveal, onDeny, loading }) {
  const [granted, setGranted] = useState(false);

  const handleReveal = async () => {
    try {
      await onReveal();
      setGranted(true);
      // Parent will unmount this banner after ~2s via state update
    } catch (e) {
      // Parent handles error toasts
    }
  };

  const containerStyle = {
    background: '#2a2a1a',
    border: '1px solid #d4a017',
    borderRadius: '8px',
    padding: '12px 16px',
    margin: '8px 0',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  };

  const titleStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontWeight: '600',
    fontSize: '14px',
    color: '#f0c040',
  };

  const bodyStyle = {
    fontSize: '13px',
    color: '#d0c090',
    lineHeight: '1.5',
  };

  const actionsStyle = {
    display: 'flex',
    gap: '8px',
    marginTop: '2px',
  };

  const revealBtnStyle = {
    padding: '6px 16px',
    borderRadius: '6px',
    border: 'none',
    background: loading || granted ? '#555' : '#d4a017',
    color: loading || granted ? '#999' : '#000',
    fontWeight: '600',
    fontSize: '13px',
    cursor: loading ? 'not-allowed' : 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  };

  const denyBtnStyle = {
    padding: '6px 16px',
    borderRadius: '6px',
    border: '1px solid #666',
    background: 'transparent',
    color: '#aaa',
    fontWeight: '500',
    fontSize: '13px',
    cursor: loading ? 'not-allowed' : 'pointer',
  };

  if (granted) {
    return (
      <div style={{ ...containerStyle, borderColor: '#2ea043', background: '#1a2a1a' }}>
        <div style={{ ...titleStyle, color: '#3fb950' }}>
          ✓ Access granted (60s)
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <div style={titleStyle}>
        <span>🔒</span>
        <span>Sensitive data access requested</span>
      </div>
      <div style={bodyStyle}>
        The agent is requesting your <strong>full account number</strong> and <strong>routing
        number</strong>. These are sensitive fields that are not shared by default.
      </div>
      <div style={actionsStyle}>
        <button
          style={revealBtnStyle}
          onClick={handleReveal}
          disabled={loading}
          aria-label="Reveal sensitive account details"
        >
          {loading && <span style={{ fontSize: '12px' }}>⏳</span>}
          {loading ? 'Granting…' : '👁 Reveal'}
        </button>
        <button
          style={denyBtnStyle}
          onClick={onDeny}
          disabled={loading}
          aria-label="Deny access to sensitive account details"
        >
          Deny
        </button>
      </div>
    </div>
  );
}
