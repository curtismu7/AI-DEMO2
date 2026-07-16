// banking_api_ui/src/components/education/TokenExchangePanel.js
import React, { useState, useEffect } from 'react';
import { getCachedJson } from '../../services/cachedStatusService';
import { useEducationUI } from '../../context/EducationUIContext';
import EducationDrawer from '../shared/EducationDrawer';
import JsonHighlight from '../shared/JsonHighlight';
import { EDU } from './educationIds';
import {
  EduImplIntro,
  SNIP_RESOLVE_MCP_TOKEN,
  SNIP_TOKEN_EXCHANGE_PINGONE,
} from './educationImplementationSnippets';

// ─── See Also: Token Flow Panel link ────────────────────────────────────────
function TokenFlowLink({ onClick }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      background: '#1e3a5f',
      border: '1px solid #3b82f6',
      borderRadius: '8px',
      padding: '10px 14px',
      marginTop: '16px',
      flexWrap: 'wrap',
    }}>
      <span style={{ fontSize: '1.1rem' }}>🔗</span>
      <span style={{ color: '#93c5fd', fontSize: '0.85rem', flex: '1 1 160px' }}>
        <strong>See also:</strong> Token Flow Education Panel — full token exchange walkthrough with act claim chain, scope narrowing, and a live What Changed table.
      </span>
      <button
        onClick={onClick}
        style={{
          background: '#2563eb',
          color: '#fff',
          border: 'none',
          borderRadius: '6px',
          padding: '6px 14px',
          fontSize: '0.8125rem',
          fontWeight: 600,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        Open Token Flow Panel →
      </button>
    </div>
  );
}

// ─── Token Exchange Flow Diagram ──────────────────────────────────────────────

function TokenFlowDiagram() {
  return (
    <div style={{ overflowX: 'auto', padding: '8px 0', WebkitOverflowScrolling: 'touch' }}>
      <div style={{
        fontFamily: 'inherit',
        fontSize: '0.78rem',
        lineHeight: '1.7',
        background: '#0f172a',
        color: '#e2e8f0',
        borderRadius: '8px',
        padding: '20px 24px',
        minWidth: 'min(920px, 100%)',
        boxSizing: 'border-box',
      }}>
        {/* Key guarantee banner */}
        <div style={{
          background: '#14532d',
          border: '1px solid #16a34a',
          borderRadius: '6px',
          padding: '8px 14px',
          marginBottom: '20px',
          color: '#86efac',
          fontWeight: 600,
          fontSize: '0.82rem',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-start',
          gap: '8px',
        }}>
          <span style={{ flexShrink: 0 }} aria-hidden>🔒</span>
          <span style={{ flex: '1 1 220px', minWidth: 0 }}>
            Security guarantee: The User Token NEVER leaves the Backend-for-Frontend (BFF) — only the MCP Token reaches the MCP Server or Banking API.
          </span>
        </div>

        {/* Flow diagram */}
        <FlowRow
          left={<Box label="Browser / User" icon="👤" color="#1e3a5f" border="var(--brand-navy)" />}
          arrow="── User Token ──────────────────→"
          arrowColor="var(--brand-navy-light)"
          right={<Box label="Backend-for-Frontend (BFF)" icon="🏦" color="#1e3a5f" border="var(--brand-navy)" note="Stores User Token in session" />}
        />
        <ConnectorDown />

        <FlowRow
          left={<div style={{ width: '180px' }} />}
          arrow="── User Token (subject_token) ──→"
          arrowColor="#a78bfa"
          note="Token Exchange Request"
          right={<Box label="PingOne" icon="🔐" color="#2d1b69" border="#8b5cf6" note="Validates grants + issues MCP Token" />}
        />
        <ConnectorDown right />

        <FlowRow
          left={<div style={{ width: '180px' }} />}
          arrow="←── MCP Token (delegated) ────"
          arrowColor="#34d399"
          arrowRight={false}
          right={<div style={{ width: '180px' }} />}
        />
        <ConnectorDown />

        <FlowRow
          left={<Box label="Backend-for-Frontend (BFF)" icon="🏦" color="#1e3a5f" border="var(--brand-navy)" note="Holds User Token — never forwarded" />}
          arrow="── MCP Token only ──────────────→"
          arrowColor="#34d399"
          right={<Box label="MCP Server" icon="🤖" color="#1a2e1a" border="#22c55e" note="Validates MCP Token via introspection" />}
        />
        <ConnectorDown right />

        <FlowRow
          left={<div style={{ width: '180px' }} />}
          arrow="── MCP Token only ──────────────→"
          arrowColor="#34d399"
          right={<Box label="Banking API" icon="💳" color="#1a2e1a" border="#22c55e" note="Checks aud, scope, act claims" />}
        />
      </div>

      {/* Token comparison */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '12px',
        marginTop: '16px',
      }}>
        <TokenCompareCard
          title="User Token"
          emoji="👤"
          color="#1e3a5f"
          border="var(--brand-navy)"
          claims={[
            { key: 'aud', val: 'Backend-for-Frontend (BFF) / PingOne client', note: 'broad' },
            { key: 'scope', val: 'openid email *', note: 'broad' },
            { key: 'act', val: '(absent)', note: '' },
            { key: 'stays in', val: 'Backend-for-Frontend (BFF) session only', note: '🔒 never forwarded' },
          ]}
        />
        <TokenCompareCard
          title="MCP Token"
          emoji="🤖"
          color="#1a2e1a"
          border="#22c55e"
          claims={[
            { key: 'aud', val: 'mcp-server-resource-uri', note: 'narrowed ✓' },
            { key: 'scope', val: 'read write', note: 'narrowed ✓' },
            { key: 'act', val: '{ "sub": "bff-client-id" }', note: 'delegation fact ✓' },
            { key: 'sent to', val: 'MCP Server + Banking API', note: '✅' },
          ]}
        />
      </div>
    </div>
  );
}

