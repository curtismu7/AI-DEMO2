// banking_api_ui/src/components/education/BestPracticesPanel.js
import React from 'react';
import EducationDrawer from '../shared/EducationDrawer';
import { useEducationUI } from '../../context/EducationUIContext';
import { EDU } from './educationIds';
import { EduImplIntro, SNIP_RESOLVE_MCP_TOKEN, SNIP_CIBA_INITIATE } from './educationImplementationSnippets';

// ─── Shared sub-components ────────────────────────────────────────────────────

/** Highlight card used inside tab bodies. */
function PracticeCard({ icon, title, children }) {
  return (
    <div style={{
      background: 'rgba(37,99,235,0.06)',
      border: '1px solid rgba(37,99,235,0.18)',
      borderRadius: 10,
      padding: '12px 16px',
      marginBottom: 12,
    }}>
      <p style={{ margin: '0 0 6px', fontWeight: 700, fontSize: '0.92rem', display: 'flex', alignItems: 'center', gap: 7 }}>
        <span style={{ fontSize: '1.1rem' }}>{icon}</span>{title}
      </p>
      <div style={{ fontSize: '0.83rem', color: '#374151', lineHeight: 1.6 }}>{children}</div>
    </div>
  );
}

/** ✅ / ⚠️ implementation status row. */
function ImplRow({ status, label, detail }) {
  const colour = status === 'done' ? '#15803d' : status === 'partial' ? '#b45309' : '#6b7280';
  const icon   = status === 'done' ? '✅' : status === 'partial' ? '⚠️' : '📋';
  return (
    <li style={{ marginBottom: 8, color: colour }}>
      {icon} <strong>{label}</strong>
      {detail && <span style={{ color: '#374151', fontWeight: 400 }}> — {detail}</span>}
    </li>
  );
}

/** Link-like button that opens another edu panel. */
function EduLink({ label, panelId, tabId, onClick }) {
  return (
    <button
      type="button"
      onClick={() => onClick(panelId, tabId)}
      style={{
        background: 'none',
        border: '1px solid #6366f1',
        borderRadius: 6,
        color: '#4f46e5',
        padding: '3px 10px',
        fontSize: '0.78rem',
        fontWeight: 600,
        cursor: 'pointer',
        marginRight: 6,
        marginTop: 4,
        display: 'inline-block',
      }}
    >
      {label} ↗
    </button>
  );
}

// ─── Overview grid (mirrors the PingOne slide) ─────────────────────────

const PRACTICES = [
  {
    id: 'know',
    icon: '🤖',
    title: 'Know Your Agents',
    tagline: 'Identify & Classify AI Agents',
    bullets: ['Assign sponsors to govern agent access', 'Manage agent lifecycles'],
    colour: 'var(--brand-navy)',
  },
  {
    id: 'detect',
    icon: '🔍',
    title: 'Detect Agents',
    tagline: 'Identify when session is agentic',
    bullets: ['Apply specific IAM controls for CUA', 'Tag agent sessions'],
    colour: '#7c3aed',
  },
  {
    id: 'delegate',
    icon: '🔗',
    title: 'Use Delegation, Not Impersonation',
    tagline: 'Use delegated tokens with limited scope',
    bullets: ['Maintain clear accountability back to the human principal'],
    colour: '#0369a1',
  },
  {
    id: 'privilege',
    icon: '🔒',
    title: 'Enforce Least Privilege',
    tagline: 'Limit agent access',
    bullets: ['Use short-lived tokens', 'Require human approval'],
    colour: '#065f46',
  },
  {
    id: 'hitl',
    icon: '👤',
    title: 'Human in the Loop',
    tagline: 'Prompt human for sensitive operations',
    bullets: ['e.g. CIBA', 'Log these verifications for audit purposes'],
    colour: '#9f1239',
  },
];

