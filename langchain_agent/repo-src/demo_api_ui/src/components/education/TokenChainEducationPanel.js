// banking_api_ui/src/components/education/TokenChainEducationPanel.js
import React from 'react';
import EducationDrawer from '../shared/EducationDrawer';
import { useTokenChainOptional } from '../../context/TokenChainContext';
import { agentFlowDiagram } from '../../services/agentFlowDiagramService';

function OverviewTab() {
  return (
    <div>
      <h3 style={{ marginTop: 0 }}>What is a token chain?</h3>
      <p>
        A <strong>token chain</strong> tracks the lineage of OAuth tokens as they flow through
        the system — from initial login through delegation exchanges to final MCP tool calls.
        Each step in the chain records who the token belongs to, who is acting on their behalf,
        and what scopes were granted.
      </p>

      <h4>Why it matters</h4>
      <ul>
        <li><strong>Auditability</strong> — trace every action back to the original user and the delegated agent</li>
        <li><strong>Least privilege</strong> — each exchange can narrow scopes (never widen)</li>
        <li><strong>Delegation transparency</strong> — the <code>act</code> claim shows exactly who acted on behalf of whom</li>
        <li><strong>Debugging</strong> — see where in the chain a token was rejected or expired</li>
      </ul>

      <h4>Token chain lifecycle</h4>
      <pre className="edu-code">{`1. User Login (Authorization Code + PKCE)
   → access_token (sub=user, scopes=read,write,transfer)
   → refresh_token · id_token (nonce verified)
   ✓ RFC 7662 introspection — BFF asks PingOne "is this session still active?"
     Catches revoked tokens that are not yet expired.

2. Agent Actor Token (client_credentials) — when 2-exchange is active
   → actor_token (sub=agent-client-id, aud=agent-gateway)
   ✓ RFC 7515 JWKS — cryptographic signature verified against PingOne public key

3. Token Exchange — RFC 8693
   subject_token=user_token  (actor_token optional — see Exchange Paths tab)
   → exchanged_token (sub=user, act={client_id:bff}, aud=mcp_server)
   → Scopes narrowed to what MCP server needs
   ✓ RFC 7515 JWKS — signature of every exchanged token verified on arrival

4. MCP Tool Call
   → MCP server validates scopes for requested tool
   → Executes tool on behalf of user
   ✓ RFC 7515 JWKS — MCP server re-verifies the token it received`}</pre>

      <h4>Key components tracked</h4>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
            <th style={{ padding: '6px' }}>Field</th>
            <th style={{ padding: '6px' }}>Description</th>
          </tr>
        </thead>
        <tbody>
          {[
            ['tokenType', 'user_token, agent_token, or exchanged_token'],
            ['sub', 'Subject — the user the token represents'],
            ['act.client_id', 'Actor — the client acting on behalf of the user'],
            ['aud', 'Audience — the intended recipient of the token'],
            ['scopes', 'Granted permissions, narrowed at each exchange'],
            ['iss', 'Issuer — PingOne authorization server'],
            ['exp', 'Expiration timestamp'],
          ].map(([field, desc], i) => (
            <tr key={field} style={{ borderBottom: '1px solid #f3f4f6', background: i % 2 ? '#f9fafb' : 'white' }}>
              <td style={{ padding: '6px', fontFamily: 'inherit', fontSize: '0.8rem', fontWeight: 600 }}>{field}</td>
              <td style={{ padding: '6px' }}>{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function JwtClaimsTab({ liveIdentity }) {
  const liveSub = liveIdentity?.currentUser?.sub;
  const liveName = liveIdentity?.currentUser?.name || liveIdentity?.currentUser?.email || '';
  // Use live values when available, fall back to example placeholders
  const exampleSub = liveSub || 'a1b2c3d4-user-uuid';
  const exampleName = liveName || 'Jane Smith';
  const exampleEmail = liveIdentity?.currentUser?.email || 'jane@example.com';
  return (
    <div>
      <h3 style={{ marginTop: 0 }}>JWT claims in token exchange</h3>

      <h4>The <code>sub</code> claim — Subject</h4>
      <p>
        Always identifies the <strong>end user</strong>. In a delegated token, <code>sub</code> stays
        the same through every exchange — it's always the human who originally authenticated.
      </p>
      <pre className="edu-code">{`// User's original token
{
  "sub": "${exampleSub}",
  "name": "${exampleName}",
  "email": "${exampleEmail}"
}

// After token exchange — sub unchanged
{
  "sub": "${exampleSub}",  // same user
  "act": { "client_id": "bff-admin-app" }
}`}</pre>

      <h4>The <code>act</code> claim — Actor</h4>
      <p>
        Added by token exchange (RFC 8693). Identifies <strong>who is acting on behalf of</strong> the
        subject. In this demo, the BFF or AI agent acts on behalf of the user.
      </p>
      <pre className="edu-code">{`// 1-exchange: BFF acts directly
{
  "sub": "${exampleSub}",
  "act": {
    "client_id": "admin-oidc-app-id"
  }
}

// 2-exchange: Agent acts, then BFF acts on agent's behalf
{
  "sub": "${exampleSub}",
  "act": {
    "client_id": "bff-admin-app-id",
    "act": {
      "client_id": "ai-agent-app-id"
    }
  }
}`}</pre>

      <h4>The <code>may_act</code> claim — Permission to delegate</h4>
      <p>
        Present in the <strong>subject token</strong> (the user's original token). It tells the
        authorization server which clients are allowed to exchange this token.
      </p>
      <pre className="edu-code">{`// User's token with may_act
{
  "sub": "${exampleSub}",
  "may_act": {
    "client_id": "admin-oidc-app-id"
  }
}
// Only admin-oidc-app-id can exchange this token
// Any other client_id attempting exchange → "invalid_request"`}</pre>

      <h4>The <code>aud</code> claim — Audience</h4>
      <p>
        Specifies who the token is <strong>intended for</strong>. Each exchange can target a different
        audience (e.g., from the BFF's audience to the MCP server's audience).
      </p>
      <pre className="edu-code">{`// Step 1: User token audience = BFF
{ "aud": "banking_api_enduser" }

// Step 2: Exchanged token audience = MCP server
{ "aud": "https://mcp.pingdemo.com" }`}</pre>
    </div>
  );
}

function ExchangePathsTab() {
  return (
    <div>
      <h3 style={{ marginTop: 0 }}>Exchange paths</h3>

      <h4>Path 1: Direct exchange (1-exchange)</h4>
      <p>The BFF exchanges the user's token directly for an MCP-scoped token.</p>
      <pre className="edu-code">{`User Login
    │
    ▼
┌──────────────────┐
│ T1: User Token    │  sub=user, aud=bff
│ may_act: {        │
│   client_id: bff  │
│ }                 │
└────────┬─────────┘
         │ POST /as/token
         │ grant_type=token-exchange
         │ subject_token=T1
         │ audience=mcp_server
         ▼
┌──────────────────┐
│ T2: Delegated     │  sub=user, act={client_id:bff}
│ Token             │  aud=mcp_server
│                   │  scopes=read
└────────┬─────────┘
         │
         ▼
    MCP tools/call`}</pre>

      <h4>Path 2: Two-token exchange (2-exchange)</h4>
      <p>
        The AI agent first gets its own token (client_credentials), then the BFF
        exchanges both the user token and agent token for a delegated token.
      </p>
      <pre className="edu-code">{`User Login              Agent Bootstrap
    │                        │
    ▼                        ▼
┌──────────────┐    ┌──────────────┐
│ T1: User     │    │ T0: Agent    │
│ Token        │    │ Token        │
│ sub=user     │    │ sub=agent    │
│ may_act:     │    │ (client_cred)│
│  {client_id: │    └──────┬───────┘
│   agent}     │           │
└──────┬───────┘           │
       │                   │
       └───────┬───────────┘
               │ POST /as/token
               │ subject_token=T1
               │ actor_token=T0
               ▼
      ┌──────────────────┐
      │ T2: Delegated     │  sub=user
      │ Token             │  act={client_id:bff,
      │                   │       act:{client_id:agent}}
      └────────┬─────────┘
               │
               ▼
         MCP tools/call`}</pre>

      <h4>Scope narrowing</h4>
      <p>
        Each exchange can request fewer scopes than the original token. The authorization
        server will never grant more scopes than the subject token has.
      </p>
      <pre className="edu-code">{`T1 scopes: read write transfer admin
                    ↓ exchange requests only read
T2 scopes: read
// T2 can only read — even though T1 could write and transfer`}</pre>
    </div>
  );
}

function ExamplesTab() {
  return (
    <div>
      <h3 style={{ marginTop: 0 }}>Real token chain examples</h3>

      <h4>Example 1: Check balance via AI agent</h4>
      <pre className="edu-code">{`Step 1: User logs in as "bankuser"
  Event: user_login
  Token: access_token (sub=abc123, scopes=openid read write)

Step 2: User asks agent "What's my balance?"
  Event: agent_request
  Tool: get_balance

Step 3: BFF exchanges user token for MCP token
  Event: token_exchange
  Input:  T1 (sub=abc123, may_act={client_id:bff})
  Output: T2 (sub=abc123, act={client_id:bff}, aud=mcp_server)
  Scopes: read (narrowed from read,write)

Step 4: MCP server validates and executes
  Event: tool_call
  Tool: get_balance
  Result: { checking: $5,230.00, savings: $12,500.00 }`}</pre>

      <h4>Example 2: Transfer with step-up MFA</h4>
      <pre className="edu-code">{`Step 1: User requests "Transfer $500 to savings"
  Event: agent_request
  Tool: transfer_funds
  Amount: $500 (exceeds step-up threshold of $250)

Step 2: Step-up MFA triggered
  Event: mfa_challenge
  Method: email OTP
  ACR: urn:pingone:mfa

Step 3: User completes MFA
  Event: mfa_complete
  Result: success

Step 4: BFF exchanges with elevated token
  Event: token_exchange
  Scopes: transfer (requires step-up)

Step 5: Transfer executed
  Event: tool_call
  Tool: transfer_funds
  Result: { success: true, newBalance: $4,730.00 }`}</pre>

      <h4>Token chain visualization</h4>
      <p>
        The <strong>Token Chain Display</strong> in the Agent Flow Diagram panel shows these events
        in real time as they happen. Each event is color-coded by type:
      </p>
      <ul>
        <li><span style={{ color: 'var(--brand-navy)', fontWeight: 600 }}>●</span> <strong>user_token</strong> — initial login token</li>
        <li><span style={{ color: '#0891b2', fontWeight: 600 }}>●</span> <strong>user_token_introspection</strong> — RFC 7662: PingOne confirms session is active</li>
        <li><span style={{ color: '#7c3aed', fontWeight: 600 }}>●</span> <strong>agent_token</strong> — agent's client_credentials token (2-exchange only)</li>
        <li><span style={{ color: '#059669', fontWeight: 600 }}>●</span> <strong>exchanged_token</strong> — delegated token after RFC 8693 exchange</li>
        <li><span style={{ color: '#15803d', fontWeight: 600 }}>●</span> <strong>*_verified</strong> — RFC 7515 JWKS: cryptographic signature check on each token</li>
        <li><span style={{ color: '#dc2626', fontWeight: 600 }}>●</span> <strong>error</strong> — exchange failure (invalid scope, expired token, etc.)</li>
      </ul>
    </div>
  );
}


function TransactionTokensTab() {
  return (
    <div>
      <h3 style={{ marginTop: 0 }}>Transaction Tokens (draft-oauth-transaction-tokens-for-agents-06)</h3>

      <p>
        Transaction Tokens are a draft OAuth extension designed for <strong>agent-to-resource delegation</strong>.
        Unlike RFC 8693's general-purpose token exchange, Transaction Tokens add per-operation context and
        accountability to agent actions.
      </p>

      <h4>Key Concepts</h4>
      <ul>
        <li><strong>Transaction ID</strong> — Unique identifier per agent-user interaction. Enables audit trails
          and replay prevention. Example: <code className="edu-code-inline">txn-a1b2c3d4-e5f6-47a8-b9c0-d1e2f3a4b5c6</code></li>
        <li><strong>Transaction Scope</strong> — What operation the agent is authorized to perform.
          Example: <code className="edu-code-inline">check_balance</code> or <code className="edu-code-inline">transfer_funds</code></li>
        <li><strong>Agent Identity</strong> — Who initiated the request, carried in <code className="edu-code-inline">act</code> or
          <code className="edu-code-inline">agent_id</code> claim</li>
        <li><strong>Audit Trail</strong> — Every agent action is tagged with <code className="edu-code-inline">txn_id</code>,
          enabling compliance logging and incident investigation</li>
      </ul>

      <h4>Token Exchange Flow</h4>
      <pre className="edu-code">{`1. User logs in → receives user access token
2. Agent prepares delegation request:
   - subject_token: user access token
   - actor_token:   agent access token (client_credentials)
   - transaction context: scope + optional attestation
3. PingOne issues Transaction Token:
   {
     "sub":       "user-uuid",          // User identity
     "txn_id":    "txn-a1b2c3d4...",   // Transaction ID (unique)
     "txn_scope": "check_balance",      // Operation intent
     "act": { "sub": "agent-client-id" }, // Agent identity
     "aud":       "https://mcp.example.com"
   }
4. MCP server validates token:
   - Checks JWT signature (PingOne public key)
   - Validates audience matches MCP server URI
   - Logs txn_id for audit trail
   - Executes tool operation`}</pre>

      <h4>RFC 8693 vs Transaction Tokens</h4>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.83rem', marginBottom: '1rem' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #e5e7eb', background: '#f8fafc' }}>
            <th style={{ padding: '8px 10px', textAlign: 'left' }}>Aspect</th>
            <th style={{ padding: '8px 10px', textAlign: 'left' }}>RFC 8693</th>
            <th style={{ padding: '8px 10px', textAlign: 'left' }}>Transaction Tokens</th>
          </tr>
        </thead>
        <tbody>
          {[
            ['Design Intent', 'General-purpose delegation', 'Agent-specific delegation'],
            ['Scope Granularity', 'Broad scopes (e.g., read)', 'Per-operation (e.g., check_balance)'],
            ['Audit Trail', 'Agent ID only (act claim)', 'Transaction ID + scope + timestamp'],
            ['Replay Protection', 'TTL only', 'Transaction ID enables replay detection'],
            ['Key Claim', 'act (actor chain)', 'txn_id + txn_scope'],
            ['Status', '✅ RFC — Stable', '🔬 IETF Draft — In progress'],
          ].map(([aspect, rfc, txn], i) => (
            <tr key={aspect} style={{ borderBottom: '1px solid #f3f4f6', background: i % 2 ? '#f9fafb' : 'white' }}>
              <td style={{ padding: '7px 10px', fontWeight: 600 }}>{aspect}</td>
              <td style={{ padding: '7px 10px' }}>{rfc}</td>
              <td style={{ padding: '7px 10px' }}>{txn}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h4>When to use each mode</h4>
      <dl style={{ margin: 0 }}>
        <dt style={{ fontWeight: 700, marginTop: '0.75rem' }}>RFC 8693 (Default)</dt>
        <dd style={{ marginLeft: '1rem', marginBottom: '0.5rem', color: '#4b5563', fontSize: '0.85rem' }}>
          General-purpose token exchange that works with any OAuth 2.0 authorization server.
          Best for broad delegations and established integrations. This is the default mode in this demo.
        </dd>
        <dt style={{ fontWeight: 700 }}>Transaction Tokens</dt>
        <dd style={{ marginLeft: '1rem', color: '#4b5563', fontSize: '0.85rem' }}>
          Agent-specific delegation with fine-grained authorization and transaction audit context.
          Choose this mode for compliance requirements or detailed agent action auditing.
          Enable via <code className="edu-code-inline">TOKEN_EXCHANGE_MODE=transaction_tokens</code> in BFF <code className="edu-code-inline">.env</code>.
        </dd>
      </dl>

      <h4 style={{ marginTop: '1rem' }}>References</h4>
      <ul style={{ fontSize: '0.85rem' }}>
        <li><a href="https://tools.ietf.org/html/rfc8693" target="_blank" rel="noopener noreferrer">RFC 8693 — OAuth 2.0 Token Exchange</a> (IETF, Stable)</li>
        <li><a href="https://datatracker.ietf.org/doc/html/draft-oauth-transaction-tokens-for-agents-06" target="_blank" rel="noopener noreferrer">draft-oauth-transaction-tokens-for-agents-06</a> (IETF Internet Draft)</li>
      </ul>
    </div>
  );
}


function ComplianceTab() {
  const [flowState, setFlowState] = React.useState({ complianceSteps: [], complianceStep: null });
  const [claimDiagResult, setClaimDiagResult] = React.useState(null);
  const [claimDiagLoading, setClaimDiagLoading] = React.useState(false);

  React.useEffect(() => {
    return agentFlowDiagram.subscribe(state => {
      setFlowState({
        complianceSteps: state.complianceSteps || [],
        complianceStep: state.complianceStep || null,
      });
    });
  }, []);

  const fetchClaimDiagnostics = async () => {
    setClaimDiagLoading(true);
    try {
      const res = await fetch('/api/demo/claim-diagnostics');
      const data = await res.json();
      setClaimDiagResult(data);
      if (res.ok && data.overallPass) {
        // Mark step 12 as done in the diagram service
        const current = agentFlowDiagram.getState ? agentFlowDiagram.getState() : {};
        const steps = (current.complianceSteps || []).map(s =>
          s.id === 'claim-diagnostics' ? { ...s, status: 'done' } : s
        );
        if (steps.length) agentFlowDiagram.setState({ complianceSteps: steps });
      }
    } catch (err) {
      setClaimDiagResult({ error: 'fetch_failed', message: err.message });
    } finally {
      setClaimDiagLoading(false);
    }
  };

  const { complianceSteps, complianceStep } = flowState;

  const statusIcon  = { pending: '○', active: '⟳', done: '✅', error: '❌' };
  const statusColor = { pending: '#6b7280', active: '#2563eb', done: '#16a34a', error: '#dc2626' };

  return (
    <div>
      <h3 style={{ marginTop: 0, color: '#1e293b' }}>Phase 260 Compliance — 12-Step Flow</h3>
      <p style={{ color: '#374151', fontSize: '0.85rem', marginTop: 0 }}>
        Real-time status of the agent compliance flow
      </p>
      {complianceSteps.length === 0 ? (
        <p style={{ color: '#374151', fontStyle: 'italic', fontSize: '0.85rem' }}>
          Loading compliance steps…
        </p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', background: '#fff', borderRadius: 8, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
          <thead>
            <tr style={{ background: '#f1f5f9', borderBottom: '2px solid #e2e8f0', textAlign: 'left' }}>
              <th scope="col" style={{ padding: '7px 10px', width: '2.5rem', color: '#475569', fontWeight: 600 }}>Status</th>
              <th scope="col" style={{ padding: '7px 10px', width: '3rem', color: '#475569', fontWeight: 600 }}>#</th>
              <th scope="col" style={{ padding: '7px 10px', color: '#475569', fontWeight: 600 }}>Step</th>
            </tr>
          </thead>
          <tbody>
            {complianceSteps.map((step, i) => {
              const isActive = step.id === complianceStep;
              const isDiag = step.id === 'claim-diagnostics';
              return (
                <tr key={step.id} style={{
                  borderBottom: '1px solid #e2e8f0',
                  background: isActive ? '#eff6ff' : (step.status === 'done' ? '#f0fdf4' : (i % 2 ? '#f8fafc' : '#fff')),
                }}>
                  <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                    <span style={{ color: statusColor[step.status] || '#6b7280', fontSize: '1rem' }} aria-label={step.status}>
                      {statusIcon[step.status] || '○'}
                    </span>
                  </td>
                  <td style={{ padding: '6px 10px', color: '#374151', fontSize: '0.78rem' }}>{i + 1}</td>
                  <td style={{ padding: '6px 10px', color: isActive ? '#1d4ed8' : (step.status === 'done' ? '#15803d' : '#334155'), fontWeight: isActive ? 600 : 400 }}>
                    {step.label}
                    {isDiag && (
                      <>
                        <button
                          onClick={fetchClaimDiagnostics}
                          disabled={claimDiagLoading}
                          style={{ marginLeft: 8, fontSize: '0.72rem', padding: '1px 7px', cursor: 'pointer', borderRadius: 4, border: '1px solid rgba(65,105,225,0.5)', background: 'rgba(65,105,225,0.15)', color: '#c7d7ff' }}
                        >
                          {claimDiagLoading ? '⟳' : 'Run'}
                        </button>
                        {claimDiagResult && !claimDiagResult.error && (
                          <div style={{ marginTop: 5, fontSize: '0.76rem', color: '#9db4e8', lineHeight: 1.5 }}>
                            <div>may_act: {claimDiagResult.checks?.mayAct?.pass ? '✓' : '✗'} {claimDiagResult.checks?.mayAct?.detail || ''}</div>
                            <div>app mapping: {claimDiagResult.checks?.appMapping?.pass ? '✓' : '✗'} {claimDiagResult.checks?.appMapping?.detail || ''}</div>
                            <div>session token: {claimDiagResult.checks?.sessionToken?.present
                              ? `✓ scopes: ${(claimDiagResult.checks.sessionToken.scopes || []).join(', ') || '(none)'}`
                              : '✗ not found'}</div>
                            <div style={{ marginTop: 3, color: claimDiagResult.overallPass ? '#4CAF50' : '#fca5a5' }}>
                              {claimDiagResult.nextStep}
                            </div>
                          </div>
                        )}
                        {claimDiagResult?.error && (
                          <div style={{ marginTop: 3, fontSize: '0.76rem', color: '#fca5a5' }}>
                            {claimDiagResult.message || 'Diagnostic unavailable'}
                          </div>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function TokenChainEducationPanel({ isOpen, onClose, initialTabId }) {
  const tokenChain = useTokenChainOptional();
  const liveIdentity = tokenChain?.resolvedIdentity ?? null;

  const tabs = [
    { id: 'overview', label: 'Overview', content: <OverviewTab /> },
    { id: 'jwt-claims', label: 'JWT Claims', content: <JwtClaimsTab liveIdentity={liveIdentity} /> },
    { id: 'exchange-paths', label: 'Exchange Paths', content: <ExchangePathsTab /> },
    { id: 'examples', label: 'Examples', content: <ExamplesTab /> },
    { id: 'transaction-tokens', label: 'Transaction Tokens', content: <TransactionTokensTab /> },
    { id: 'compliance', label: 'Compliance', content: <ComplianceTab /> },
  ];

  return (
    <EducationDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="Token Chain — Delegation Tracking"
      tabs={tabs}
      initialTabId={initialTabId}
      width="min(680px, 100vw)"
    />
  );
}
