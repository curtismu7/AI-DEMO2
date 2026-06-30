import React, { useState } from 'react';
import '../styles/TokenChainRedesign.css';

/**
 * TokenExchangeModeSummary
 *
 * Collapsed/expandable Token Exchange Mode section showing:
 * - Summary line: emoji, token count, badge
 * - Expandable table: 4 columns (Token Type, Full Name, Issued By, RFC 8693 Role)
 * - Token type badges with colors (User=Pink, Agent=Purple, MCP=Green)
 *
 * @param {Object} props
 * @param {Array<{type, name, issuedBy, rfc8693Role}>} props.tokens - Token objects to display
 */
export default function TokenExchangeModeSummary({ tokens = [] }) {
  const [expanded, setExpanded] = useState(false);

  const safeTokens = Array.isArray(tokens) ? tokens : [];
  const tokenCount = safeTokens.length;

  const getBadgeClass = (tokenType) => {
    const type = tokenType?.toLowerCase() || '';
    if (type === 'user') return 'tems-token-badge--user';
    if (type === 'agent') return 'tems-token-badge--agent';
    if (type === 'mcp') return 'tems-token-badge--mcp';
    return 'tems-token-badge--default';
  };

  return (
    <div className="tems-container">
      {/* Summary line */}
      <div className="tems-summary">
        <span className="tems-summary-icon">🔗</span>
        <span className="tems-summary-text">
          {tokenCount} token{tokenCount !== 1 ? 's' : ''} in chain
        </span>
        <span className="tems-summary-badge">{tokenCount}</span>
        <button
          className="tems-toggle-btn"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          aria-label={expanded ? 'Hide Details' : 'View Details'}
        >
          {expanded ? 'Hide Details' : 'View Details'}
        </button>
      </div>

      {/* Expanded table */}
      {expanded && (
        <div className="tems-table-container">
          <table className="tems-table">
            <thead>
              <tr>
                <th>Token Type</th>
                <th>Full Name</th>
                <th>Issued By</th>
                <th>RFC 8693 Role</th>
              </tr>
            </thead>
            <tbody>
              {safeTokens.map((token, idx) => (
                <tr key={idx}>
                  <td>
                    <span className={`tems-token-badge ${getBadgeClass(token.type)}`}>
                      {token.type || 'Unknown'}
                    </span>
                  </td>
                  <td>{token.name || '—'}</td>
                  <td>{token.issuedBy || '—'}</td>
                  <td>{token.rfc8693Role || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
