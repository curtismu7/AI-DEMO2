// banking_api_ui/src/components/NarrativePanel.js
import React from 'react';
import { useTokenChainOptional } from '../context/TokenChainContext';
import RfcLink from './shared/RfcLink';
import './NarrativePanel.css';

// Phase 266 R2: credential-path labels and narration text per path.
// credentialPath is read from TokenChainContext (set by gateway _meta.credentialPath).
const PATH_LABELS = {
  oauth_bearer: 'OAUTH BEARER PATH',
  api_key:      'API-KEY PATH',
  dual_token:   'ACCESS + ID-TOKEN PATH',
};

const PATH_NARRATION = {
  oauth_bearer: 'The gateway performs RFC 8693 token exchange (RFC 8693 + RFC 8707 audience binding) to obtain a backend-scoped bearer, then forwards the tool call to banking_resource_server /accounts or /transactions. Data is sourced from LMDB seeded from the demo store (inbound bearer per RFC 6750; audit chain per draft-ietf-oauth-identity-chaining).',
  api_key:      'The gateway exchanges your OAuth token for a service API key. Phase 266 demo terminates here without calling a backend; see the API-Key info page.',
  dual_token:   'The gateway forwards your access token AND id_token to banking_resource_server /identity. The access token is validated server-side by the authenticateToken middleware (RFC 6750; JWKS per RFC 7515/7517); the id_token is fetched from the BFF session (OIDC Core §3.1.3.7) and decoded server-side; only sanitized claims are returned (no raw JWT crosses any boundary). RFC 8693 exchange narrows audience per RFC 8707; act chain logged per draft-ietf-oauth-identity-chaining.',
};

function dotClass(status) {
  if (status === 'success' || status === 'acquired') return 'np-dot np-dot--success';
  if (status === 'error') return 'np-dot np-dot--error';
  if (status === 'active' || status === 'pending') return 'np-dot np-dot--pending';
  return 'np-dot';
}

function claimPills(claims, prev) {
  if (!claims || Object.keys(claims).length === 0) return null;
  const KEY_ORDER = ['sub', 'aud', 'scope', 'act', 'may_act', 'client_id'];
  const keys = [...KEY_ORDER.filter(k => k in claims), ...Object.keys(claims).filter(k => !KEY_ORDER.includes(k))].slice(0, 8);
  return keys.map(k => {
    const val = claims[k];
    const display = Array.isArray(val) ? val.join(', ') : (typeof val === 'object' ? JSON.stringify(val) : String(val));
    const prevVal = prev?.[k];
    const isNew = prevVal === undefined;
    const isChanged = !isNew && JSON.stringify(prevVal) !== JSON.stringify(val);
    const isKey = ['sub', 'aud', 'act'].includes(k);
    const cls = isNew ? 'np-claim np-claim--new' : isChanged ? 'np-claim np-claim--changed' : isKey ? 'np-claim np-claim--highlight' : 'np-claim';
    return (
      <span key={k} className={cls} title={`${k}: ${display}`}>
        {k}: {display.length > 30 ? display.slice(0, 30) + '…' : display}
      </span>
    );
  });
}

function buildSteps(events) {
  return events.map((ev, i) => {
    const prev = i > 0 ? events[i - 1].claims : null;
    const id = ev.id || '';
    const claims = ev.claims || {};

    let label = ev.label || id;
    let body = null;
    let rfcNode = null;

    if (id === 'user-token' || id.startsWith('synthetic-session')) {
      label = 'User authenticated';
      body = `Session token acquired via PKCE. Subject: ${claims.sub || '—'}. Audience: ${Array.isArray(claims.aud) ? claims.aud.join(', ') : (claims.aud || '—')}.`;
      rfcNode = <RfcLink rfc="RFC_7636" />;
    } else if (id === 'cc-token' || id.includes('agent-actor') || id.includes('cc')) {
      label = 'Agent credentials token obtained';
      body = `AI agent obtained a client credentials token to identify itself during the token exchange.`;
      rfcNode = <RfcLink rfc="RFC_6749" />;
    } else if (id === 'exchange' || id.includes('exchange')) {
      label = 'Token exchange initiated (RFC 8693)';
      body = `BFF sent user token + agent CC token to PingOne. PingOne issues a new token with narrowed audience${claims.act ? ' and delegation chain (act claim)' : ''}.`;
      rfcNode = <RfcLink rfc="RFC_8693" section="§3" />;
    } else if (id.includes('mcp') || id.includes('exchanged')) {
      label = 'MCP-scoped token issued';
      const actSub = claims.act?.sub;
      body = `Audience narrowed to MCP server. Subject preserved: ${claims.sub || '—'}.${actSub ? ` Delegation: act.sub = ${actSub} (agent identity).` : ''}`;
      rfcNode = <RfcLink rfc="RFC_8693" section="§4.1" />;
    }

    return { ev, label, body, rfcNode, claims, prev };
  });
}

