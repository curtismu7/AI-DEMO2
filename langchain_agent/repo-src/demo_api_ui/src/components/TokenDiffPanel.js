// banking_api_ui/src/components/TokenDiffPanel.js
import React, { useMemo } from 'react';
import { useTokenChainOptional } from '../context/TokenChainContext';
import RfcLink from './shared/RfcLink';
import './TokenDiffPanel.css';

const CLAIM_INTEREST_ORDER = ['sub', 'aud', 'scope', 'act', 'may_act', 'client_id', 'iss', 'exp', 'iat', 'jti', 'acr', 'amr', 'env', 'org', 'azp'];

const CLAIM_GLOSSARY = {
  sub: 'Subject — preserved across exchanges (RFC 8693 §2.1)',
  aud: 'Audience — narrows at each hop to target resource server (RFC 8693 §3)',
  act: 'Actor — delegation chain, identifies the agent (RFC 8693 §4.1)',
  may_act: 'May Act — pre-authorization for token exchange by a specific client (RFC 8693 §4.1)',
  scope: 'Scopes — may narrow or change at each exchange hop',
  client_id: 'Client ID — which OAuth client obtained this token',
  iss: 'Issuer — the authorization server that issued this token',
  exp: 'Expiration — Unix epoch time after which token must be rejected',
  iat: 'Issued At — when the token was created',
};

function formatClaimValue(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function cellClass(status) {
  if (status === 'added')     return 'tdp-cell-added';
  if (status === 'changed')   return 'tdp-cell-changed';
  if (status === 'removed')   return 'tdp-cell-removed';
  if (status === 'absent')    return 'tdp-cell-absent';
  return 'tdp-cell-unchanged';
}

function diffStatus(prevClaims, currClaims, key) {
  const prev = prevClaims ? prevClaims[key] : undefined;
  const curr = currClaims ? currClaims[key] : undefined;
  if (curr === undefined && prev === undefined) return 'absent';
  if (curr === undefined && prev !== undefined) return 'removed';
  if (curr !== undefined && prev === undefined) return 'added';
  if (JSON.stringify(curr) !== JSON.stringify(prev)) return 'changed';
  return 'unchanged';
}

export default function TokenDiffPanel() {
  const ctx = useTokenChainOptional();
  const events = ctx?.events || [];

  const claimedEvents = events.filter(ev => ev.claims && Object.keys(ev.claims).length > 0);

  const allKeys = useMemo(() => {
    const keySet = new Set();
    claimedEvents.forEach(ev => Object.keys(ev.claims || {}).forEach(k => keySet.add(k)));
    const ordered = CLAIM_INTEREST_ORDER.filter(k => keySet.has(k));
    keySet.forEach(k => { if (!ordered.includes(k)) ordered.push(k); });
    return ordered;
  }, [claimedEvents]);

  if (claimedEvents.length === 0) {
    return (
      <div className="tdp-root">
        <div className="tdp-title">Token Claim Diff</div>
        <div className="tdp-empty">
          No token claims yet. Run the AI Agent to trigger an RFC 8693 token exchange and see how claims change at each hop.
        </div>
      </div>
    );
  }

  return (
    <div className="tdp-root">
      <div className="tdp-title">Token Claim Diff — How Claims Change Across Each Exchange Hop</div>
      <div className="tdp-subtitle">
        Green = added · Yellow = changed · Red = removed · Gray = unchanged ·{' '}
        <RfcLink rfc="RFC_8693" section="§3" />
      </div>
      <div className="tdp-legend">
        <div className="tdp-legend-item"><div className="tdp-legend-swatch" style={{background:'#dcfce7'}} /><span>Added</span></div>
        <div className="tdp-legend-item"><div className="tdp-legend-swatch" style={{background:'#fef9c3'}} /><span>Changed</span></div>
        <div className="tdp-legend-item"><div className="tdp-legend-swatch" style={{background:'#fee2e2'}} /><span>Removed</span></div>
        <div className="tdp-legend-item"><div className="tdp-legend-swatch" style={{background:'#f1f5f9', border:'1px solid #e2e8f0'}} /><span>Unchanged</span></div>
      </div>
      <table className="tdp-table">
        <thead>
          <tr>
            <th style={{minWidth: 90}}>Claim</th>
            {claimedEvents.map(ev => (
              <th key={ev.id}>
                <div className="tdp-col-header">
                  <span className="tdp-col-label">{ev.label || ev.id}</span>
                  {ev.status && <span className="tdp-col-status">{ev.status}</span>}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {allKeys.map(key => (
            <tr key={key}>
              <td>
                <span className="tdp-claim-key" title={CLAIM_GLOSSARY[key] || key}>{key}</span>
              </td>
              {claimedEvents.map((ev, i) => {
                const prevClaims = i > 0 ? claimedEvents[i - 1].claims : null;
                const status = diffStatus(prevClaims, ev.claims, key);
                const rawVal = ev.claims?.[key];
                const display = formatClaimValue(rawVal);
                return (
                  <td key={ev.id} className={cellClass(status)}>
                    {display === null ? (
                      <span className="tdp-cell-absent">—</span>
                    ) : typeof rawVal === 'object' ? (
                      <span className="tdp-value-obj" title={display}>{display}</span>
                    ) : (
                      <span className="tdp-value" title={display}>{display}</span>
                    )}
                    {status === 'added'   && <span className="tdp-badge-added">+added</span>}
                    {status === 'changed' && <span className="tdp-badge-changed">~changed</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="tdp-rfc-row">
        Key RFC 8693 behaviours: <strong>aud</strong> narrows each hop (§3) ·{' '}
        <strong>act</strong> delegation chain added at exchange (§4.1) ·{' '}
        <strong>sub</strong> preserved across exchanges (§2.1) ·{' '}
        <strong>may_act</strong> pre-authorizes exchange (§4.1) ·{' '}
        <RfcLink rfc="RFC_8693" />
      </div>
    </div>
  );
}