function Box({ label, icon, color, border, note }) {
  return (
    <div style={{
      width: '180px',
      background: color,
      border: `1px solid ${border}`,
      borderRadius: '6px',
      padding: '8px 10px',
      textAlign: 'center',
      fontSize: '0.75rem',
    }}>
      <div style={{ fontSize: '1.1rem', marginBottom: '2px' }}>{icon}</div>
      <div style={{ fontWeight: 700, color: '#f1f5f9' }}>{label}</div>
      {note && <div style={{ color: '#374151', fontSize: '0.68rem', marginTop: '3px' }}>{note}</div>}
    </div>
  );
}

function FlowRow({ left, arrow, arrowColor, arrowRight = true, right, note }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
      {left}
      <div style={{ flex: 1, textAlign: 'center' }}>
        <div style={{ color: arrowColor, fontWeight: 600, fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
          {arrow}
        </div>
        {note && <div style={{ color: '#374151', fontSize: '0.68rem' }}>{note}</div>}
      </div>
      {right}
    </div>
  );
}

function ConnectorDown({ right }) {
  return (
    <div style={{ display: 'flex', marginBottom: '4px', paddingLeft: right ? 'calc(180px + 8px + 50%)' : '89px' }}>
      <div style={{ color: '#475569', fontSize: '0.9rem' }}>│</div>
    </div>
  );
}

function TokenCompareCard({ title, emoji, color, border, claims }) {
  return (
    <div style={{
      background: color,
      border: `1px solid ${border}`,
      borderRadius: '8px',
      padding: '12px 14px',
      fontSize: '0.75rem',
    }}>
      <div style={{ fontWeight: 700, marginBottom: '8px', color: '#f1f5f9' }}>{emoji} {title}</div>
      {claims.map(({ key, val, note }) => (
        <div key={key} style={{ display: 'flex', gap: '6px', marginBottom: '4px', alignItems: 'flex-start' }}>
          <span style={{ color: '#374151', minWidth: '70px', flexShrink: 0 }}>{key}:</span>
          <span style={{ color: '#e2e8f0', wordBreak: 'break-all' }}>
            {val}
            {note && <span style={{ color: '#374151', marginLeft: '4px' }}>({note})</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export default function TokenExchangePanel({ isOpen, onClose, initialTabId }) {
  const { open: openEdu } = useEducationUI();
  const [live, setLive] = useState({ loading: false, error: null, userToken: null });

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      setLive((s) => ({ ...s, loading: true, error: null }));
      try {
        let r = await getCachedJson('/api/auth/oauth/status');
        if (!r.data?.authenticated) r = await getCachedJson('/api/auth/oauth/user/status');
        if (cancelled) return;
        if (r.data?.authenticated && r.data?.accessToken) {
          const parts = r.data.accessToken.split('.');
          let payload = null;
          if (parts.length === 3) {
            try { payload = JSON.parse(atob(parts[1])); } catch (_) {}
          }
          setLive({ loading: false, error: null, userToken: { raw: r.data.accessToken, payload, expiresAt: r.data.expiresAt } });
        } else {
          setLive({ loading: false, error: 'No session token available — please sign in.', userToken: null });
        }
      } catch (e) {
        if (!cancelled) setLive({ loading: false, error: e.message, userToken: null });
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen]);

  const tabs = [
    {
      id: 'diagram',
      label: 'Flow Diagram',
      content: (
        <>
          <h3>Token Exchange Flow</h3>
          <p>
            When the AI Agent makes a banking request on your behalf, the Backend-for-Frontend (BFF) performs an RFC 8693 Token Exchange
            to obtain a narrowly-scoped <strong>MCP Token</strong>. Your <strong>User Token</strong> is never forwarded —
            it stays locked in the Backend-for-Frontend (BFF) session.
          </p>
          <TokenFlowDiagram />
          <TokenFlowLink onClick={() => openEdu(EDU.TOKEN_FLOW, 'diagram')} />
        </>
      ),
    },
    {
      id: 'why',
      label: 'What & Why',
      content: (
        <>
          <h3>Three Tokens, Three Jobs</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', marginBottom: '16px' }}>
            <thead>
              <tr style={{ background: '#1e293b' }}>
                <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid #334155', color: '#e2e8f0', fontWeight: 600 }}>Token</th>
                <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid #334155', color: '#e2e8f0', fontWeight: 600 }}>Issued by</th>
                <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid #334155', color: '#e2e8f0', fontWeight: 600 }}>Used for</th>
                <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid #334155', color: '#e2e8f0', fontWeight: 600 }}>Stays in</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid #334155' }}><strong>User Token</strong></td>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid #334155' }}>PingOne login flow</td>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid #334155' }}>Authenticating the user session in the Backend-for-Frontend (BFF)</td>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid #334155', color: '#86efac' }}>🔒 Backend-for-Frontend (BFF) only</td>
              </tr>
              <tr>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid #334155' }}><strong>Agent Token</strong></td>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid #334155' }}>Client credentials grant</td>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid #334155' }}>actor_token in the RFC 8693 exchange request</td>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid #334155', color: '#86efac' }}>🔒 Backend-for-Frontend (BFF) only</td>
              </tr>
              <tr>
                <td style={{ padding: '8px 10px' }}><strong>MCP Token</strong></td>
                <td style={{ padding: '8px 10px' }}>RFC 8693 exchange</td>
                <td style={{ padding: '8px 10px' }}>Calling the MCP Server and Banking API</td>
                <td style={{ padding: '8px 10px', color: 'var(--brand-navy-light)' }}>✅ Sent to MCP Server</td>
              </tr>
            </tbody>
          </table>
          <h3>Why Exchange Instead of Forwarding?</h3>
          <ul>
            <li><strong>Audience isolation</strong> — the User Token has a broad audience (Backend-for-Frontend (BFF) / PingOne). The MCP Server expects its own resource URI as audience. Forwarding the User Token would cause an <code>invalid_aud</code> rejection.</li>
            <li><strong>Scope narrowing</strong> — the MCP Token carries only the scopes needed for the specific tool call (e.g. <code>read</code>), not the user's full permissions.</li>
            <li><strong>Delegation audit trail</strong> — the <code>act</code> claim in the MCP Token records who is acting (the Backend-for-Frontend (BFF) / Agent). Without exchange there is no delegation record.</li>
            <li><strong>Least privilege</strong> — if the MCP Server or Banking API is compromised, the attacker only has the narrow MCP Token, not the user's full User Token.</li>
          </ul>
        </>
      ),
    },
    {
      id: 'before',
      label: 'BEFORE (no exchange)',
      content: (
        <>
          <h3>The broken pattern — forwarding the User Token directly</h3>
          <p>If the Backend-for-Frontend (BFF) forwarded the User Token directly to the MCP Server:</p>
          <ul>
            <li><strong>Wrong <code>aud</code></strong> — MCP Server expects its own resource audience; validation fails with <code>invalid_aud</code>.</li>
            <li><strong>No <code>act</code> claim</strong> — delegation is invisible at the MCP layer; who acted on the user's behalf cannot be audited.</li>
            <li><strong>Over-privileged</strong> — a broadly-scoped User Token is exposed to the MCP trust boundary unnecessarily.</li>
            <li><strong>Leakage risk</strong> — if the MCP Server is compromised, the attacker holds the user's full User Token.</li>
          </ul>
          <pre className="edu-code">{`// ❌ WRONG — forwarding User Token directly
fetch(MCP_SERVER_URL, {
  headers: { Authorization: \`Bearer \${userToken}\` }
});
// MCP Server rejects: aud mismatch
// Audit log: no delegation record`}</pre>
        </>
      ),
    },
    {
      id: 'after',
      label: 'AFTER (RFC 8693)',
      content: (
        <>
          <h3>Correct flow — exchange then forward MCP Token</h3>
          <p>Backend-for-Frontend (BFF) calls PingOne <code>POST …/as/token</code>:</p>
          <pre className="edu-code">{`grant_type=urn:ietf:params:oauth:grant-type:token-exchange
subject_token=<User Token>
subject_token_type=urn:ietf:params:oauth:token-type:access_token
audience=<MCP Server Resource URI>
scope=read write
# Optional — adds act claim identifying the agent:
actor_token=<Agent Token>
actor_token_type=urn:ietf:params:oauth:token-type:access_token`}</pre>
          <p><strong>Response</strong> is the MCP Token — a new JWT with:</p>
          <ul>
            <li><code>aud</code> = MCP Server Resource URI</li>
            <li><code>scope</code> = narrowed to tool scopes</li>
            <li><code>act</code> = <code>{'{ "sub": "bff-client-id" }'}</code> (delegation fact)</li>
            <li><code>may_act</code> = removed (no longer needed)</li>
          </ul>
          <pre className="edu-code">{`// ✅ CORRECT — forward only the MCP Token
fetch(MCP_SERVER_URL, {
  headers: { Authorization: \`Bearer \${mcpToken}\` }
});
// MCP Server: aud ✓, scope ✓, act ✓
// Audit log: "Backend-for-Frontend (BFF) acted on behalf of user@example.com"`}</pre>
        </>
      ),
    },
    {
      id: 'mayact',
      label: 'may_act / act',
      content: (
        <>
          <h3>may_act vs act — prospective vs current</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', marginBottom: '16px' }}>
            <thead>
              <tr style={{ background: '#1e293b' }}>
                <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid #334155', color: '#e2e8f0', fontWeight: 600 }}>Claim</th>
                <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid #334155', color: '#e2e8f0', fontWeight: 600 }}>In which token</th>
                <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid #334155', color: '#e2e8f0', fontWeight: 600 }}>Meaning</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid #334155' }}><code>may_act</code></td>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid #334155' }}>User Token</td>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid #334155' }}><em>Prospective</em> — "this service (<code>sub</code>) is allowed to exchange this token"</td>
              </tr>
              <tr>
                <td style={{ padding: '8px 10px' }}><code>act</code></td>
                <td style={{ padding: '8px 10px' }}>MCP Token</td>
                <td style={{ padding: '8px 10px' }}><em>Fact</em> — "this service (<code>sub</code>) IS acting right now on behalf of the user"</td>
              </tr>
            </tbody>
          </table>
          
          {/* Educational callout about sub and act claims */}
          <div style={{
            background: '#f0f9ff',
            border: '1px solid #0ea5e9',
            borderRadius: '8px',
            padding: '12px 16px',
            margin: '16px 0',
          }}>
            <div style={{
              color: '#0c4a6e',
              fontWeight: 600,
              fontSize: '0.85rem',
              marginBottom: '6px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}>
              <span aria-hidden>🔍</span>
              Identity Chain in Delegated Tokens
            </div>
            <div style={{
              color: '#0c4a6e',
              fontSize: '0.78rem',
              lineHeight: '1.5',
            }}>
              <p style={{ margin: '0 0 8px 0' }}>
                In a delegated token, the identity chain follows this pattern:
              </p>
              <ul style={{ margin: '0 0 8px 0', paddingLeft: '16px' }}>
                <li><strong>sub</strong> = the human user (who the token is for)</li>
                <li><strong>act.sub</strong> = the AI agent (who is acting on behalf of the user)</li>
                <li><strong>act.act.sub</strong> = the MCP server (2-exchange only)</li>
              </ul>
              <p style={{ margin: 0, fontStyle: 'italic' }}>
                This creates a verifiable audit trail showing exactly who authorized whom to act on their behalf.
              </p>
            </div>
          </div>
          
          <h3>PingOne validation steps</h3>
          <ol>
            <li>Verify User Token signature and expiry.</li>
            <li>Check <code>may_act</code> (or policy) allows this Backend-for-Frontend (BFF) client_id to exchange.</li>
            <li>Verify requested <code>audience</code> is allowed for this exchange.</li>
            <li>Verify requested <code>scope</code> ⊆ original User Token scope.</li>
            <li>Issue MCP Token with <code>act</code> claim; failures return <code>invalid_grant</code>.</li>
          </ol>
        </>
      ),
    },
    {
      id: 'setup',
      label: 'Setup Guide',
      content: (
        <>
          <h3>What you need in PingOne</h3>
          <p>Token exchange requires specific configuration in PingOne and your environment variables.</p>

          <h4>Step 1 — Token Exchange Client (for Agent Token)</h4>
          <p>
            Create a dedicated <strong>Client Credentials</strong> application in PingOne. This is your <em>Agent</em> — it
            represents the AI acting on behalf of users, not a user itself.
          </p>
          <pre className="edu-code">{`PingOne → Applications → Add Application
  Type: Worker   ← M2M only, no redirect URIs, no user login
  Grant type: Client Credentials (set automatically for Worker apps)
  Scopes: openid (or custom agent scopes)

→ Copy the Client ID and Client Secret`}</pre>

          <h4>Step 2 — Register a Resource in PingOne</h4>
          <p>
            The MCP Server needs its own <strong>Resource URI</strong> (audience) so PingOne knows what the MCP Token
            is valid for.
          </p>
          <pre className="edu-code">{`PingOne → Applications → Resources → Add Resource
  Name: Banking MCP Server
  Audience (Resource URI): https://mcp.yourdomain.com
  Scopes: read, write

→ Copy the Audience URI`}</pre>

          <h4>Step 3 — Enable Token Exchange Grant</h4>
          <p>
            On your <strong>Backend-for-Frontend (BFF) application</strong> (the admin/user OAuth client), enable the Token Exchange grant
            and configure may_act policy so only the Backend-for-Frontend (BFF) can exchange tokens.
          </p>
          <pre className="edu-code">{`PingOne → Applications → (your Backend-for-Frontend (BFF) app) → Grant Types
  ✓ Token Exchange (RFC 8693)

→ Token Policy → may_act
  Allowed Actor: <your Backend-for-Frontend (BFF) OAuth client ID>`}</pre>

          <h4>Step 4 — Environment Variables</h4>
          <pre className="edu-code">{`# In your .env / Vercel environment variables:

# Agent Token (Client Credentials client for the Agent)
AGENT_OAUTH_CLIENT_ID=<client-id-from-step-1>
AGENT_OAUTH_CLIENT_SECRET=<client-secret-from-step-1>
USE_AGENT_ACTOR_FOR_MCP=true

# MCP Server Resource URI (audience for MCP Token)
MCP_SERVER_RESOURCE_URI=https://mcp.yourdomain.com

# Backend-for-Frontend (BFF) Client ID (for may_act validation)
BFF_CLIENT_ID=<your-bff-oauth-client-id>`}</pre>

          <h4>Do I need a new client for token exchange?</h4>
          <p>
            <strong>Yes</strong> — you need one new <em>Client Credentials</em> client (the Agent Token client).
            This is separate from your existing Backend-for-Frontend (BFF) clients (admin and user login clients).
            The Agent Token client has no users — it represents the AI agent as a service principal.
          </p>
          <ul>
            <li><strong>Existing Backend-for-Frontend (BFF) client</strong> (unchanged) — handles Authorization Code + PKCE for user login, performs the exchange</li>
            <li><strong>New Agent Token client</strong> — Client Credentials only, provides actor_token for delegation</li>
          </ul>
        </>
      ),
    },
    {
      id: 'inrepo',
      label: 'In this repo',
      content: (
        <>
          <h3 style={{ marginTop: 0 }}>How the BFF performs exchange</h3>
          <EduImplIntro repoPath="demo_api_server/services/agentMcpTokenService.js">
            Resolves the user&apos;s session access token, checks scopes / demo flags, then calls PingOne.
          </EduImplIntro>
          <pre className="edu-code">{SNIP_RESOLVE_MCP_TOKEN}</pre>
          <EduImplIntro repoPath="demo_api_server/services/oauthService.js">
            The actual <code>POST …/as/token</code> body (with optional <code>actor_token</code>).
          </EduImplIntro>
          <pre className="edu-code">{SNIP_TOKEN_EXCHANGE_PINGONE}</pre>
        </>
      ),
    },
    {
      id: 'live',
      label: 'Live Tokens',
      content: (
        <>
          <h3>Your current User Token</h3>
          <p>
            The User Token is stored in the Backend-for-Frontend (BFF) session (httpOnly cookie). It is never stored in the React app.
            The Backend-for-Frontend (BFF) exposes only the decoded payload here for educational purposes.
          </p>
          {live.loading && <p>Loading…</p>}
          {live.error && <p style={{ color: '#b91c1c' }}>{live.error}</p>}
          {!live.loading && live.userToken?.payload && (
            <>
              <p><strong>User Token — decoded claims</strong></p>
              <pre className="edu-code"><JsonHighlight value={live.userToken.payload} /></pre>
              <p style={{ marginTop: '12px', padding: '10px', background: '#14532d', borderRadius: '6px', color: '#86efac', fontSize: '0.83rem' }}>
                🔒 <strong>The MCP Token</strong> is minted on the server when the AI Agent makes a tool call — it is never
                stored in the browser. To see the MCP Token claims, make a banking request via the AI Agent panel
                and watch the Token Chain display on your dashboard.
              </p>
              {live.userToken.payload.may_act ? (
                <div style={{ marginTop: '10px', padding: '10px', background: '#1e3a5f', borderRadius: '6px', color: '#93c5fd', fontSize: '0.83rem' }}>
                  ✅ <strong>may_act is present</strong> — PingOne will allow the Backend-for-Frontend (BFF) to exchange this token.
                  <pre className="jh-dark" style={{ margin: '6px 0 0', background: 'none', padding: 0 }}><JsonHighlight value={live.userToken.payload.may_act} /></pre>
                </div>
              ) : (
                <div style={{ marginTop: '10px', padding: '10px', background: '#7f1d1d', borderRadius: '6px', color: '#fca5a5', fontSize: '0.83rem' }}>
                  ⚠️ <strong>may_act is absent</strong> — configure the may_act claim in PingOne token policy to enable token exchange.
                </div>
              )}
              <TokenFlowLink onClick={() => openEdu(EDU.TOKEN_FLOW, 'what-changed')} />
            </>
          )}
        </>
      ),
    },
    {
      id: 'compliance',
      label: '✓ Compliance',
      content: (
        <>
          <h3 style={{ marginTop: 0 }}>IDC AI Governance Compliance</h3>
          <p>
            This demo implements RFC 8693 §2.1 + §4, which fulfills two of the five IDC AI governance guardrails:
          </p>
          <ul style={{ paddingLeft: 20, lineHeight: 1.8 }}>
            <li>
              <strong>Guardrail 02:</strong> Delegated authorization with full audit trail across agent chains
              <br/>
              <em>Standards: Identity Chaining + ID-JAG + RFC 8693 Token Exchange</em>
            </li>
            <li>
              <strong>Guardrail 03:</strong> Explainability logs — every action traceable to its authorization decision
              <br/>
              <em>Standards: RFC 8693 nested act claims + Identity Chaining audit chain</em>
            </li>
          </ul>
          <p style={{ marginTop: 16 }}>
            <strong>Learn more:</strong> See the <strong>IETF Standards: Agentic Identity</strong> panel for the full stack.
          </p>
        </>
      ),
    },];

  return (
    <EducationDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="Token Exchange (RFC 8693)"
      tabs={tabs}
      initialTabId={initialTabId || 'diagram'}
      width="min(1080px, calc(100vw - 20px))"
    />
  );
}
