// banking_api_ui/src/components/education/TokenFlowPanel.js
import React from 'react';
import EducationDrawer from '../shared/EducationDrawer';
import TokenExchangeDiagram from './TokenExchangeDiagram';

const tabs = [
    {
      id: 'diagram',
      label: 'Diagram',
      content: (
        <>
          <h3 style={{ marginTop: 0 }}>2-Token Exchange Flow — Visual</h3>
          <p style={{ color: '#374151', fontSize: '0.85rem', marginBottom: 12 }}>
            End-to-end token journey from user login through one RFC 8693 exchange to the final MCP tool call. An optional two-exchange delegation path exists but is not the default.
          </p>
          <TokenExchangeDiagram />
        </>
      ),
    },
    {
      id: 'overview',
      label: 'Overview',
      content: (
        <>
          <h3>2-Token Exchange Flow</h3>
          <p>
            BX Finance uses a <strong>single RFC 8693 token exchange</strong> to safely
            delegate a user's banking authority to an MCP server tool —
            without ever exposing the user's original access token outside the BFF. An optional
            two-exchange delegation path (<code>_performTwoExchangeDelegation</code>) exists but is
            not the default.
          </p>

          <h4>The Exchange</h4>
          <p>
            The BFF performs exactly one RFC 8693 exchange per tool call:
          </p>
          <ul>
            <li>
              <strong>subject_token</strong> = user session access token
            </li>
            <li>
              <strong>actor_token</strong> = AI Agent CC token (when <code>USE_AGENT_ACTOR_FOR_MCP=true</code>)
            </li>
            <li>
              <strong>result</strong> = single exchanged token with <code>sub</code> = user and
              a single-level <code>act</code> claim (<code>act.sub</code> = agent client ID)
            </li>
          </ul>

          <p style={{ color: "#374151", marginBottom: "1rem" }}>
            In multi-service deployments, this pattern extends naturally — a separate exchange produces a token scoped to each backend service, with its own <code className="edu-code">aud</code> and minimal <code className="edu-code">scope</code>. Each service sees only the token meant for it.
          </p>

          <h4>End-to-end Guarantees</h4>
          <ul>
            <li><strong>Identity preservation:</strong> <code>sub</code> = user's ID throughout all tokens</li>
            <li><strong>Delegation audit:</strong> <code>act</code> chain records every actor in order</li>
            <li><strong>Scope narrowing:</strong> Final token carries only the tool's required scope</li>
            <li><strong>Audience isolation:</strong> Each token is only valid at its intended endpoint</li>
            <li><strong>Token containment:</strong> Raw access tokens stay server-side; only decoded claims reach the UI</li>
          </ul>

          <div style={{ background: '#1e293b', borderRadius: 8, padding: '16px 20px', marginTop: 16 }}>
            <code style={{ color: '#374151', fontSize: 12 }}>
              User AT + Agent CC Token → [RFC 8693 Exchange] → Exchanged Token (act.sub=agent) → MCP Server
            </code>
          </div>
        </>
      ),
    },
    {
      id: 'token-inventory',
      label: 'Token Inventory',
      content: (
        <>
          <h3>All Tokens in the Flow</h3>
          <p>Seven distinct tokens are created. Only the Exchanged MCP Token leaves the BFF as a Bearer value.</p>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#1e293b', color: '#cbd5e1' }}>
                <th style={{ padding: '10px', border: '1px solid #334155', textAlign: 'left' }}>#</th>
                <th style={{ padding: '10px', border: '1px solid #334155', textAlign: 'left' }}>Token</th>
                <th style={{ padding: '10px', border: '1px solid #334155', textAlign: 'left' }}>aud</th>
                <th style={{ padding: '10px', border: '1px solid #334155', textAlign: 'left' }}>Used for</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['1', 'User Access Token', 'agentgateway.ping.demo', 'Subject token for RFC 8693 exchange'],
                ['2', 'User ID Token', '(BFF client ID)', 'Identity verification, claims to UI'],
                ['3', 'Refresh Token', 'n/a', 'Silent token renewal'],
                ['4', 'AI Agent CC Token', 'agentgateway.ping.demo', 'Actor token for RFC 8693 exchange (when USE_AGENT_ACTOR_FOR_MCP=true)'],
                ['5', 'Exchanged MCP Token', 'resource-server.pingdemo.com', 'Bearer forwarded through gateway to MCP Server'],
                ['6', 'Intermediate Agent Token (optional)', 'agentgateway.ping.demo', 'Subject for optional 2nd exchange — non-default path only'],
                ['7', 'MCP Exchanger CC Token (optional)', 'mcp-gateway.pingdemo.com', 'Actor for optional 2nd exchange — non-default path only'],
              ].map(([n, name, aud, use]) => (
                <tr key={n} style={{ background: n % 2 === 0 ? '#0f172a' : '#1e293b' }}>
                  <td style={{ padding: '8px 10px', border: '1px solid #334155', color: '#374151' }}>{n}</td>
                  <td style={{ padding: '8px 10px', border: '1px solid #334155', color: '#e2e8f0', fontWeight: 500 }}>{name}</td>
                  <td style={{ padding: '8px 10px', border: '1px solid #334155', color: '#67e8f9', fontFamily: 'inherit', fontSize: 11 }}>{aud}</td>
                  <td style={{ padding: '8px 10px', border: '1px solid #334155', color: '#374151' }}>{use}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <p style={{ color: "#374151", marginBottom: "1rem", marginTop: "0.5rem" }}>
            The live demo surfaces the full decoded token set in the Token Chain panel — you can inspect <code className="edu-code">sub</code>, <code className="edu-code">aud</code>, <code className="edu-code">scope</code>, <code className="edu-code">act</code>, and <code className="edu-code">may_act</code> for each token after a tool call.
          </p>

          <h4 style={{ marginTop: 20 }}>Key claim on User AT: <code>may_act</code></h4>
          <p>
            The User AT carries a <code>may_act</code> claim that acts as a pre-approval for
            Exchange #1. PingOne verifies that the presenting <code>actor_token.sub</code> matches
            this value before issuing the intermediate token.
          </p>
          <pre style={{ background: '#0f172a', color: '#e2e8f0', padding: 14, borderRadius: 6, fontSize: 12 }}>
{`{
  "sub": "<user-sub>",
  "aud": "agentgateway.ping.demo",
  "scope": "openid profile email offline_access read write ai:agent",
  "may_act": { "sub": "<ai-agent-client-id>" }
}`}
          </pre>
        </>
      ),
    },
    {
      id: 'exchange-flow',
      label: 'Exchange Flow',
      content: (
        <>
          <h3>RFC 8693 Exchange — User AT → Exchanged MCP Token</h3>
          <p>
            The BFF calls PingOne's token endpoint using the AI Agent's client credentials as the
            actor, presenting the user's AT as the subject. This is the single exchange per tool call.
          </p>

          <pre style={{ background: '#0f172a', color: '#e2e8f0', padding: 14, borderRadius: 6, fontSize: 12 }}>
{`POST /as/token
Content-Type: application/x-www-form-urlencoded

grant_type=urn:ietf:params:oauth:grant-type:token-exchange
&subject_token=<user-access-token>
&subject_token_type=urn:ietf:params:oauth:token-type:access_token
&actor_token=<ai-agent-cc-token>
&actor_token_type=urn:ietf:params:oauth:token-type:access_token
&audience=<PINGONE_RESOURCE_MCP_GATEWAY_URI>
&client_id=<AGENT_OAUTH_CLIENT_ID>
&client_secret=<AGENT_OAUTH_CLIENT_SECRET>`}
          </pre>

          <p>PingOne validates:</p>
          <ul style={{ fontSize: 13 }}>
            <li>User AT is valid and not expired</li>
            <li><code>actor_token.sub</code> matches <code>subject_token.may_act.sub</code></li>
            <li>Requested audience is allowed</li>
          </ul>

          <p>Issues <strong>Exchanged MCP Token</strong> with single-level <code>act</code>:</p>
          <pre style={{ background: '#0f172a', color: '#e2e8f0', padding: 14, borderRadius: 6, fontSize: 12 }}>
{`{
  "sub": "<user-sub>",              // preserved
  "aud": "<PINGONE_RESOURCE_MCP_GATEWAY_URI>",
  "scope": "read write",
  "act": { "sub": "<ai-agent-client-id>" }  // single-level delegation
}`}
          </pre>

          <p>
            The BFF then forwards this exchanged token unchanged through demo_mcp_gateway (:3005) to
            the MCP server. The gateway does <strong>not</strong> perform a second RFC 8693 exchange
            on PERMIT.
          </p>

          <hr style={{ borderColor: '#334155', margin: '24px 0' }} />

          <h3>Optional: Two-Exchange Delegation Path (non-default)</h3>
          <p>
            A second exchange path (<code>_performTwoExchangeDelegation</code>) exists in the codebase
            but is <strong>not the default</strong>. It produces a nested two-level <code>act</code> chain
            using a separate MCP Exchanger client. This path is only activated explicitly — the standard
            BFF flow uses the single exchange above.
          </p>
        </>
      ),
    },
    {
      id: 'scopes-resources',
      label: 'Scopes & Resources',
      content: (
        <>
          <h3>Resource URIs</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#1e293b', color: '#cbd5e1' }}>
                <th style={{ padding: '10px', border: '1px solid #334155', textAlign: 'left' }}>Resource URI</th>
                <th style={{ padding: '10px', border: '1px solid #334155', textAlign: 'left' }}>Used by</th>
                <th style={{ padding: '10px', border: '1px solid #334155', textAlign: 'left' }}>Env Var</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['agentgateway.ping.demo', 'User AT audience + Exchange #1 intermediate token', 'PINGONE_RESOURCE_URI / MCP_RESOURCE_URI'],
                ['agentgateway.ping.demo', 'AI Agent CC Token audience', 'PINGONE_AGENT_GATEWAY_URI'],
                ['https://mcp-gateway.pingdemo.com', 'MCP Exchanger CC Token audience', 'PINGONE_MCP_GATEWAY_URI'],
                ['https://resource-server.pingdemo.com', 'Final MCP Token audience', 'PINGONE_RESOURCE_SERVER_URI / MCP_RESOURCE_SERVER_URI'],
              ].map(([uri, use, env]) => (
                <tr key={uri}>
                  <td style={{ padding: '8px 10px', border: '1px solid #334155', color: '#67e8f9', fontFamily: 'inherit', fontSize: 11 }}>{uri}</td>
                  <td style={{ padding: '8px 10px', border: '1px solid #334155', color: '#374151' }}>{use}</td>
                  <td style={{ padding: '8px 10px', border: '1px solid #334155', color: '#a3e635', fontFamily: 'inherit', fontSize: 11 }}>{env}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <p style={{ color: "#374151", marginBottom: "1rem", marginTop: "0.5rem" }}>
            Each route or service enforces its own audience and scope independently. A token valid for the MCP server resource is not valid at the banking API resource, even if both are in the same PingOne environment. The gateway enforces this boundary at each route.
          </p>

          <h3 style={{ marginTop: 20 }}>Scope Definitions</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#1e293b', color: '#cbd5e1' }}>
                <th style={{ padding: '10px', border: '1px solid #334155', textAlign: 'left' }}>Scope</th>
                <th style={{ padding: '10px', border: '1px solid #334155', textAlign: 'left' }}>Tools</th>
                <th style={{ padding: '10px', border: '1px solid #334155', textAlign: 'left' }}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['read', 'get_account_balance, get_transaction_history, get_investments, search_transactions', 'Read-only banking data'],
                ['write', 'transfer_funds, make_payment', 'Mutations — requires HITL consent'],
                ['ai:agent', 'query_ai (natural language)', 'AI query tool'],
                ['openid profile email', 'n/a', 'OIDC identity — on User AT only'],
                ['offline_access', 'n/a', 'Refresh token — User AT only'],
                ['admin:read admin:write users:read users:manage', 'admin tools', 'Worker app scopes — separate flow'],
              ].map(([scope, tools, notes]) => (
                <tr key={scope}>
                  <td style={{ padding: '8px 10px', border: '1px solid #334155', color: '#a3e635', fontFamily: 'inherit', fontSize: 11 }}>{scope}</td>
                  <td style={{ padding: '8px 10px', border: '1px solid #334155', color: '#374151', fontSize: 12 }}>{tools}</td>
                  <td style={{ padding: '8px 10px', border: '1px solid #334155', color: '#374151', fontSize: 12 }}>{notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ),
    },
    {
      id: 'act-chain',
      label: 'act Claim Chain',
      content: (
        <>
          <h3>RFC 8693 § 4.2 — The <code>act</code> Claim Delegation Chain</h3>
          <p>
            After the single exchange, the Exchanged MCP Token contains a single-level <code>act</code>
            structure that records the AI agent acting on behalf of the user.
          </p>
          <p>
            Reading: <em>the AI agent acted on behalf of the user.</em>
          </p>

          <pre style={{ background: '#0f172a', color: '#e2e8f0', padding: 14, borderRadius: 6, fontSize: 12 }}>
{`// Exchanged MCP Token — decoded payload (default single-exchange path)
{
  "sub": "b8e9302a-user-id",           // ← always the original user
  "aud": "<PINGONE_RESOURCE_MCP_GATEWAY_URI>",
  "scope": "read write",

  "act": {
    "sub": "<ai-agent-client-id>"      // ← single-level: agent acting for user
  }
}`}
          </pre>

          <h4>How the MCP Server validates this</h4>
          <ol style={{ fontSize: 13, lineHeight: 1.8 }}>
            <li>Verify JWT signature using PingOne JWKS</li>
            <li>Verify <code>aud</code> matches the configured MCP resource URI</li>
            <li>Verify <code>scope</code> contains the required tool scope</li>
            <li>Check <code>act.sub</code> is a known AI agent client ID</li>
            <li><code>sub</code> is the user — used for audit logging and data isolation</li>
          </ol>

          <h4 style={{ marginTop: 20 }}>How this differs from <code>may_act</code></h4>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#1e293b', color: '#cbd5e1' }}>
                <th style={{ padding: '10px', border: '1px solid #334155' }}>Claim</th>
                <th style={{ padding: '10px', border: '1px solid #334155' }}>RFC</th>
                <th style={{ padding: '10px', border: '1px solid #334155' }}>Direction</th>
                <th style={{ padding: '10px', border: '1px solid #334155' }}>Purpose</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ padding: '8px 10px', border: '1px solid #334155', color: '#67e8f9', fontFamily: 'inherit' }}>may_act</td>
                <td style={{ padding: '8px 10px', border: '1px solid #334155', color: '#374151' }}>§ 4.3</td>
                <td style={{ padding: '8px 10px', border: '1px solid #334155', color: '#374151' }}>Forward-looking</td>
                <td style={{ padding: '8px 10px', border: '1px solid #334155', color: '#374151' }}>User pre-approves who may exchange this token</td>
              </tr>
              <tr>
                <td style={{ padding: '8px 10px', border: '1px solid #334155', color: '#67e8f9', fontFamily: 'inherit' }}>act</td>
                <td style={{ padding: '8px 10px', border: '1px solid #334155', color: '#374151' }}>§ 4.2</td>
                <td style={{ padding: '8px 10px', border: '1px solid #334155', color: '#374151' }}>Retrospective</td>
                <td style={{ padding: '8px 10px', border: '1px solid #334155', color: '#374151' }}>Records who actually exercised delegation (audit trail)</td>
              </tr>
            </tbody>
          </table>

          <h4 style={{ marginTop: 20 }}>Source file</h4>
          <pre style={{ background: '#0f172a', color: '#e2e8f0', padding: 14, borderRadius: 6, fontSize: 12 }}>
{`// demo_api_server/services/agentMcpTokenService.js
// performTokenExchange() — performs single RFC 8693 exchange per tool call
// _performTwoExchangeDelegation() — optional non-default two-exchange path`}
          </pre>
        </>
      ),
    },
    {
      id: 'what-changed',
      label: 'What Changed',
      content: (
        <>
          <h3 style={{ marginTop: 0 }}>Token-by-Token: What Changed at Each Step</h3>
          <p style={{ color: '#374151', fontSize: '0.85rem', marginBottom: 16 }}>
            Each row is one token or exchange. The right column shows what was added, removed, or narrowed versus the previous token.
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
              <thead>
                <tr style={{ background: '#1e293b' }}>
                  <th style={{ padding: '10px 12px', border: '1px solid #334155', textAlign: 'left', color: '#cbd5e1', width: '30%' }}>Token / Step</th>
                  <th style={{ padding: '10px 12px', border: '1px solid #334155', textAlign: 'left', color: '#cbd5e1' }}>What changed</th>
                </tr>
              </thead>
              <tbody>
                {[
                  {
                    step: '① User Login',
                    token: 'User Access Token',
                    color: '#d97706',
                    bg: '#1c1a0d',
                    rows: [
                      ['aud set →', 'agentgateway.ping.demo  (broad user-facing resource)'],
                      ['scope set →', 'openid profile email offline_access read write ai:agent'],
                      ['may_act added →', '{ "sub": "<ai-agent-client-id>" }  — pre-approval for token exchange'],
                      ['act', '(absent — no delegation yet)'],
                      ['where it lives', 'BFF server session only — never sent to browser or LLM'],
                    ],
                  },
                  {
                    step: '② RFC 8693 Exchange',
                    token: 'RFC 8693 request to PingOne',
                    color: '#7c3aed',
                    bg: '#150d26',
                    rows: [
                      ['subject_token', 'User AT (proves user identity)'],
                      ['actor_token', 'AI Agent CC Token (proves agent identity)'],
                      ['PingOne checks →', 'actor_token.sub === subject_token.may_act.sub'],
                      ['result', 'Exchanged MCP Token (below)'],
                    ],
                  },
                  {
                    step: '③ Exchanged MCP Token',
                    token: 'After RFC 8693 Exchange',
                    color: '#16a34a',
                    bg: '#0d1a0d',
                    rows: [
                      ['sub', 'UNCHANGED — still <user-id> end-to-end ✓'],
                      ['aud', 'CHANGED → <PINGONE_RESOURCE_MCP_GATEWAY_URI>'],
                      ['scope', 'NARROWED → read  write  (OIDC claims removed)'],
                      ['may_act', 'REMOVED — no further prospective delegation'],
                      ['act added →', '{ "sub": "<ai-agent-client-id>" }  — single-level delegation fact recorded'],
                      ['where it goes', 'Bearer header forwarded through demo_mcp_gateway to MCP Server'],
                    ],
                  },
                  {
                    step: '④ Browser / UI',
                    token: 'What reaches the client',
                    color: '#3b82f6',
                    bg: '#0f1f35',
                    rows: [
                      ['raw tokens', 'NEVER sent to browser'],
                      ['decoded claims', 'Served via /api/tokens/session-preview and /api/token-chain'],
                      ['visible fields', 'sub, aud, scope, act, may_act, iat, exp — read-only display'],
                    ],
                  },
                ].map(({ step, token, color, bg, rows }) => (
                  <React.Fragment key={step}>
                    {/* Section header row */}
                    <tr style={{ background: bg }}>
                      <td
                        colSpan={2}
                        style={{
                          padding: '8px 12px',
                          border: `1px solid ${color}`,
                          borderLeft: `4px solid ${color}`,
                          color,
                          fontWeight: 700,
                          fontSize: '0.76rem',
                        }}
                      >
                        {step} — <span style={{ fontWeight: 400, color: '#374151' }}>{token}</span>
                      </td>
                    </tr>
                    {/* Detail rows */}
                    {rows.map(([field, value], i) => (
                      <tr key={field} style={{ background: i % 2 === 0 ? '#0f172a' : '#111827' }}>
                        <td style={{
                          padding: '6px 12px 6px 24px',
                          border: '1px solid #1e293b',
                          borderLeft: `4px solid ${color}`,
                          color: '#374151',
                          fontFamily: 'inherit',
                          whiteSpace: 'nowrap',
                          verticalAlign: 'top',
                        }}>
                          {field}
                        </td>
                        <td style={{
                          padding: '6px 12px',
                          border: '1px solid #1e293b',
                          color: '#e2e8f0',
                          fontFamily: value.startsWith('{') || value.includes('→') ? 'inherit' : 'inherit',
                          fontSize: value.startsWith('{') ? '0.72rem' : 'inherit',
                          lineHeight: 1.5,
                        }}>
                          {value.includes('UNCHANGED') && (
                            <span style={{ color: '#22c55e', fontWeight: 600 }}>{value}</span>
                          )}
                          {value.includes('NARROWED') && (
                            <span style={{ color: '#f59e0b', fontWeight: 600 }}>{value}</span>
                          )}
                          {value.includes('CHANGED') && !value.includes('UNCHANGED') && (
                            <span style={{ color: '#60a5fa', fontWeight: 600 }}>{value}</span>
                          )}
                          {value.includes('REMOVED') && (
                            <span style={{ color: '#f87171', fontWeight: 600 }}>{value}</span>
                          )}
                          {value.includes('NEVER') && (
                            <span style={{ color: '#f87171', fontWeight: 600 }}>{value}</span>
                          )}
                          {!value.includes('UNCHANGED') && !value.includes('NARROWED') &&
                           !value.includes('REMOVED') && !value.includes('NEVER') &&
                           !(value.includes('CHANGED') && !value.includes('UNCHANGED')) && (
                            <span>{value}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {/* Colour legend */}
          <div style={{ display: 'flex', gap: 16, marginTop: 14, flexWrap: 'wrap', fontSize: '0.7rem' }}>
            {[
              ['#22c55e', 'UNCHANGED'],
              ['#f59e0b', 'NARROWED'],
              ['#60a5fa', 'CHANGED'],
              ['#f87171', 'REMOVED / NEVER'],
            ].map(([color, label]) => (
              <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#374151' }}>
                <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: color }} />
                {label}
              </span>
            ))}
          </div>
        </>
      ),
    },
];

export default function TokenFlowPanel({ isOpen, onClose, initialTabId }) {
  return (
    <EducationDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="2-Token Exchange Flow"
      tabs={tabs}
      initialTabId={initialTabId}
    />
  );
}
