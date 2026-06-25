// banking_api_ui/src/components/education/McpProtocolPanel.js
import React from 'react';
import { Link } from 'react-router-dom';
import EducationDrawer from '../shared/EducationDrawer';
import RfcLink from '../shared/RfcLink';
import { useEducationUI } from '../../context/EducationUIContext';
import { EDU } from './educationIds';
import { McpProtocolContent, OAuthApiCheatsheet } from './educationContent';
import { EduImplIntro, SNIP_MCP_BROWSER, SNIP_MCP_BFF } from './educationImplementationSnippets';

const TOOLS = [
  { name: 'get_my_accounts', scopes: 'banking read', returns: 'List of accounts for the user', readOnly: true },
  { name: 'get_account_balance', scopes: 'banking read', returns: 'Balance for one account', readOnly: true },
  { name: 'get_my_transactions', scopes: 'banking read', returns: 'Recent transactions', readOnly: true },
  { name: 'sequential_think', scopes: 'none', returns: 'Step-by-step reasoning chain', readOnly: true },
  { name: 'get_sensitive_account_details', scopes: 'sensitive:read', returns: 'Full account / routing numbers (PII)', readOnly: false },
  { name: 'create_deposit', scopes: 'banking write', returns: 'Deposit confirmation', readOnly: false },
  { name: 'create_withdrawal', scopes: 'banking write', returns: 'Withdrawal confirmation', readOnly: false },
  { name: 'create_transfer', scopes: 'banking write', returns: 'Transfer confirmation / ids', readOnly: false },
  { name: 'query_user_by_email', scopes: 'admin', returns: 'User lookup (admin scenarios)', readOnly: false },
];

