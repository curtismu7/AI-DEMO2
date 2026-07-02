import React, { useEffect, useState } from 'react';

export function SecurityGuaranteeBanner() {
  const [isDismissed, setIsDismissed] = useState(false);

  useEffect(() => {
    const stored = sessionStorage.getItem('utfi_security_banner_dismissed');
    if (stored === 'true') {
      setIsDismissed(true);
    }
  }, []);

  const handleDismiss = () => {
    setIsDismissed(true);
    sessionStorage.setItem('utfi_security_banner_dismissed', 'true');
  };

  if (isDismissed) return null;

  return (
    <div className="utfi-security-guarantee">
      <div className="utfi-security-text">
        🔒 <strong>Security guarantee:</strong> User Token and Agent Token are secrets —
        stored only on Backend-for-Frontend (BFF). Only the Delegated Access Token
        (limited scope + nested delegation proof) reaches the MCP Server.
      </div>
      <button
        className="utfi-security-dismiss"
        onClick={handleDismiss}
        aria-label="Dismiss security guarantee banner"
      >
        ×
      </button>
    </div>
  );
}
