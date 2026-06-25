/**
 * TokenStateIndicator — Phase 194 Plan 02
 * Compact inline component showing which token is active at a given milestone,
 * its state (acquiring → active → exchanged → used → failed), and expandable claims.
 */

import React, { useState } from 'react';
import { TokenColorDot } from './TokenColorSystem';

// Token type → display abbreviation and label
const TOKEN_TYPE_CONFIG = {
  user_token:  { abbr: 'U', label: 'User Token',       category: 'subject', color: '#dc2626' },
  agent_token: { abbr: 'A', label: 'Agent Token',      category: 'actor',   color: '#2563eb' },
  mcp_token:   { abbr: 'M', label: 'MCP Token',        category: 'mcp',     color: '#16a34a' },
  unknown:     { abbr: '?', label: 'Unknown Token',     category: null,      color: '#374151' },
};

// Token lifecycle states
const STATE_CONFIG = {
  acquiring:  { icon: '⟳', cls: 'tsi-state--acquiring',  label: 'Acquiring',  animate: true  },
  active:     { icon: '●', cls: 'tsi-state--active',      label: 'Active',     animate: false },
  exchanged:  { icon: '⇄', cls: 'tsi-state--exchanged',   label: 'Exchanged',  animate: false },
  used:       { icon: '✓', cls: 'tsi-state--used',        label: 'Used',       animate: false },
  failed:     { icon: '✕', cls: 'tsi-state--failed',      label: 'Failed',     animate: false },
  unknown:    { icon: '?', cls: 'tsi-state--unknown',     label: 'Unknown',    animate: false },
};

function formatExpiry(exp) {
  if (!exp) return null;
  const now = Math.floor(Date.now() / 1000);
  const secs = exp - now;
  if (secs <= 0) return 'Expired';
  if (secs < 60)  return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
}

function truncateSub(sub) {
  if (!sub) return null;
  const s = String(sub);
  return s.length > 16 ? `${s.slice(0, 8)}…${s.slice(-4)}` : s;
}

/**
 * @param {{
 *   token: {
 *     tokenType?:  'user_token'|'agent_token'|'mcp_token',
 *     tokenState?: 'acquiring'|'active'|'exchanged'|'used'|'failed',
 *     sub?:        string,
 *     act?:        { sub: string } | null,
 *     scopes?:     string[],
 *     exp?:        number,
 *   } | null,
 *   resolvedIdentity?: { currentUser?: {sub:string,name?:string}, knownClients?: object },
 *   compact?: boolean,
 * }} props
 */
export default function TokenStateIndicator({ token, resolvedIdentity, compact = true }) {
  const [expanded, setExpanded] = useState(false);

  if (!token) return null;

  const typeKey  = token.tokenType  || 'unknown';
  const stateKey = token.tokenState || 'unknown';

  const typeConfig  = TOKEN_TYPE_CONFIG[typeKey]  || TOKEN_TYPE_CONFIG.unknown;
  const stateConfig = STATE_CONFIG[stateKey]       || STATE_CONFIG.unknown;

  // Friendlier labels for sub / act claims
  function friendlySub(sub) {
    if (!sub) return null;
    const user = resolvedIdentity?.currentUser;
    if (user?.sub === sub && user.name) return `${user.name} (${truncateSub(sub)})`;
    return truncateSub(sub);
  }

  function friendlyAct(act) {
    if (!act) return null;
    const clientId = typeof act === 'object' ? (act.sub || act.client_id) : String(act);
    if (!clientId) return null;
    const label = resolvedIdentity?.knownClients?.[clientId];
    return label ? `${label} (${truncateSub(clientId)})` : truncateSub(clientId);
  }

  const expiry = formatExpiry(token.exp);

  return (
    <div className={`tsi-root ${compact ? 'tsi-compact' : 'tsi-full'}`}>
      {/* Compact inline view */}
      <button
        type="button"
        className="tsi-inline"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        title={`${typeConfig.label} — ${stateConfig.label}${expiry ? ` (expires in ${expiry})` : ''}`}
        style={{ borderLeft: `3px solid ${typeConfig.color}` }}
      >
        <TokenColorDot type={typeConfig.category} size={8} />
        <span className="tsi-abbr" style={{ color: typeConfig.color }}>{typeConfig.abbr}</span>
        <span className={`tsi-state-icon ${stateConfig.cls} ${stateConfig.animate ? 'tsi-spin' : ''}`}>
          {stateConfig.icon}
        </span>
        {!compact && <span className="tsi-state-label">{stateConfig.label}</span>}
      </button>

      {/* Expanded details panel */}
      {expanded && (
        <div className="tsi-details">
          <div className="tsi-detail-row tsi-detail-header">
            <TokenColorDot type={typeConfig.category} size={10} />
            <strong>{typeConfig.label}</strong>
            <span className={`tsi-badge ${stateConfig.cls}`}>{stateConfig.label}</span>
          </div>

          {token.sub && (
            <div className="tsi-detail-row">
              <span className="tsi-detail-key">Subject:</span>
              <code className="tsi-detail-val">{friendlySub(token.sub)}</code>
            </div>
          )}

          {token.act && (
            <div className="tsi-detail-row">
              <span className="tsi-detail-key">Actor:</span>
              <code className="tsi-detail-val">{friendlyAct(token.act)}</code>
            </div>
          )}

          {token.scopes && token.scopes.length > 0 && (
            <div className="tsi-detail-row tsi-detail-scopes">
              <span className="tsi-detail-key">Scopes:</span>
              <span className="tsi-detail-val">{token.scopes.join(', ')}</span>
            </div>
          )}

          {expiry && (
            <div className="tsi-detail-row">
              <span className="tsi-detail-key">Expires:</span>
              <span className={`tsi-detail-val ${expiry === 'Expired' ? 'tsi-expired' : ''}`}>{expiry}</span>
            </div>
          )}

          <button
            type="button"
            className="tsi-close"
            onClick={() => setExpanded(false)}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
