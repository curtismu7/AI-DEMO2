import React, { useState, useEffect, useCallback } from 'react';
import { getAgentAuthStatus, setAgentAuthorization } from '../services/agentAuthorizationService';
import { requestSilentReauth } from '../utils/authUi';

const VALID_SCOPES = [
  { key: 'view_accounts',     label: 'View Accounts',    description: 'See account list and details' },
  { key: 'view_balances',     label: 'View Balances',    description: 'See account balances' },
  { key: 'create_deposit',    label: 'Make Deposits',    description: 'Deposit funds into accounts' },
  { key: 'create_withdrawal', label: 'Make Withdrawals', description: 'Withdraw funds from accounts' },
  { key: 'create_transfer',   label: 'Transfer Funds',   description: 'Transfer between accounts' },
];

// ---------------------------------------------------------------------------
// Inline styles
// ---------------------------------------------------------------------------
const S = {
  page: { background: '#f9fafb', padding: '0 16px 32px 16px' },
  inner: { maxWidth: 900, margin: '0 auto' },
  card: { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 24, marginBottom: 24 },
  sectionHeading: { fontSize: 16, fontWeight: 700, color: 'var(--brand-navy)', marginTop: 0, marginBottom: 8 },
  muted: { color: '#374151', fontSize: 13, margin: '0 0 16px 0' },
  input: {
    width: '100%', maxWidth: 400, padding: '9px 12px',
    border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14,
    boxSizing: 'border-box',
  },
  scopeRow: { display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8, cursor: 'pointer' },
  scopeLabel: { fontWeight: 600, fontSize: 13, color: '#374151' },
  scopeDesc: { fontSize: 12, color: '#374151', marginLeft: 4 },
  primaryBtn: {
    padding: '9px 22px', background: 'var(--brand-navy)', color: '#fff',
    border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: 'pointer',
  },
  primaryBtnDisabled: {
    padding: '9px 22px', background: '#93c5fd', color: '#fff',
    border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: 'not-allowed',
  },
  dangerBtn: {
    padding: '6px 14px', background: '#fee2e2', color: '#dc2626',
    border: '1px solid #fca5a5', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer',
  },
  dangerBtnDisabled: {
    padding: '6px 14px', background: '#fef2f2', color: '#fca5a5',
    border: '1px solid #fde8d8', borderRadius: 6, fontSize: 13, cursor: 'not-allowed',
  },
  successBanner: {
    marginTop: 12, padding: '10px 14px', borderRadius: 6,
    background: '#f0fdf4', border: '1px solid #86efac', color: '#166534', fontSize: 13,
  },
  errorBanner: {
    marginTop: 12, padding: '10px 14px', borderRadius: 6,
    background: '#fef2f2', border: '1px solid #fca5a5', color: '#991b1b', fontSize: 13,
  },
  tabBar: { display: 'flex', gap: 0, borderBottom: '1px solid #e5e7eb', marginBottom: 16 },
  tabBtn: (active) => ({
    padding: '9px 20px', background: 'none', border: 'none',
    cursor: 'pointer', fontSize: 14,
    fontWeight: active ? 700 : 400,
    borderBottom: active ? '2px solid var(--brand-navy)' : '2px solid transparent',
    color: active ? 'var(--brand-navy)' : '#6b7280',
    marginBottom: -1,
  }),
  delegCard: {
    background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 8,
    padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  },
  delegCardLeft: { flex: 1 },
  delegEmail: { fontWeight: 600, fontSize: 14, color: '#111827', marginBottom: 4 },
  delegMeta: { fontSize: 12, color: '#374151', marginBottom: 6 },
  pillsRow: { display: 'flex', flexWrap: 'wrap', gap: 4 },
  pill: {
    background: '#eff6ff', color: 'var(--brand-navy)', fontSize: 11, fontWeight: 600,
    padding: '2px 9px', borderRadius: 12, textTransform: 'capitalize',
  },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', padding: '8px 12px', borderBottom: '2px solid #e5e7eb', color: '#374151', fontWeight: 600 },
  td: { padding: '9px 12px', borderBottom: '1px solid #f3f4f6', color: '#374151' },
  statusBadge: (status) => ({
    padding: '2px 8px', borderRadius: 10, fontSize: 12, fontWeight: 600,
    background: status === 'active' ? '#dcfce7' : '#f3f4f6',
    color: status === 'active' ? '#15803d' : '#6b7280',
  }),
  codeBlock: {
    background: '#0f172a', color: '#e2e8f0', borderRadius: 8,
    padding: '16px 20px', fontSize: 12, fontFamily: 'inherit',
    whiteSpace: 'pre-wrap', wordBreak: 'break-all', lineHeight: 1.7,
    overflowX: 'auto',
  },
  flowRow: {
    display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', margin: '16px 0',
  },
  flowBox: (color) => ({
    background: color, borderRadius: 8, padding: '8px 14px',
    fontSize: 12, fontWeight: 600, color: '#fff', textAlign: 'center',
    minWidth: 100,
  }),
  flowArrow: { color: '#374151', fontSize: 18, fontWeight: 700 },
  talkStep: {
    display: 'flex', gap: 12, marginBottom: 14, alignItems: 'flex-start',
  },
  talkNum: {
    background: 'var(--brand-navy)', color: '#fff', borderRadius: '50%',
    width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 12, fontWeight: 700, flexShrink: 0, marginTop: 2,
  },
  talkText: { fontSize: 13, color: '#374151', lineHeight: 1.6 },
  talkQuote: { fontStyle: 'italic', color: '#1e40af', fontWeight: 500 },
  infoPill: {
    display: 'inline-block', background: '#eff6ff', color: '#1d4ed8',
    fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
    fontFamily: 'inherit', marginRight: 4,
  },
  claimKey: { color: '#7dd3fc', fontWeight: 700 },
  claimVal: { color: '#86efac' },
  claimOp:  { color: '#fbbf24' },
};

