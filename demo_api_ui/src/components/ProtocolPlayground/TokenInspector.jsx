import React from 'react';
import { extractScopes, formatTokenDisplay } from '../../services/tokenInspector';

export default function TokenInspector({ token }) {
  if (!token || !token.isValid || !token.payload) {
    return null;
  }

  const display = formatTokenDisplay(token.payload);

  return (
    <div className="token-inspector">
      <h5>🔐 Token</h5>

      <div className="token-claims">
        {display.scopes.length > 0 && (
          <div className="claim">
            <span className="claim-label">Scopes:</span>
            <span className="claim-value">{display.scopes.join(', ')}</span>
          </div>
        )}

        {display.aud && (
          <div className="claim">
            <span className="claim-label">Audience:</span>
            <span className="claim-value">{display.aud}</span>
          </div>
        )}

        {display.sub && (
          <div className="claim">
            <span className="claim-label">Subject:</span>
            <span className="claim-value">{display.sub}</span>
          </div>
        )}

        {display.exp && (
          <div className="claim">
            <span className="claim-label">Expires:</span>
            <span className="claim-value">{display.exp}</span>
          </div>
        )}
      </div>
    </div>
  );
}