export default function McpProtocolPanel({ isOpen, onClose, initialTabId }) {
  const { open } = useEducationUI();
  const tabs = [
    {
      id: 'what',
      label: 'How it works',
      content: (
        <>
          <McpProtocolContent />
          <p style={{ marginTop: 16 }}>
            <strong>See also:</strong>{' '}
            <button
              type="button"
              onClick={() => open(EDU.CUA, 'what')}
              style={{ background: 'none', border: 'none', color: 'var(--brand-navy)', cursor: 'pointer', padding: 0, textDecoration: 'underline', font: 'inherit' }}
            >
              Computer Use Agent (CUA)
            </button>
          </p>
        </>
      ),
    },
    {
      id: 'catalog',
      label: 'Available tools',
      content: (
        <>
          <p>
            <strong>🔐 MFA Gate:</strong> For security, some tools require MFA verification before they can be listed or executed.
            When you see an MFA prompt, you'll need to verify your identity using OTP, push notification, or other MFA methods.
          </p>
          <p>These are the banking actions the AI assistant can perform on your behalf:</p>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e5e7eb', textAlign: 'left' }}>
                <th style={{ padding: '0.35rem' }}>What the AI can do</th>
                <th style={{ padding: '0.35rem' }}>Access needed</th>
                <th style={{ padding: '0.35rem' }}>Returns</th>
                <th style={{ padding: '0.35rem', textAlign: 'center' }}>Read-only?</th>
              </tr>
            </thead>
            <tbody>
              {TOOLS.map((t) => (
                <tr key={t.name} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '0.35rem' }}><code>{t.name}</code></td>
                  <td style={{ padding: '0.35rem' }}>{t.scopes}</td>
                  <td style={{ padding: '0.35rem' }}>{t.returns}</td>
                  <td style={{ padding: '0.35rem', textAlign: 'center' }}>{t.readOnly ? '✓' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ fontSize: '0.82rem', color: '#374151', marginTop: 8 }}>
            Every tool call is checked against your permissions. The AI can only use tools that your access allows.
          </p>
          <p style={{ fontSize: '0.82rem', color: '#374151', marginTop: 4 }}>
            <strong>Read-only tools</strong> (✓) are safe for external agents to call without write permissions.
            Non-read-only tools require explicit write scopes or handle sensitive PII.
          </p>
        </>
      ),
    },
    {
      id: 'discovery',
      label: 'Server discovery',
      content: (
        <>
          <h3 style={{ marginTop: 0 }}>How external agents find this server</h3>
          <p>
            The <code>/.well-known/mcp-server</code> endpoint is a public discovery manifest that lists all
            available tools and their auth requirements. External MCP clients — Claude Desktop, Cursor, Windsurf —
            can query it <em>before</em> connecting to understand what the server offers and which tools require
            authentication.
          </p>

          <h4>Discovery endpoint</h4>
          <pre className="edu-code" style={{ fontSize: '0.82rem' }}>{'GET {MCP_SERVER_URL}/.well-known/mcp-server'}</pre>

          <h4>Example response (tool access tiers)</h4>
          <pre className="edu-code" style={{ fontSize: '0.75rem', lineHeight: 1.55, overflowX: 'auto' }}>{`{
  "name": "super-banking",
  "tools": [
    { "name": "get_my_accounts", "readOnly": true, ... },
    { "name": "create_transfer", "readOnly": false, ... }
  ],
  "publicAccess": {
    "readOnlyTools": [
      "get_my_accounts",
      "get_account_balance",
      "get_my_transactions",
      "sequential_think"
    ]
  },
  "restrictedAccess": {
    "authenticatedTools": [
      "get_sensitive_account_details",
      "create_deposit",
      "create_withdrawal",
      "create_transfer",
      "query_user_by_email"
    ]
  },
  "auth": {
    "type": "oauth2",
    "authorizationUrl": "https://auth.pingone.com/.../authorize",
    "tokenUrl": "https://auth.pingone.com/.../token"
  }
}`}</pre>

          <p style={{ fontSize: '0.82rem', color: '#374151', marginTop: 8 }}>
            The <code>publicAccess.readOnlyTools</code> list is what model-context–aware AI clients use to offer
            a preview of capabilities before asking the user to authenticate.
          </p>
          <p style={{ fontSize: '0.82rem', color: '#374151', marginTop: 4 }}>
            Reference:{' '}
            <a href="https://modelcontextprotocol.io/specification" target="_blank" rel="noopener noreferrer">
              Model Context Protocol specification
            </a>
          </p>
        </>
      ),
    },
    {
      id: 'auth',
      label: 'Security &amp; sign-in',
      content: <OAuthApiCheatsheet />,
    },
    {
      id: 'hosts',
      label: 'Two AI paths',
      content: (
        <>
          <h3>Two ways the AI can connect</h3>
          <p>
            <strong>Web app path (you are here):</strong> when you use the banking assistant in this browser,
            your session cookie is used to verify who you are. The app exchanges this for a secure, limited-access
            AI tools pass before calling any banking functions. Your browser never holds a security token.
          </p>
          <p>
            <strong>Autonomous AI agent path:</strong> a separate AI process (powered by an external reasoning service) can also
            connect to the same banking tools. Instead of your browser session, it uses its own machine credentials
            and can request approval from you out-of-band — for example, via an email or push notification — before
            performing high-value actions.
          </p>
          <p style={{ fontSize: '0.82rem', color: '#374151' }}>
            Both paths ultimately hit the same Banking Service and are subject to the same security checks.
            The difference is how they prove identity and get authorized.
          </p>
        </>
      ),
    },
    {
      id: 'auth-challenge',
      label: 'Auth challenge',
      content: (
        <>
          <h3 style={{ marginTop: 0 }}>What is an auth challenge?</h3>
          <p>
            An <strong>auth challenge</strong> occurs when an MCP tool call requires additional
            authorization before it can proceed. Rather than silently failing, the server signals
            the need for user approval so the flow can complete after authorization is granted.
          </p>

          <h4>Three trigger scenarios in this demo</h4>
          <ol style={{ paddingLeft: '1.25rem', lineHeight: 1.7 }}>
            <li>
              <strong>Amount threshold exceeded</strong> — transfers above the configured CIBA threshold
              trigger a push notification to the user out-of-band. The agent waits and retries when approval arrives.
            </li>
            <li>
              <strong>PingOne Authorize gate</strong> — high-risk tools (e.g., large withdrawals) are checked
              against a policy decision point before the token exchange proceeds.
            </li>
            <li>
              <strong>Mid-flow session loss</strong> — if the user&rsquo;s session expires during an agent
              operation, an inline login prompt appears in the browser. After re-authentication, the agent
              continues automatically.
            </li>
          </ol>

          <h4>Flow sequence</h4>
          <pre className="edu-code" style={{ fontSize: '0.78rem', lineHeight: 1.6, overflowX: 'auto' }}>{
`User clicks "Transfer $10,000" in agent
     ↓
BFF POST /api/mcp/tool → mcpToolAuthorizationService
     ↓
PingOne Authorize gate checks RAR / scopes
     ↓  [step-up needed]
BFF returns { error: "step_up_required", cibaRequired: true }
     ↓
UI shows "Approval needed" — polls /api/ciba/status every 5s
     ↓  [user approves on device / email link]
BFF retries tool call with elevated token
     ↓
Tool executes; result returned to agent`
          }</pre>

          <h4>Why this pattern matters</h4>
          <p>
            Agent operations get consent while keeping the user in control. The token is never escalated
            silently — every step-up is user-visible and audit-logged. This aligns with HITL (Human-in-the-loop)
            best practices and the FAPI 2.0 security profile for high-value transactions.
          </p>

          <p style={{ fontSize: '0.82rem', color: '#374151', marginTop: '1rem' }}>
            Note: &ldquo;All token exchange happens inside the BFF (server-side). The browser only holds a session cookie.&rdquo;
          </p>
        </>
      ),
    },
    {
      id: 'mfa-gate',
      label: 'MFA gate on tools',
      content: (
        <>
          <h3 style={{ marginTop: 0 }}>MFA gate on tool discovery</h3>
          <p>
            <code>GET /api/mcp/inspector/tools</code> (tools/list) requires an <strong>authenticated session</strong>.
            Unauthenticated requests receive <code>401 Unauthorized</code>, preventing tool enumeration by
            unauthenticated callers.
          </p>
          <pre className="edu-code" style={{ fontSize: '0.78rem', lineHeight: 1.6 }}>{
`GET /api/mcp/inspector/tools?sessionId=...

If no valid session:
  → 401 { error: "unauthorized", message: "Login required" }

If session present with valid access token:
  → 200 { tools: [ { name, description, inputSchema }, ... ] }

BFF validation steps:
  1. Session cookie present and not expired
  2. session.oauthTokens.accessToken valid (or refreshed via refresh_token)
  3. Token forwarded to MCP server tools/list call`
          }</pre>

          <h3>Why gate tools/list?</h3>
          <p>
            An unauthenticated caller could enumerate all available banking operations — account balance,
            transfer funds, device authentication — without being a real user. Gating the tool list at
            the BFF means even tool discovery is behind the same auth boundary as tool execution.
          </p>

          <h3>Step-up MFA for high-value tool calls</h3>
          <p>
            <code>POST /api/mcp/tool</code> (tools/call) for transactions at or above the configured
            threshold triggers <strong>step-up authentication</strong> before the tool executes.
            The agent receives a <code>401</code> with <code>step_up_required: true</code> and
            must wait for the user to complete MFA before retrying.
          </p>
          <pre className="edu-code" style={{ fontSize: '0.78rem', lineHeight: 1.6 }}>{
`POST /api/mcp/tool { tool: "transfer_funds", amount: 5000 }

Below threshold:
  → 200 { result: "Transfer complete" }

At/above threshold (step-up):
  → 401 { step_up_required: true, cibaAuthId: "..." }
  UI shows MFA prompt; polls /api/ciba/status
  On approval → retry POST /api/mcp/tool (same body)
  → 200 { result: "Transfer complete" }`
          }</pre>
        </>
      ),
    },
    {
      id: 'handshake',
      label: 'Handshake sequence',
      content: (
        <>
          <h3>MCP JSON-RPC Handshake</h3>
          <p>
            Every MCP session opens with a fixed four-step handshake over WebSocket.
            Messages are JSON-RPC 2.0. <RfcLink rfc="MCP_SPEC" />
          </p>

          <h4>Step 1 — Client → Server: <code>initialize</code></h4>
          <pre className="edu-code">{`{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-11-25",
    "capabilities": { "tools": {} },
    "clientInfo": { "name": "super-banking-bff", "version": "1.0.0" }
  }
}`}</pre>

          <h4>Step 2 — Server → Client: initialize response</h4>
          <pre className="edu-code">{`{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2025-11-25",
    "capabilities": { "tools": { "listChanged": false } },
    "serverInfo": { "name": "super-banking-mcp", "version": "1.0.0" }
  }
}`}</pre>

          <h4>Step 3 — Client → Server: <code>notifications/initialized</code></h4>
          <p>Notification only — no response expected from server.</p>
          <pre className="edu-code">{`{
  "jsonrpc": "2.0",
  "method": "notifications/initialized"
}`}</pre>

          <h4>Step 4 — Client → Server: <code>tools/list</code></h4>
          <pre className="edu-code">{`// Request
{ "jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {} }

// Response (excerpt)
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "tools": [
      {
        "name": "get_my_accounts",
        "description": "List accounts for the authenticated user",
        "inputSchema": { "type": "object", "properties": {}, "required": [] }
      }
    ]
  }
}`}</pre>

          <h4>Calling a tool — <code>tools/call</code></h4>
          <pre className="edu-code">{`// Request
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "get_my_accounts",
    "arguments": {}
  }
}

// Success response
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "content": [{ "type": "text", "text": "[{...}]" }],
    "isError": false
  }
}

// Tool execution error (NOT a protocol error — still HTTP 200)
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "content": [{ "type": "text", "text": "Insufficient funds" }],
    "isError": true
  }
}`}</pre>

          <h4>Tool list change notification</h4>
          <pre className="edu-code">{`// Server pushes when available tools change (e.g. after auth state change)
{
  "jsonrpc": "2.0",
  "method": "notifications/tools/list_changed"
}
// Client should re-issue tools/list after receiving this`}</pre>

          <h4>Streamable HTTP transport — key headers</h4>
          <p style={{ fontSize: '0.82rem', marginBottom: 6 }}>
            Modern MCP uses Streamable HTTP (POST + optional SSE) instead of a persistent WebSocket.
          </p>
          <pre className="edu-code">{`// Client must accept both JSON and SSE
Accept: application/json, text/event-stream

// Version negotiation header (per-request in modern MCP)
MCP-Protocol-Version: 2025-11-25

// Session tracking (server assigns on first response)
Mcp-Session-Id: 1868a90c...

// Resume a broken SSE stream
GET /mcp HTTP/1.1
Last-Event-ID: <last-seen-event-id>`}</pre>
          <ul style={{ fontSize: '0.82rem' }}>
            <li>Client POSTs every request; server replies with JSON or opens SSE stream</li>
            <li><code>Mcp-Session-Id</code> must be echoed on all subsequent requests</li>
            <li>Disconnection is NOT a cancellation — use <code>CancelledNotification</code> to cancel</li>
            <li>Server returns <code>404</code> when session expires; client must re-initialize</li>
          </ul>

          <div className="edu-info-box">
            The BFF performs the MCP handshake server-side and proxies tool calls via
            <code>POST /api/mcp/tool</code>. The browser never opens a WebSocket directly —
            all token exchange and session management stays in the BFF.
          </div>
        </>
      ),
    },
    {
      id: 'inspector',
      label: 'Live inspector',
      content: (
        <>
          <p>
            Use the in-app <Link to="/mcp-inspector">MCP Inspector</Link> to see all available tools in real time
            and try calling them directly through your current session.
          </p>
        </>
      ),
    },
    {
      id: 'inrepo',
      label: 'In this repo',
      content: (
        <>
          <h3 style={{ marginTop: 0 }}>Browser vs BFF</h3>
          <EduImplIntro repoPath="demo_api_ui/src/services/bankingAgentService.js">
            The React app only POSTs JSON; cookies carry the session.
          </EduImplIntro>
          <pre className="edu-code">{SNIP_MCP_BROWSER}</pre>
          <EduImplIntro repoPath="demo_api_server/server.js">
            After resolving the MCP access token (and gates), the BFF routes tool calls through demo_mcp_gateway (:3005).
          </EduImplIntro>
          <pre className="edu-code">{SNIP_MCP_BFF}</pre>

          <h3 style={{ marginTop: '1.25rem' }}>Key source files</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
            <thead>
              <tr style={{ background: '#f1f5f9', borderBottom: '1px solid #e5e7eb' }}>
                <th style={{ padding: '0.4rem 0.6rem', textAlign: 'left' }}>What</th>
                <th style={{ padding: '0.4rem 0.6rem', textAlign: 'left' }}>File</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['BFF MCP tool proxy entry point', 'demo_api_server/server.js (POST /api/mcp/tool)'],
                ['Authorization gate (PingOne Authorize)', 'demo_api_server/services/mcpToolAuthorizationService.js'],
                ['Token resolution & exchange', 'demo_api_server/services/agentMcpTokenService.js'],
                ['MCP server tool handler', 'demo_mcp_server/src/tools/BankingToolProvider.ts'],
                ['UI inline auth challenge', 'demo_api_ui/src/components/BankingAgent.js'],
                ['SSE flow milestones', 'demo_api_server/services/mcpFlowSseHub.js'],
              ].map(([what, file], i) => (
                <tr key={file} style={{ background: i % 2 === 0 ? '#fff' : '#f8fafc', borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '0.4rem 0.6rem', fontWeight: 500 }}>{what}</td>
                  <td style={{ padding: '0.4rem 0.6rem' }}><code className="edu-code" style={{ fontSize: '0.75rem' }}>{file}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ),
    },
  ];

  return (
    <EducationDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="How the AI banking assistant works"
      tabs={tabs}
      initialTabId={initialTabId}
    />
  );
}