// ---------------------------------------------------------------------------
// AI Agent Authorization card (RFC 8693 delegation)
// ---------------------------------------------------------------------------
function AgentAuthorizationCard() {
  const [status, setStatus] = useState(null); // { authorized, enforced } | null
  const [working, setWorking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getAgentAuthStatus()
      .then(data => { if (!cancelled) setStatus(data); })
      .catch(() => { /* tolerate errors — just don't render the card body */ });
    return () => { cancelled = true; };
  }, []);

  // Could not load status — render nothing rather than a broken card.
  if (!status) return null;

  const { authorized, enforced } = status;

  const handleToggle = async () => {
    setWorking(true);
    try {
      const data = await setAgentAuthorization(!authorized);
      if (data.reauthRequired) {
        requestSilentReauth(window.location.pathname);
      }
    } catch {
      setWorking(false);
    }
  };

  return (
    <div style={S.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h2 style={{ ...S.sectionHeading, marginBottom: 0 }}>AI Agent Authorization</h2>
        <span style={S.statusBadge(authorized ? 'active' : 'inactive')}>
          {authorized ? 'Agent authorized' : 'Agent revoked'}
        </span>
      </div>
      <p style={S.muted}>
        Controls whether the AI agent is permitted to act on your behalf (RFC 8693{' '}
        <span style={S.infoPill}>act</span> claim delegation).
      </p>
      {enforced && (
        <p style={{ fontSize: 12, color: '#374151', margin: '0 0 16px 0' }}>
          Enforcement on — a revoked agent is blocked from acting on your behalf.
        </p>
      )}
      <button
        type="button"
        onClick={handleToggle}
        disabled={working}
        style={working ? S.primaryBtnDisabled : S.primaryBtn}
      >
        {working ? 'Updating…' : authorized ? 'Revoke agent access' : 'Authorize agent'}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// How-It-Works panel
// ---------------------------------------------------------------------------
function HowItWorksPanel() {
  const [open, setOpen] = useState(true);
  return (
    <div style={S.card}>
      <div
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
        onClick={() => setOpen(o => !o)}
      >
        <h2 style={{ ...S.sectionHeading, marginBottom: 0 }}>🔍 How It Works — Under the Hood</h2>
        <span style={{ fontSize: 20, color: '#374151' }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <>
          <p style={{ ...S.muted, marginTop: 12 }}>
            Family Delegation is a live implementation of <strong>OAuth 2.0 delegated authorization</strong> using
            PingOne as the identity provider. When you grant access to a family member three real things happen:
          </p>

          {/* Flow diagram */}
          <div style={S.flowRow}>
            <div style={S.flowBox('#1e40af')}>1. Look up / provision<br/>delegate in PingOne</div>
            <span style={S.flowArrow}>→</span>
            <div style={S.flowBox('#7c3aed')}>2. Store delegation<br/>+ scopes in LMDB</div>
            <span style={S.flowArrow}>→</span>
            <div style={S.flowBox('#0891b2')}>3. Send email via<br/>PingOne Messages API</div>
            <span style={S.flowArrow}>→</span>
            <div style={S.flowBox('#059669')}>4. Delegate logs in →<br/>BFF issues delegation token</div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 8 }}>
            <div>
              <p style={{ fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 8 }}>
                What happens when access is granted:
              </p>
              <ul style={{ fontSize: 13, color: '#374151', lineHeight: 1.8, margin: 0, paddingLeft: 20 }}>
                <li>BFF calls PingOne Management API to find the delegate user</li>
                <li>If they don't exist yet, a new PingOne user is provisioned</li>
                <li>The delegation record is persisted in LMDB (locally) or in-memory (Vercel)</li>
                <li>PingOne Messages API sends a branded email notification to the delegate</li>
              </ul>
            </div>
            <div>
              <p style={{ fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 8 }}>
                What happens when the delegate logs in:
              </p>
              <ul style={{ fontSize: 13, color: '#374151', lineHeight: 1.8, margin: 0, paddingLeft: 20 }}>
                <li>BFF checks the delegations table for active records</li>
                <li>If found, performs <strong>RFC 8693 Token Exchange</strong> to mint a scoped token</li>
                <li>The resulting token carries an <span style={S.infoPill}>act</span> claim with the delegator's <span style={S.infoPill}>sub</span></li>
                <li>The agent uses this chained token when calling MCP tools</li>
              </ul>
            </div>
          </div>

          <p style={{ fontSize: 13, fontWeight: 700, color: '#374151', marginTop: 16, marginBottom: 6 }}>
            What the delegated token looks like (RFC 8693 <code>act</code> claim):
          </p>
          <div style={S.codeBlock}>
            <span style={S.claimOp}>{'{'}</span>{'\n'}
            {'  '}<span style={S.claimKey}>"sub"</span>: <span style={S.claimVal}>"delegate-user-id"</span>,{'\n'}
            {'  '}<span style={S.claimKey}>"scope"</span>: <span style={S.claimVal}>"view_accounts view_balances"</span>,{'\n'}
            {'  '}<span style={S.claimKey}>"act"</span>: <span style={S.claimOp}>{'{'}</span>{'\n'}
            {'    '}<span style={S.claimKey}>"sub"</span>: <span style={S.claimVal}>"delegator-user-id"</span>,{'\n'}
            {'    '}<span style={S.claimKey}>"email"</span>: <span style={S.claimVal}>"owner@example.com"</span>{'\n'}
            {'  '}<span style={S.claimOp}>{'}'}</span>,{'\n'}
            {'  '}<span style={S.claimKey}>"act"</span>: <span style={S.claimOp}>{'{'}</span>{'\n'}
            {'    '}<span style={S.claimKey}>"sub"</span>: <span style={S.claimVal}>"agent-client-id"</span>{'\n'}
            {'  '}<span style={S.claimOp}>{'}'}</span>{'\n'}
            <span style={S.claimOp}>{'}'}</span>
          </div>
          <p style={{ fontSize: 12, color: '#374151', marginTop: 8 }}>
            The <span style={S.infoPill}>act</span> claim proves <em>on whose behalf</em> the request runs.
            Platform-level authorization controls which agents are permitted to perform the delegation exchange.
            Both are verified cryptographically by PingOne on every request.
          </p>

          <p style={{ fontSize: 13, fontWeight: 700, color: '#374151', marginTop: 16, marginBottom: 6 }}>
            Standards implemented:
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[
              ['RFC 8693', 'Token Exchange'],
              ['RFC 7519', 'JSON Web Tokens'],
              ['OIDC Core', 'act / may_act claims'],
              ['PingOne Management API', 'User provisioning'],
              ['PingOne Messages API', 'Email notifications'],
            ].map(([rfc, label]) => (
              <div key={rfc} style={{ background: '#f1f5f9', borderRadius: 6, padding: '6px 12px', fontSize: 12 }}>
                <span style={{ fontWeight: 700, color: '#1e40af' }}>{rfc}</span>
                <span style={{ color: '#374151' }}> — {label}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live Token Chain panel
// ---------------------------------------------------------------------------
function LiveTokenChainPanel() {
  const [chain, setChain] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [needsLogin, setNeedsLogin] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setNeedsLogin(false);
    try {
      const res = await fetch('/api/token-chain', { credentials: 'include' });
      if (res.status === 401) { setNeedsLogin(true); return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setChain(data);
    } catch (err) {
      setError('Could not load token chain: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const delegationEvents = chain?.tokenChain?.filter(
    e => e.type === 'token_exchange' || e.actClaim || (e.claims?.act)
  ) || [];

  const mcpCalls = chain?.mcpToolCallsChain || [];

  return (
    <div style={S.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ ...S.sectionHeading, marginBottom: 0 }}>Live Token Chain</h2>
        <button
          onClick={load}
          disabled={loading}
          style={{ ...S.primaryBtn, padding: '6px 14px', fontSize: 13 }}
        >
          {loading ? 'Loading…' : '↻ Refresh'}
        </button>
      </div>
      <p style={S.muted}>
        Live view of the OAuth token chain for the current session. Shows token exchange events,{' '}
        <span style={S.infoPill}>act</span> claims, and MCP tool calls that used delegated authority.
      </p>

      {needsLogin && (
        <div style={{
          padding: '12px 16px', background: '#eff6ff', border: '1px solid #bfdbfe',
          borderRadius: 8, fontSize: 13, color: '#1e40af', display: 'flex',
          alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontSize: 18 }}>[!]</span>
          <span>
            <strong>Sign in required</strong> — the token chain is only available for
            authenticated sessions.{' '}
            <a href='/api/auth/login' style={{ color: '#1d4ed8', fontWeight: 600 }}>Log in</a>{' '}
            to see live delegation events here.
          </span>
        </div>
      )}
      {error && <div style={S.errorBanner}>{error}</div>}

      {!loading && chain && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {/* Summary stats */}
          <div>
            <p style={{ fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 10 }}>Session Summary</p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {[
                ['Token events (session)', chain.metadata?.totalEvents ?? '—', '#eff6ff', '#1d4ed8'],
                ['MCP tool calls (session total)', chain.metadata?.totalMCPToolCalls ?? '—', '#f0fdf4', '#166534'],
                ['Delegation Events', delegationEvents.length, '#fef3c7', '#b45309'],
              ].map(([label, val, bg, color]) => (
                <div key={label} style={{ background: bg, borderRadius: 8, padding: '10px 16px', minWidth: 80 }} title={label.startsWith('MCP') ? (chain.metadata?.totalsHint || 'Accumulated this session, not one prompt') : undefined}>
                  <div style={{ fontSize: 22, fontWeight: 700, color }}>{val}</div>
                  <div style={{ fontSize: 11, color: '#374151', marginTop: 2 }}>{label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Validation mode */}
          <div>
            <p style={{ fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 10 }}>Validation Mode</p>
            <div style={{
              background: '#f8fafc', borderRadius: 8, padding: '10px 14px',
              fontSize: 13, color: '#374151',
            }}>
              <span style={S.infoPill}>{chain.validationMode || 'standard'}</span>
              {chain.validationMode === 'strict'
                ? ' RFC 8693 act/may_act claims verified on every request'
                : ' Token exchange logged; act claims not strictly enforced'}
            </div>
            <p style={{ fontSize: 12, color: '#374151', marginTop: 8 }}>
              Last updated: {chain.metadata?.lastUpdated ? new Date(chain.metadata.lastUpdated).toLocaleTimeString() : '—'}
            </p>
          </div>
        </div>
      )}

      {/* Delegation events */}
      {!loading && delegationEvents.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 8 }}>Delegation Token Events</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {delegationEvents.map((evt, i) => (
              <div key={i} style={{ background: '#fefce8', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontWeight: 600, fontSize: 13, color: '#92400e' }}>{evt.type || 'exchange'}</span>
                  <span style={{ fontSize: 11, color: '#374151' }}>{evt.timestamp ? new Date(evt.timestamp).toLocaleTimeString() : ''}</span>
                </div>
                {evt.claims?.act && (
                  <div style={{ fontSize: 12, color: '#374151', fontFamily: 'inherit' }}>
                    <span style={S.infoPill}>act.sub</span> {evt.claims.act.sub || '—'}
                  </div>
                )}
                {evt.claims?.scope && (
                  <div style={{ fontSize: 12, color: '#374151', marginTop: 4 }}>
                    <span style={S.infoPill}>scope</span> {evt.claims.scope}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* MCP tool calls using delegation */}
      {!loading && mcpCalls.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 8 }}>
            MCP Tool Calls via Delegated Token
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>Tool</th>
                  <th style={S.th}>Acting As</th>
                  <th style={S.th}>Scopes Used</th>
                  <th style={S.th}>Time</th>
                </tr>
              </thead>
              <tbody>
                {mcpCalls.slice(0, 10).map((call, i) => (
                  <tr key={i}>
                    <td style={S.td}><code style={{ fontSize: 12 }}>{call.tool || call.toolName || '—'}</code></td>
                    <td style={S.td}>{call.actingSub || call.sub || '—'}</td>
                    <td style={S.td}>{call.scope || '—'}</td>
                    <td style={S.td}>{call.timestamp ? new Date(call.timestamp).toLocaleTimeString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && chain && delegationEvents.length === 0 && mcpCalls.length === 0 && (
        <div style={{ marginTop: 16, padding: '14px 16px', background: '#f8fafc', borderRadius: 8, fontSize: 13, color: '#374151' }}>
          No delegation token events in the current session. Grant access to a family member above and ask the banking agent
          to perform an action <em>on behalf of</em> the delegate to see the token chain populate here.
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Demo Talk Track
// ---------------------------------------------------------------------------
function DemoTalkTrackPanel() {
  const [open, setOpen] = useState(false);
  return (
    <div style={S.card}>
      <div
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
        onClick={() => setOpen(o => !o)}
      >
        <h2 style={{ ...S.sectionHeading, marginBottom: 0 }}>Demo Talk Track</h2>
        <span style={{ fontSize: 20, color: '#374151' }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <div style={{ marginTop: 16 }}>
          <p style={{ ...S.muted, marginBottom: 16 }}>
            Use this script when showing the delegation page to prospects. The goal is to connect the
            everyday concept of "adding someone to your bank account" to the technical reality of
            OAuth scopes, token exchange, and PingOne's identity capabilities.
          </p>

          {[
            {
              num: 1,
              heading: 'Set the scene',
              text: 'Open the page and point at the "Grant Account Access" form.',
              quote: '"This app lets customers delegate access to family members — maybe a spouse, a college student, or an accountant. This is a common real-world need."',
            },
            {
              num: 2,
              heading: 'Grant access live',
              text: 'Type a family member email and check 2-3 scopes. Click "Grant Access".',
              quote: '"When I click Grant, three things happen at once: PingOne checks if this user exists, creates them if not, stores the delegation with exactly the scopes I selected, and sends a branded email — all via PingOne APIs."',
            },
            {
              num: 3,
              heading: 'Point at the "How It Works" section',
              text: 'Expand the section and walk through the flow diagram left to right.',
              quote: '"Under the hood this is OAuth 2.0 delegated authorization. The key innovation is what happens at login — instead of a plain access token, PingOne mints an RFC 8693 token with an act claim that proves: this token is for the delegate, acting on behalf of the delegator."',
            },
            {
              num: 4,
              heading: 'Show the token structure',
              text: 'Point at the code block showing the act and may_act claims.',
              quote: '"This is not custom code — it\'s a standard anyone can verify. The act.sub claim is cryptographically bound to the delegator\'s identity. A resource server or AI agent can read this claim and know exactly whose data it\'s touching and on whose behalf."',
            },
            {
              num: 5,
              heading: 'Connect to the AI agent',
              text: 'Navigate to the AI agent, ask it to "check account balance for delegate@example.com".',
              quote: '"Now watch the Live Token Chain section — the agent performed an RFC 8693 token exchange, got a scoped token with the act claim, and called the banking MCP tool. The bank\'s API saw the exact scopes that were granted — nothing more."',
            },
            {
              num: 6,
              heading: 'Revoke and show the audit trail',
              text: 'Click Revoke on the delegate you just added. Switch to the History tab.',
              quote: '"I can revoke access at any time. The delegation history is a full audit trail — when it was granted, what scopes, when it was revoked. Regulators love this. Zero ambiguity."',
            },
          ].map(step => (
            <div key={step.num} style={S.talkStep}>
              <div style={S.talkNum}>{step.num}</div>
              <div>
                <p style={{ fontWeight: 700, fontSize: 13, color: '#111827', margin: '0 0 4px 0' }}>{step.heading}</p>
                <p style={{ fontSize: 12, color: '#374151', margin: '0 0 6px 0' }}>{step.text}</p>
                <p style={{ ...S.talkText, ...S.talkQuote, margin: 0 }}>"{step.quote.replace(/^"|"$/g, '')}"</p>
              </div>
            </div>
          ))}

          <div style={{ marginTop: 20, background: '#eff6ff', borderRadius: 8, padding: '14px 16px' }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: '#1e40af', margin: '0 0 8px 0' }}>Key objection: "Can't we just do this with role-based access?"</p>
            <p style={{ fontSize: 13, color: '#374151', margin: 0 }}>
              RBAC assigns roles to users — those roles are static and defined by the app developer.
              Delegated authorization lets the <em>account owner</em> define exactly which sub-set of their own
              permissions they share, for how long, and to whom. The AI agent enforces those boundaries
              at the token level — no custom authorization code required.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function DelegationPage({ user }) {
  const [delegations, setDelegations]     = useState([]);
  const [history, setHistory]             = useState([]);
  const [loading, setLoading]             = useState(true);
  const [pageError, setPageError]         = useState('');

  // Add delegate form
  const [delegateEmail, setDelegateEmail]   = useState('');
  const [selectedScopes, setSelectedScopes] = useState(['view_accounts', 'view_balances']);
  const [submitting, setSubmitting]         = useState(false);
  const [submitError, setSubmitError]       = useState('');
  const [submitSuccess, setSubmitSuccess]   = useState('');
  // Persistent credential card for a newly created delegate user (demo-only).
  const [newDelegateCreds, setNewDelegateCreds] = useState(null); // { email, password, reauthPending }
  const [credsCopied, setCredsCopied]           = useState(false);

  // Revoke
  const [revoking, setRevoking] = useState(null);

  // Tab
  const [activeSection, setActiveSection] = useState('active');

  const loadData = useCallback(async () => {
    try {
      const [delRes, histRes] = await Promise.all([
        fetch('/api/delegation', { credentials: 'include' }),
        fetch('/api/delegation/history', { credentials: 'include' }),
      ]);
      const [delData, histData] = await Promise.all([delRes.json(), histRes.json()]);
      setDelegations(delData.delegations || []);
      setHistory(histData.history || []);
    } catch (err) {
      setPageError('Failed to load delegation data: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleScopeToggle = (key) => {
    setSelectedScopes(prev =>
      prev.includes(key) ? prev.filter(s => s !== key) : [...prev, key]
    );
  };

  const handleGrant = async () => {
    if (!delegateEmail.trim()) { setSubmitError('Email is required.'); return; }
    if (selectedScopes.length === 0) { setSubmitError('Select at least one permission.'); return; }
    setSubmitting(true);
    setSubmitError('');
    setSubmitSuccess('');
    try {
      const res = await fetch('/api/delegation', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delegateEmail: delegateEmail.trim(), scopes: selectedScopes }),
      });
      const data = await res.json();
      if (!data.ok) {
        setSubmitError(data.message || `Grant failed (${data.error || 'unknown error'})`);
      } else {
        setDelegateEmail('');
        setSelectedScopes(['view_accounts', 'view_balances']);
        await loadData();
        if (data.credentials) {
          // A new PingOne user was created for the delegate — show a persistent
          // credential card. The silent re-auth is a full-page redirect, so we
          // defer it until the card is dismissed (✕) to keep the credentials visible.
          setNewDelegateCreds({
            email: data.credentials.email,
            password: data.credentials.password,
            reauthPending: !!data.reauthRequired,
          });
        } else {
          setSubmitSuccess(
            data.warning
              ? `Access granted to ${delegateEmail.trim()} ⚠️ ${data.warning}`
              : `Access granted to ${delegateEmail.trim()}`
          );
          // Silently re-auth so the re-issued token carries the updated delegated_to.
          // Show the confirmation first, then reload via SSO after a short delay.
          if (data.reauthRequired) {
            setTimeout(() => requestSilentReauth(window.location.pathname), 1200);
          }
        }
      }
    } catch (err) {
      setSubmitError('Network error: ' + err.message);
    } finally {
      setSubmitting(false);
      setTimeout(() => { setSubmitError(''); setSubmitSuccess(''); }, 4000);
    }
  };

  const dismissCredsCard = () => {
    const pending = newDelegateCreds?.reauthPending;
    setNewDelegateCreds(null);
    setCredsCopied(false);
    // Run the deferred silent re-auth so the re-issued token carries delegated_to.
    if (pending) requestSilentReauth(window.location.pathname);
  };

  const copyCreds = async () => {
    if (!newDelegateCreds) return;
    try {
      await navigator.clipboard.writeText(
        `Email: ${newDelegateCreds.email}\nPassword: ${newDelegateCreds.password}\nLogin: ${window.location.origin}`
      );
      setCredsCopied(true);
      setTimeout(() => setCredsCopied(false), 2000);
    } catch {
      /* clipboard unavailable — credentials remain visible on the card */
    }
  };

  const handleRevoke = async (id) => {
    setRevoking(id);
    try {
      const res = await fetch(`/api/delegation/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!data.ok) {
        console.error('[DelegationPage] revoke failed:', data);
      }
      await loadData();
      // Silently re-auth so the re-issued token reflects the removed delegated_to.
      if (data.ok && data.reauthRequired) {
        setTimeout(() => requestSilentReauth(window.location.pathname), 1200);
      }
    } catch (err) {
      console.error('[DelegationPage] revoke error:', err.message);
    } finally {
      setRevoking(null);
    }
  };

  return (
    <div style={S.page}>
      {/* Branded gradient page header */}
      <div style={{
        background: 'linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%)',
        padding: '28px 24px 20px',
        marginBottom: 24,
        borderRadius: '0 0 12px 12px',
      }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>
            Account Management
          </p>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#fff', margin: 0 }}>👥 Family Delegation</h1>
          <p style={{ color: 'rgba(255,255,255,0.75)', fontSize: 14, margin: '6px 0 0' }}>
            Grant family members scoped access to your accounts — powered by RFC 8693 token exchange and PingOne
          </p>
        </div>
      </div>

      <div style={S.inner}>
        {pageError && <div style={S.errorBanner}>{pageError}</div>}

        {/* AI agent authorization (RFC 8693 may_act) */}
        <AgentAuthorizationCard />

        {/* How it works — top explainer */}
        <HowItWorksPanel />

        {/* Grant access card */}
        <div style={S.card}>
          <h2 style={S.sectionHeading}>Grant Account Access</h2>
          <p style={S.muted}>
            Enter a family member's email to grant them scoped access to your accounts.
            They will receive an email notification and can log in immediately.
          </p>

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
              Family member's email
            </label>
            <input
              type="email"
              placeholder="family@example.com"
              value={delegateEmail}
              onChange={e => setDelegateEmail(e.target.value)}
              style={S.input}
              onKeyDown={e => e.key === 'Enter' && handleGrant()}
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 8 }}>
              Allow them to: <span style={{ fontSize: 12, fontWeight: 400, color: '#374151' }}>
                (these become OAuth scopes on their token)
              </span>
            </p>
            {VALID_SCOPES.map(scope => (
              <label key={scope.key} style={S.scopeRow}>
                <input
                  type="checkbox"
                  checked={selectedScopes.includes(scope.key)}
                  onChange={() => handleScopeToggle(scope.key)}
                  style={{ marginTop: 2 }}
                />
                <span>
                  <span style={S.scopeLabel}>{scope.label}</span>
                  <span style={S.scopeDesc}> — {scope.description}</span>
                  <span style={{ ...S.infoPill, marginLeft: 8 }}>{scope.key}</span>
                </span>
              </label>
            ))}
          </div>

          {submitError   && <div style={S.errorBanner}>{submitError}</div>}
          {submitSuccess && <div style={S.successBanner}>{submitSuccess}</div>}

          {/* Demo-only credential card for a newly created delegate user */}
          {newDelegateCreds && (
            <div style={{
              marginTop: 16, borderRadius: 8, border: '2px solid #1e40af',
              background: '#eff6ff', padding: '16px 18px', position: 'relative',
            }}>
              <button
                onClick={dismissCredsCard}
                aria-label="Dismiss credentials"
                style={{
                  position: 'absolute', top: 10, right: 12, background: 'none', border: 'none',
                  color: '#1e3a5f', fontSize: 16, fontWeight: 700, cursor: 'pointer', lineHeight: 1, padding: 0,
                }}
              >✕</button>
              <p style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700, color: '#1e3a5f' }}>
                ✓ Delegate account created — share these credentials with your demo user:
              </p>
              <div style={{ fontSize: 14, color: '#111827', lineHeight: 1.8 }}>
                <div><span style={{ fontWeight: 700 }}>Email:</span> <code style={{ fontSize: 13 }}>{newDelegateCreds.email}</code></div>
                <div><span style={{ fontWeight: 700 }}>Password:</span> <code style={{ fontSize: 13 }}>{newDelegateCreds.password}</code></div>
                <div><span style={{ fontWeight: 700 }}>Login URL:</span> <code style={{ fontSize: 13 }}>{window.location.origin}</code></div>
              </div>
              <p style={{ margin: '10px 0 12px', fontSize: 13, fontWeight: 600, color: '#1e3a5f' }}>
                Log in as this user to see the delegated access.
              </p>
              <button onClick={copyCreds} style={{ ...S.primaryBtn, padding: '7px 16px', fontSize: 13 }}>
                {credsCopied ? '✓ Copied' : 'Copy credentials'}
              </button>
            </div>
          )}

          <div style={{ marginTop: 16 }}>
            <button
              onClick={handleGrant}
              disabled={submitting || !delegateEmail.trim() || selectedScopes.length === 0}
              style={submitting || !delegateEmail.trim() || selectedScopes.length === 0 ? S.primaryBtnDisabled : S.primaryBtn}
            >
              {submitting ? 'Granting…' : 'Grant Access'}
            </button>
          </div>
        </div>

        {/* Active / History tabs */}
        <div style={S.card}>
          <div style={S.tabBar}>
            {[
              { key: 'active',  label: `Active Delegates (${delegations.length})` },
              { key: 'history', label: 'Delegation History' },
            ].map(tab => (
              <button key={tab.key} onClick={() => setActiveSection(tab.key)} style={S.tabBtn(activeSection === tab.key)}>
                {tab.label}
              </button>
            ))}
          </div>

          {/* Active delegates */}
          {activeSection === 'active' && (
            loading
              ? <p style={S.muted}>Loading…</p>
              : delegations.length === 0
                ? (
                  <div style={{ padding: '16px 0', color: '#374151', fontSize: 13 }}>
                    <p style={{ margin: '0 0 8px' }}>No active delegates.</p>
                    <p style={{ margin: 0 }}>Use the Grant Access form above to add a family member. They will appear here once access is granted.</p>
                  </div>
                )
                : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {delegations.map(d => (
                      <div key={d.id} style={S.delegCard}>
                        <div style={S.delegCardLeft}>
                          <div style={S.delegEmail}>{d.delegateEmail || d.delegate_email}</div>
                          <div style={S.delegMeta}>
                            Granted {d.granted_at ? new Date(d.granted_at).toLocaleDateString() : '—'}
                          </div>
                          <div style={S.pillsRow}>
                            {(d.scopes || []).map(s => (
                              <span key={s} style={S.pill}>{s.replace(/_/g, ' ')}</span>
                            ))}
                          </div>
                        </div>
                        <button
                          onClick={() => handleRevoke(d.id)}
                          disabled={revoking === d.id}
                          style={revoking === d.id ? S.dangerBtnDisabled : S.dangerBtn}
                        >
                          {revoking === d.id ? 'Revoking…' : 'Revoke'}
                        </button>
                      </div>
                    ))}
                  </div>
                )
          )}

          {/* Delegation history */}
          {activeSection === 'history' && (
            loading
              ? <p style={S.muted}>Loading…</p>
              : history.length === 0
                ? <p style={S.muted}>No delegation history.</p>
                : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={S.table}>
                      <thead>
                        <tr>
                          <th style={S.th}>Delegate</th>
                          <th style={S.th}>Permissions</th>
                          <th style={S.th}>Status</th>
                          <th style={S.th}>Granted</th>
                          <th style={S.th}>Revoked</th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.map(h => (
                          <tr key={h.id}>
                            <td style={S.td}>{h.delegateEmail || h.delegate_email}</td>
                            <td style={S.td}>{(h.scopes || []).map(s => s.replace(/_/g, ' ')).join(', ')}</td>
                            <td style={S.td}>
                              <span style={S.statusBadge(h.status)}>{h.status}</span>
                            </td>
                            <td style={S.td}>{h.granted_at ? new Date(h.granted_at).toLocaleDateString() : '—'}</td>
                            <td style={S.td}>{h.revoked_at ? new Date(h.revoked_at).toLocaleDateString() : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
          )}
        </div>

        {/* Live token chain */}
        <LiveTokenChainPanel />

        {/* Demo talk track */}
        <DemoTalkTrackPanel />
      </div>
    </div>
  );
}