function buildSummary(events) {
  if (events.length === 0) return null;
  const hasExchange = events.some(ev => ev.id?.includes('exchange') || ev.id?.includes('mcp'));
  const hasAct = events.some(ev => ev.claims?.act);
  const lastAudRaw = events[events.length - 1]?.claims?.aud;
  const lastAud = Array.isArray(lastAudRaw) ? lastAudRaw.join(', ') : lastAudRaw;

  if (hasExchange && hasAct) {
    return `2-Exchange flow complete. User identity delegated to AI agent via RFC 8693. Token audience narrowed to ${lastAud || 'MCP server'} with act claim preserving agent identity.`;
  }
  if (hasExchange) {
    return `1-Exchange flow complete. User token narrowed to ${lastAud || 'MCP server'} audience. No delegation chain — subject-only exchange.`;
  }
  return `User session token active. Run the AI agent to trigger an RFC 8693 token exchange and see the full chain.`;
}

export default function NarrativePanel() {
  const ctx = useTokenChainOptional();
  const liveEvents = ctx?.events || [];
  const history = ctx?.history || [];
  const lastEntry = history[0];
  const isLastCall = liveEvents.length === 0 && lastEntry?.events?.length > 0;
  const events = liveEvents.length > 0 ? liveEvents : (lastEntry?.events || []);
  const credentialPath = events[0]?.credentialPath || 'oauth_bearer';
  const pathLabel = PATH_LABELS[credentialPath] || PATH_LABELS.oauth_bearer;
  const pathNarration = PATH_NARRATION[credentialPath] || PATH_NARRATION.oauth_bearer;

  if (events.length === 0) {
    return (
      <div className="np-root">
        <div className="np-title">What's Happening</div>
        <div className="np-subtitle">Plain-English walkthrough of the token exchange flow</div>
        <div className="np-idle">
          <div className="np-idle-icon">🔐</div>
          <div>No token exchange in progress.</div>
          <div style={{ marginTop: 6, fontSize: '0.78rem' }}>Use the AI agent to trigger an RFC 8693 exchange and see the story unfold here.</div>
        </div>
      </div>
    );
  }

  const steps = buildSteps(events);
  const summary = buildSummary(events);

  return (
    <div className="np-root">
      <div className="np-title">What's Happening</div>
      <div className="np-subtitle">Plain-English walkthrough · <RfcLink rfc="RFC_8693" /></div>
      {isLastCall && (
        <div style={{
          marginBottom: 8,
          padding: '4px 10px',
          borderRadius: 6,
          background: '#f1f5f9',
          border: '1px solid #cbd5e1',
          fontSize: '0.72rem',
          color: '#64748b',
        }}>
          Last call · {lastEntry.tool}{lastEntry.timestamp ? ` · ${new Date(lastEntry.timestamp).toLocaleTimeString()}` : ''}
        </div>
      )}
      {/* Phase 266 R2: path-specific narration badge + text */}
      <div style={{
        marginBottom: 8,
        padding: '6px 10px',
        borderRadius: 6,
        background: credentialPath === 'api_key' ? '#fef9c3' : credentialPath === 'dual_token' ? '#ccfbf1' : '#dbeafe',
        border: `1px solid ${credentialPath === 'api_key' ? '#ca8a04' : credentialPath === 'dual_token' ? '#0d9488' : '#004687'}`,
        fontSize: '0.72rem',
        color: '#1e293b',
      }}>
        <span style={{ fontWeight: 700, marginRight: 6 }}>{pathLabel}:</span>
        {pathNarration}
      </div>

      <div className="np-timeline">
        {steps.map(({ ev, label, body, rfcNode, claims, prev }) => (
          <div key={ev.id} className="np-step">
            <div className={dotClass(ev.status)} />
            <div className="np-step-label">{label}</div>
            {body && <div className="np-step-body">{body}</div>}
            <div className="np-step-claims">{claimPills(claims, prev)}</div>
            {rfcNode && <div className="np-rfc">{rfcNode}</div>}
          </div>
        ))}
      </div>

      {summary && <div className="np-summary">{summary}</div>}
    </div>
  );
}