function OverviewGrid() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(170px,1fr))', gap: 12, marginBottom: 20 }}>
      {PRACTICES.map(p => (
        <div
          key={p.id}
          style={{
            background: '#fff',
            border: `2px solid ${p.colour}22`,
            borderTop: `4px solid ${p.colour}`,
            borderRadius: 10,
            padding: '14px 14px 12px',
          }}
        >
          <div style={{ fontSize: '1.6rem', marginBottom: 6 }}>{p.icon}</div>
          <p style={{ margin: '0 0 4px', fontWeight: 800, fontSize: '0.82rem', color: p.colour }}>{p.title}</p>
          <p style={{ margin: '0 0 8px', fontSize: '0.75rem', fontWeight: 600, color: '#374151' }}>{p.tagline}</p>
          <ul style={{ margin: 0, paddingLeft: 14 }}>
            {p.bullets.map(b => (
              <li key={b} style={{ fontSize: '0.72rem', color: '#374151', lineHeight: 1.45, marginBottom: 2 }}>{b}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// ─── Panel ────────────────────────────────────────────────────────────────────

export default function BestPracticesPanel({ isOpen, onClose, initialTabId }) {
  const { open: openEdu } = useEducationUI();

  /** Open a linked panel, close this one first. */
  const handleEduLink = (panelId, tabId) => {
    onClose();
    setTimeout(() => openEdu(panelId, tabId), 120);
  };

  const tabs = [
    // ── Overview ────────────────────────────────────────────────────────────
    {
      id: 'overview',
      label: 'Overview',
      content: (
        <>
          <p>
            PingOne defines five best practices for deploying AI agents securely. This demo
            implements all five — the tabs on this panel show exactly how each one maps to code,
            tokens, and UX in AI Demo.
          </p>
          <OverviewGrid />
          <p style={{ fontSize: '0.82rem', color: '#374151', borderTop: '1px solid #e5e7eb', paddingTop: 10 }}>
            Source: <em>Securing Digital Assistants with PingOne and PingOne Agent Gateway</em> — PingOne 2025.
            Each practice links to a deeper guide in the Learn menu.
          </p>
        </>
      ),
    },

    // ── Know Your Agents ────────────────────────────────────────────────────
    {
      id: 'know',
      label: 'Know Your Agents',
      content: (
        <>
          <h3>Know Your Agents</h3>
          <p>
            Every AI agent must have a registered identity — its own OAuth 2.0 client with a
            unique <code>client_id</code>. That identity is used to classify the agent, assign a
            human sponsor, and control what it can do.
          </p>

          <PracticeCard icon="🆔" title="Identify &amp; Classify AI Agents">
            The AI Demo BFF registers a dedicated agent OAuth client separate from the user
            client. Every MCP token carries a <code>client_id</code> that identifies the agent — not
            the user, not the BFF app — so audit logs can always attribute actions to the right
            principal.
          </PracticeCard>

          <PracticeCard icon="👤" title="Assign Sponsors to Govern Agent Access">
            In this demo the human customer is the implicit sponsor: the agent can only act when
            the customer is signed in and the session has a valid <code>may_act</code> claim.
            Production deployments should register a named human sponsor in the PingOne policy as
            an additional gate.
          </PracticeCard>

          <PracticeCard icon="🔄" title="Manage Agent Lifecycles">
            The agent client secret is rotated independently of user credentials. The
            <code>AGENT_OAUTH_CLIENT_ID</code> / <code>AGENT_OAUTH_CLIENT_SECRET</code> env vars
            are the lifecycle handle: rotating them revokes all in-flight agent tokens at the next
            refresh cycle.
          </PracticeCard>

          <h4>How AI Demo implements this</h4>
          <ul style={{ paddingLeft: 20, lineHeight: 1.8 }}>
            <ImplRow status="done" label="Dedicated agent OAuth client" detail="AGENT_OAUTH_CLIENT_ID env, oauthService.getAgentClientCredentialsToken()" />
            <ImplRow status="done" label="act claim in MCP token" detail="Every MCP call carries act: { client_id: <agent> } after RFC 8693 exchange" />
            <ImplRow status="done" label="Agent identity store" detail="agentIdentityStore.js — persists agent name/role metadata for the UI" />
            <ImplRow status="partial" label="Human sponsor binding" detail="Implicit via user session; explicit sponsor field is a P2 backlog item" />
          </ul>
          <div style={{ marginTop: 10 }}>
            <EduLink label="may_act / act claims" panelId={EDU.MAY_ACT} tabId="what" onClick={handleEduLink} />
            <EduLink label="Agent Gateway" panelId={EDU.AGENT_GATEWAY} tabId="what" onClick={handleEduLink} />
          </div>
        </>
      ),
    },

    // ── Detect Agents ───────────────────────────────────────────────────────
    {
      id: 'detect',
      label: 'Detect Agents',
      content: (
        <>
          <h3>Detect Agents</h3>
          <p>
            An agentic session looks different from a human session. The app needs to recognise
            that difference and apply tighter controls — scope restrictions, step-up gates, and
            audit tagging — when an agent is acting.
          </p>

          <PracticeCard icon="🏷️" title="Identify When a Session is Agentic">
            AI Demo marks every request that triggers an MCP tool call. The RFC 8693 exchange
            produces a token with an <code>act</code> claim — any downstream service can inspect
            this claim to know the session is agentic <em>without</em> out-of-band signalling.
          </PracticeCard>

          <PracticeCard icon="🛡️" title="Apply Specific IAM Controls for CUA (Computer-Use Agents)">
            Agent tool calls go through <code>agentMcpScopePolicy.js</code> which enforces an
            allow-list of scopes before the token exchange even starts. Scopes not on the allow-list
            are blocked at the BFF — PingOne never sees the exchange request.
          </PracticeCard>

          <PracticeCard icon="📌" title="Tag Agent Sessions">
            The MCP WebSocket initialize message carries <code>agentToken</code> (the exchanged
            MCP token) and <code>userSub</code> (the human principal's PingOne subject) as separate
            fields — the MCP server can log both to tag every server-side action with its human
            owner and agent executor.
          </PracticeCard>

          <pre className="edu-code">{`// What the MCP server receives on every tool call
ws.initialize({
  agentToken:     "<exchanged MCP JWT — not the user token>",
  userSub:        "user-abc123",          // human principal
  correlationId:  "req-xyz789",           // tracing
})
// act claim inside agentToken:
//   { "sub": "user-abc123", "act": { "client_id": "bx-agent" } }`}</pre>

          <h4>How AI Demo implements this</h4>
          <ul style={{ paddingLeft: 20, lineHeight: 1.8 }}>
            <ImplRow status="done" label="act claim detection" detail="act present in MCP token whenever AGENT_OAUTH_CLIENT_ID is configured" />
            <ImplRow status="done" label="Agent scope allow-list" detail="agentMcpScopePolicy.js + Config UI toggle per scope" />
            <ImplRow status="done" label="Session tagging" detail="userSub + correlationId passed to mcpRpc on every call" />
            <ImplRow status="partial" label="CUA-specific IAM controls" detail="Scope policy is in place; PingOne Authorize policy integration is Phase 2" />
          </ul>
          <div style={{ marginTop: 10 }}>
            <EduLink label="MCP Protocol" panelId={EDU.MCP_PROTOCOL} tabId="what" onClick={handleEduLink} />
            <EduLink label="Token Exchange" panelId={EDU.TOKEN_EXCHANGE} tabId="why" onClick={handleEduLink} />
          </div>
        </>
      ),
    },

    // ── Use Delegation, Not Impersonation ───────────────────────────────────
    {
      id: 'delegate',
      label: 'Delegation',
      content: (
        <>
          <h3>Use Delegation, Not Impersonation</h3>
          <p>
            Impersonation means the agent obtains the <em>user's own token</em> and pretends to be
            the user. Delegation means the agent gets its <em>own token</em> that is cryptographically
            linked back to the user — so every action is attributable to both the user (who authorised
            it) and the agent (who executed it).
          </p>

          <PracticeCard icon="🚫" title="Never Forward the User Token">
            <code>agentMcpTokenService.js</code> enforces RFC 8693 exchange as a hard requirement.
            If <code>mcp_resource_uri</code> is not configured the call throws <code>503 mcp_resource_uri_required</code>{' '}
            — there is no configuration or code path that forwards the raw user access token to
            the MCP server.
          </PracticeCard>

          <PracticeCard icon="🔗" title="Delegated Tokens with Limited Scope">
            The MCP token issued after RFC 8693 exchange has:
            <ul style={{ marginTop: 6, paddingLeft: 18 }}>
              <li>Audience narrowed to <code>mcp_resource_uri</code> (not the banking API)</li>
              <li>Scope narrowed to only the scopes the specific tool requires</li>
              <li>An <code>act</code> claim identifying the agent client as the current actor</li>
            </ul>
          </PracticeCard>

          <PracticeCard icon="📋" title="Maintain Clear Accountability Back to the Human Principal">
            The <code>sub</code> claim in the MCP token is still the <em>user's</em> subject — the
            human principal. The <code>act.sub</code> or <code>act.client_id</code> is the agent.
            Together they create a two-level chain: <em>on whose behalf</em> and <em>who is acting</em>.
          </PracticeCard>

          <pre className="edu-code">{`// RFC 8693 token exchange — BFF → PingOne
grant_type=urn:ietf:params:oauth:grant-type:token-exchange
subject_token=<user access token>           // "on whose behalf"
actor_token=<agent client_credentials JWT>  // "who is acting"
audience=<mcp_resource_uri>
scope=accounts:read

// Resulting MCP token claims:
{
  "sub":    "user-abc123",          // human principal
  "act":    { "client_id": "bx-agent" },  // agent actor
  "aud":    "https://mcp.bxfinance.com",
  "scope":  "accounts:read"
}`}</pre>

          <h4>How AI Demo implements this</h4>
          <ul style={{ paddingLeft: 20, lineHeight: 1.8 }}>
            <ImplRow status="done" label="RFC 8693 always enforced" detail="mcp_resource_uri required or 503 thrown; no bypass possible" />
            <ImplRow status="done" label="USE_AGENT_ACTOR removed" detail="Always uses performTokenExchangeWithActor when AGENT_OAUTH_CLIENT_ID set" />
            <ImplRow status="done" label="Subject-only fallback warning" detail="on-behalf-of-warning event in Token Chain when no agent client configured" />
            <ImplRow status="done" label="Audience + scope narrowing" detail="MCP token audience = mcp_resource_uri; scope = tool-specific" />
          </ul>
          <div style={{ marginTop: 10 }}>
            <EduLink label="may_act / act" panelId={EDU.MAY_ACT} tabId="rfc8693" onClick={handleEduLink} />
            <EduLink label="Token Exchange RFC 8693" panelId={EDU.TOKEN_EXCHANGE} tabId="why" onClick={handleEduLink} />
          </div>
        </>
      ),
    },

    // ── Enforce Least Privilege ─────────────────────────────────────────────
    {
      id: 'privilege',
      label: 'Least Privilege',
      content: (
        <>
          <h3>Enforce Least Privilege</h3>
          <p>
            The agent should have access to <em>exactly</em> what it needs for the current task —
            no more. Scope, audience, token lifetime, and human approval gates are all tools for
            keeping the blast radius small if something goes wrong.
          </p>

          <PracticeCard icon="🎛️" title="Limit Agent Access — Scope Allow-List">
            Every tool in the MCP catalog has a required scope set (e.g. <code>accounts:read</code>).{' '}
            <code>agentMcpScopePolicy.js</code> checks the allow-list from <strong>Config UI → Agent MCP scopes</strong>{' '}
            before the token exchange runs. If the tool's scope is not enabled, the call is rejected
            at the BFF — PingOne never processes the exchange.
          </PracticeCard>

          <PracticeCard icon="⏱️" title="Use Short-Lived Tokens">
            The exchanged MCP token has the lifetime set by PingOne on the token-exchange grant
            (typically shorter than the user token). The BFF middleware (<code>refreshIfExpiring</code>)
            proactively refreshes the user token when it is within 5 minutes of expiry — keeping
            the chain live without user friction.
          </PracticeCard>

          <PracticeCard icon="✋" title="Require Human Approval for High-Risk Actions">
            Transfers over the configured threshold trigger either:
            <ul style={{ marginTop: 6, paddingLeft: 18 }}>
              <li><strong>Step-up MFA</strong> — PingOne Authorize gate on the transfer API endpoint</li>
              <li><strong>Transaction Consent Modal</strong> — explicit in-UI checkbox approval</li>
            </ul>
            Both paths log the approval event and block the agent until the human acts.
          </PracticeCard>

          <pre className="edu-code">{`// Per-tool scope map in mcpWebSocketClient.js
MCP_TOOL_SCOPES = {
  get_my_accounts:       ['accounts:read'],
  get_my_transactions:   ['transactions:read'],
  create_transfer:       ['accounts:read', 'transactions:write'],
  get_account_balance:   ['accounts:read'],
}

// agentMcpScopePolicy.js — checked before token exchange
if (!isToolPermittedByAgentPolicy(toolScopes, agentAllowedSet)) {
  throw { code: 'agent_mcp_scope_denied', httpStatus: 403 };
}`}</pre>

          <h4>How AI Demo implements this</h4>
          <ul style={{ paddingLeft: 20, lineHeight: 1.8 }}>
            <ImplRow status="done" label="Per-tool scope enforcement" detail="agentMcpScopePolicy.js — allow-list configurable in Config UI" />
            <ImplRow status="done" label="Token refresh middleware" detail="refreshIfExpiring applied to /api/mcp, /api/demo-agent, /api/accounts etc." />
            <ImplRow status="done" label="Step-up auth gate" detail="authorizeGate.js + stepUpGate.js on high-value transaction endpoints" />
            <ImplRow status="done" label="Transaction consent approval" detail="TransactionConsentModal — human checkbox required before agent executes transfer" />
            <ImplRow status="done" label="Upstash re-fetch on stale session" detail="server.js middleware recovers tokens on cold-start to prevent silent privilege escalation" />
          </ul>
          <div style={{ marginTop: 10 }}>
            <EduLink label="Step-Up Auth" panelId={EDU.STEP_UP} tabId="what" onClick={handleEduLink} />
            <EduLink label="PingOne Authorize" panelId={EDU.PINGONE_AUTHORIZE} tabId="what" onClick={handleEduLink} />
            <EduLink label="Token Exchange" panelId={EDU.TOKEN_EXCHANGE} tabId="why" onClick={handleEduLink} />
          </div>
        </>
      ),
    },

    // ── Human in the Loop ───────────────────────────────────────────────────
    {
      id: 'hitl',
      label: 'Human in the Loop',
      content: (
        <>
          <h3>Human in the Loop</h3>
          <p>
            Fully autonomous agents are a liability for sensitive operations. A human must be able
            to see what the agent is doing, approve high-impact actions, and have every such
            approval logged for audit.
          </p>

          <PracticeCard icon="📲" title="Prompt Human for Sensitive Operations (CIBA)">
            CIBA (Client-Initiated Backchannel Authentication) sends an out-of-band approval
            request to the user's registered device <em>before</em> the agent receives the token
            it needs to proceed. The agent polls until approved — or times out and halts.
            <br /><br />
            In this demo the <strong>CIBA Panel</strong> and <strong>CIMD Simulator</strong> let
            you step through this flow live.
          </PracticeCard>

          <PracticeCard icon="☑️" title="Transaction Consent Modal">
            High-value transfers pop up an in-app consent dialog that the customer must tick.
            The agent cannot complete the transfer until the human has explicitly approved the
            specific amount and recipient. The consent challenge ID is stored server-side and
            verified before execution.
          </PracticeCard>

          <PracticeCard icon="📋" title="Log Verifications for Audit">
            Every approval event — CIBA, step-up MFA, consent modal — is written to the
            activity log (<code>activityLogger.js</code>) with the user subject, agent client ID,
            tool name, correlation ID, and timestamp. The admin Activity Logs page surfaces these
            entries in real time.
          </PracticeCard>

          <pre className="edu-code">{`// CIBA flow — agent waits for human approval
POST /api/auth/ciba/initiate
  { userId, scope, bindingMessage: "Approve $500 transfer to John" }
→ { auth_req_id }

// Poll until approved:
POST /token { grant_type: urn:openid:params:grant-type:ciba, auth_req_id }
→ authorization_pending  (retry every 5s)
→ tokens returned ✓  (human tapped Approve on their device)

// Delegated Access (RFC 8693 extension):
// After approval, exchange yields a token with:
//   sub = user, act = { client_id: "bx-agent" }
// The transfer executes with that token — audit trail complete.`}</pre>

          <h4>How AI Demo implements this</h4>
          <ul style={{ paddingLeft: 20, lineHeight: 1.8 }}>
            <ImplRow status="done" label="CIBA backchannel auth" detail="routes/ciba.js + CIBAPanel.js — full flow including CIMD simulator" />
            <ImplRow status="done" label="Transaction Consent Modal" detail="TransactionConsentModal.js — checkbox approval before high-value agent transfers" />
            <ImplRow status="done" label="Step-up MFA gate" detail="stepUpGate.js — PingOne step-up challenge on protected endpoints" />
            <ImplRow status="done" label="Delegated Access UI" detail="/delegated-access — family member delegation with RFC 8693 Act-as explainer" />
            <ImplRow status="done" label="Audit logging" detail="activityLogger.js logs every approval with userId, agentClientId, correlationId" />
          </ul>
          <div style={{ marginTop: 10 }}>
            <EduLink label="CIBA full guide" panelId={EDU.HUMAN_IN_LOOP} tabId="what" onClick={handleEduLink} />
            <EduLink label="Step-Up Auth" panelId={EDU.STEP_UP} tabId="what" onClick={handleEduLink} />
            <EduLink label="CIMD Simulator" panelId={EDU.CIMD} tabId="what" onClick={handleEduLink} />
          </div>
        </>
      ),
    },

    {
      id: 'snippets',
      label: 'Code snippets',
      content: (
        <>
          <h3 style={{ marginTop: 0 }}>Cross-cutting implementation hooks</h3>
          <p style={{ fontSize: '0.84rem', color: '#374151' }}>
            These are the same patterns the individual Learn drawers explain — collected here for a quick scan.
          </p>
          <EduImplIntro repoPath="agentMcpTokenService.js">Delegated MCP token</EduImplIntro>
          <pre className="edu-code">{SNIP_RESOLVE_MCP_TOKEN}</pre>
          <EduImplIntro repoPath="routes/ciba.js">Step-up / OOB approval entry point</EduImplIntro>
          <pre className="edu-code">{SNIP_CIBA_INITIATE}</pre>
        </>
      ),
    },
    {
      id: 'standards',
      label: 'IETF Standards',
      content: (
        <>
          <h3 style={{ marginTop: 0 }}>IETF Standards Behind These Practices</h3>
          <p>
            All five best practices in this panel are built on peer-reviewed, open IETF standards. Each guardrail maps to one or more active security standards from OAuth, WIMSE, JOSE Working Groups.
          </p>
          <ul style={{ paddingLeft: 20, lineHeight: 1.8 }}>
            <li><strong>Practice 1 — Know Your Agents:</strong> <code>RFC 8693</code> (Token Exchange), <code>act</code> claim proposal</li>
            <li><strong>Practice 2 — Detect Agents:</strong> <code>RFC 8693</code> exchanged tokens carry <code>act</code> claims</li>
            <li><strong>Practice 3 — Delegation:</strong> <code>RFC 8693</code> core standard, <code>Identity Chaining</code> (ID-JAG) for audit</li>
            <li><strong>Practice 4 — Least Privilege:</strong> <code>RAR (RFC 9396)</code> + <code>WIMSE Workload Identity</code></li>
            <li><strong>Practice 5 — Human in the Loop:</strong> <code>JAG-IR</code> (JWT Grant Interaction Response) for CIBA</li>
          </ul>
          <p style={{ marginTop: 16, fontSize: '0.82rem', borderTop: '1px solid #e5e7eb', paddingTop: 12 }}>
            All seven standards co-authored by Ping Identity are covered in depth in the <strong>IETF Standards: Agentic Identity</strong> panel (see Learn &amp; Explore menu).
          </p>
        </>
      ),
    },];

  return (
    <EducationDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="PingOne — AI Agent Best Practices"
      tabs={tabs}
      initialTabId={initialTabId}
    />
  );
}
