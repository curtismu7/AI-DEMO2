// banking_api_ui/src/components/education/AgenticMaturityPanel.js
import EducationDrawer from '../shared/EducationDrawer';

// ─── Small layout helpers ────────────────────────────────────────────────────

function Badge({ color, children }) {
  const colorMap = {
    red:    { bg: 'rgba(220,38,38,0.10)',  border: '#dc2626', text: '#7f1d1d' },
    amber:  { bg: 'rgba(217,119,6,0.10)',  border: '#d97706', text: '#78350f' },
    green:  { bg: 'rgba(22,163,74,0.10)',  border: '#16a34a', text: '#14532d' },
    blue:   { bg: 'rgba(37,99,235,0.10)',  border: 'var(--brand-navy)', text: 'var(--brand-navy)' },
    purple: { bg: 'rgba(124,58,237,0.10)', border: '#7c3aed', text: '#4c1d95' },
  };
  const c = colorMap[color] || colorMap.blue;
  return (
    <span style={{
      display: 'inline-block',
      background: c.bg,
      border: `1px solid ${c.border}`,
      color: c.text,
      borderRadius: 5,
      padding: '2px 9px',
      fontSize: '0.72rem',
      fontWeight: 700,
      letterSpacing: '0.04em',
      marginRight: 6,
      verticalAlign: 'middle',
    }}>{children}</span>
  );
}

function QuestionCard({ question, answer, color = 'blue' }) {
  const borderColor = { red: '#dc2626', amber: '#d97706', green: '#16a34a', blue: 'var(--brand-navy)', purple: '#7c3aed' }[color] || 'var(--brand-navy)';
  return (
    <div style={{
      border: `1px solid ${borderColor}33`,
      borderLeft: `4px solid ${borderColor}`,
      borderRadius: 8,
      padding: '10px 14px',
      marginBottom: 10,
      background: `${borderColor}08`,
    }}>
      <p style={{ margin: '0 0 4px', fontSize: '0.82rem', color: '#374151', fontStyle: 'italic' }}>
        ❓ {question}
      </p>
      <p style={{ margin: 0, fontSize: '0.86rem', fontWeight: 700, color: borderColor }}>
        → {answer}
      </p>
    </div>
  );
}

function LevelCard({ level, emoji, title, subtitle, color, children }) {
  const borderColor = { red: '#dc2626', amber: '#d97706', green: '#16a34a' }[color] || 'var(--brand-navy)';
  return (
    <div style={{
      border: `1px solid ${borderColor}33`,
      borderTop: `4px solid ${borderColor}`,
      borderRadius: 10,
      padding: '14px 16px',
      marginBottom: 16,
      background: '#fff',
    }}>
      <p style={{ margin: '0 0 6px', fontWeight: 700, fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: '1.2rem' }}>{emoji}</span>
        <Badge color={color}>Level {level}</Badge>
        {title}
      </p>
      {subtitle && <p style={{ margin: '0 0 10px', fontSize: '0.8rem', color: '#374151' }}>{subtitle}</p>}
      <div style={{ fontSize: '0.83rem', color: '#374151', lineHeight: 1.65 }}>{children}</div>
    </div>
  );
}

// ─── ASCII/HTML diagram ───────────────────────────────────────────────────────
//  Recreates the PingOne "Agentic Maturity Model" slide structure
//  in pure HTML so no external image is required.

function MaturityDiagram() {
  const boxStyle = (bg, border) => ({
    background: bg,
    border: `2px solid ${border}`,
    color: '#fff',
    borderRadius: 6,
    padding: '8px 14px',
    fontWeight: 700,
    fontSize: '0.82rem',
    whiteSpace: 'nowrap',
  });
  const questionStyle = {
    background: '#1e2d4a',
    border: '2px dashed #dc2626',
    borderRadius: 8,
    padding: '8px 12px',
    fontSize: '0.75rem',
    color: '#f5f5f5',
    maxWidth: 180,
    lineHeight: 1.5,
  };
  const dotStyle = {
    width: 12,
    height: 12,
    borderRadius: '50%',
    background: '#dc2626',
    display: 'inline-block',
    flexShrink: 0,
  };
  const line = {
    flex: '1 1 0',
    height: 2,
    background: '#6b7280',
    minWidth: 20,
  };
  const row = {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginBottom: 18,
  };
  const outerQ = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 4,
    marginLeft: 10,
  };

  return (
    <div style={{
      background: '#1a2035',
      borderRadius: 12,
      padding: '24px 20px',
      marginBottom: 20,
      fontFamily: 'sans-serif',
    }}>
      <p style={{ textAlign: 'center', color: '#fff', fontWeight: 700, fontSize: '1rem', margin: '0 0 20px' }}>
        Agentic Maturity Model
      </p>

      {/* Level 1 */}
      <div style={row}>
        <div style={boxStyle('#7f1d1d', '#dc2626')}>Agent 1</div>
        <div style={line} />
        <div style={dotStyle} />
        <div style={line} />
        <div style={boxStyle('#7f1d1d', '#dc2626')}>MCP Server</div>
        <div style={line} />
        <div style={dotStyle} />
        <div style={line} />
        <div style={boxStyle('#7f1d1d', '#dc2626')}>Public, Anonymous Data</div>
      </div>

      {/* Level 2 */}
      <div style={{ ...row, alignItems: 'flex-start' }}>
        <div style={{ ...boxStyle('#7f1d1d', '#dc2626'), marginTop: 10 }}>Agent 2</div>
        <div style={{ ...line, marginTop: 20 }} />
        <div style={{ ...dotStyle, marginTop: 16 }} />
        <div style={{ ...line, marginTop: 20 }} />
        <div style={{ ...boxStyle('#7f1d1d', '#dc2626'), marginTop: 10 }}>MCP Server</div>
        <div style={{ ...line, marginTop: 20 }} />
        <div style={{ ...dotStyle, marginTop: 16 }} />
        <div style={{ ...line, marginTop: 20 }} />
        <div style={{ ...boxStyle('#7f1d1d', '#dc2626'), marginTop: 10 }}>Secure, Domain Data</div>
        <div style={outerQ}>
          <div style={questionStyle}>
            Does the agent have entitlement to perform the action?
            <div style={{ color: '#f97316', fontWeight: 700, marginTop: 4 }}>Token or Credential</div>
          </div>
        </div>
      </div>

      {/* Level 3 */}
      <div style={{ ...row, alignItems: 'flex-start' }}>
        <div style={{ ...boxStyle('#7f1d1d', '#dc2626'), marginTop: 10 }}>Agent 3</div>
        <div style={{ ...line, marginTop: 20 }} />
        <div style={{ ...dotStyle, marginTop: 16 }} />
        <div style={{ ...line, marginTop: 20 }} />
        <div style={{ ...boxStyle('#7f1d1d', '#dc2626'), marginTop: 10 }}>Agent 2</div>
        <div style={{ ...line, marginTop: 20 }} />
        <div style={{ ...dotStyle, marginTop: 16 }} />
        <div style={{ ...line, marginTop: 20 }} />
        <div style={{ ...boxStyle('#7f1d1d', '#dc2626'), marginTop: 10 }}>MCP Server</div>
        <div style={{ ...line, marginTop: 20 }} />
        <div style={{ ...dotStyle, marginTop: 16 }} />
        <div style={{ ...line, marginTop: 20 }} />
        <div style={{ ...boxStyle('#7f1d1d', '#dc2626'), marginTop: 10 }}>Sensitive, User Data</div>
        <div style={outerQ}>
          <div style={{ ...questionStyle, marginBottom: 8 }}>
            Does the agent &amp; user have entitlement to perform the action?
            <div style={{ color: '#f97316', fontWeight: 700, marginTop: 4 }}>Dynamic Authorization</div>
          </div>
          <div style={{ ...questionStyle, marginBottom: 8 }}>
            Can a Workload call another Workload?
            <div style={{ color: '#f97316', fontWeight: 700, marginTop: 4 }}>Scope Based Access</div>
          </div>
          <div style={questionStyle}>
            Does the agent need human approval?
            <div style={{ color: '#f97316', fontWeight: 700, marginTop: 4 }}>HITL Approvals · Audit &amp; Monitor</div>
          </div>
        </div>
      </div>

      <p style={{ color: '#374151', fontSize: '0.7rem', textAlign: 'right', margin: 0 }}>
        Based on: PingOne — Agentic Maturity Model
      </p>
    </div>
  );
}

// ─── Panel tabs ───────────────────────────────────────────────────────────────

const tabs = [
  // ── OVERVIEW ──
  {
    id: 'overview',
    label: 'The Model',
    content: (
      <>
        <MaturityDiagram />

        <p>
          The <strong>Agentic Maturity Model</strong> (PingOne) describes three levels of AI agent
          capability—each with progressively stricter identity and access requirements. As you move from
          Level 1 to Level 3, the data is more sensitive, the chain of agents is longer, and the identity
          questions multiply.
        </p>

        <LevelCard level={1} emoji="🌐" title="Public, Anonymous Data" subtitle="No identity required" color="green">
          <p>
            The agent calls a service that returns public, non-sensitive data. No credentials are
            needed—it's comparable to a web browser fetching a public API. <strong>No token, no
            user, no delegation.</strong>
          </p>
          <p>
            <em>Example:</em> An agent reads a public exchange rate, a product catalog, or open government
            statistics.
          </p>
        </LevelCard>

        <LevelCard level={2} emoji="🔑" title="Secure, Domain Data" subtitle="Token or Credential required" color="amber">
          <p>
            The agent calls an MCP server that holds <strong>domain-specific, secured data</strong>. The server
            must verify that this particular agent is <em>entitled</em> to act at all.
          </p>
          <p>
            The key question is: <em>"Does the agent have entitlement to perform the action?"</em>&nbsp;
            The answer is a <strong>token or credential</strong> issued to the agent by an authorization
            server. Without it, the MCP server refuses the call.
          </p>
          <p>
            <em>Example:</em> An agent reads a company's internal knowledge base, a secure document store, or
            a domain API that requires a client credential or an API key.
          </p>
        </LevelCard>

        <LevelCard level={3} emoji="🧑‍💼" title="Sensitive, User Data" subtitle="Delegation + Dynamic Authorization + HITL" color="red">
          <p>
            Now there are <strong>two agents</strong> in the chain (Agent 3 → Agent 2 → MCP Server), and
            the data is <strong>sensitive and personal to an end user</strong>. This is the most demanding
            level. Three additional questions arise:
          </p>
          <ol>
            <li>
              <strong>Can this workload call another workload?</strong> — Access between agents must be
              explicitly scoped. The calling agent (Agent 3) must prove it is allowed to delegate to Agent 2,
              and Agent 2 must prove it is allowed to call the MCP Server. <Badge color="purple">Scope-Based Access</Badge>
            </li>
            <li>
              <strong>Do both the agent AND the user have entitlement?</strong> — It is not enough for the
              agent alone to have a token. The <em>user</em> whose data is being accessed must also have
              authorized this action for this agent in this context.{' '}
              <Badge color="blue">Dynamic Authorization</Badge>
            </li>
            <li>
              <strong>Does a human need to approve?</strong> — For high-risk or irreversible actions,
              no automated chain should be able to proceed without explicit human sign-off.{' '}
              <Badge color="red">HITL Approvals</Badge>
              {' '}All actors, intents, and actions must also be auditable.{' '}
              <Badge color="amber">Audit &amp; Monitor</Badge>
            </li>
          </ol>
          <p>
            <em>Example:</em> An agent orchestrates a money transfer for a specific customer. The customer's
            bank account data belongs to them; the agent chain must prove both agent and user entitlement,
            enforce scope between workloads, and surface a HITL consent step before executing.
          </p>
        </LevelCard>
      </>
    ),
  },

  // ── WHY IT MATTERS ──
  {
    id: 'why',
    label: 'Why It Matters',
    content: (
      <>
        <p>
          The maturity model exists because <strong>not all agent actions carry the same risk</strong>. Treating
          every agent call as if it were a public API invites over-privilege. Treating every call as if it
          needed full HITL creates unnecessary friction. The model gives you <strong>language and structure </strong>
          to match controls to actual risk.
        </p>

        <h3>The problem it solves</h3>

        <QuestionCard
          question="'The agent has a token — isn't that enough?'"
          answer="Not at Level 3. An agent token proves the agent is allowed to call the service; it does not prove the human principal authorized this specific action, or that the delegating agent had permission to delegate."
          color="red"
        />
        <QuestionCard
          question="'We trust our own agents — why enforce scope between them?'"
          answer="Agents fail, get compromised, or receive injected instructions. Scope-based access limits blast radius: a compromised Agent 3 cannot instruct Agent 2 to perform actions outside the granted scope window."
          color="amber"
        />
        <QuestionCard
          question="'Can't we just log everything and audit after the fact?'"
          answer="Audit helps, but it doesn't undo an irreversible $50,000 transfer. HITL prevents the harm; audit records who authorized what. Both are needed at Level 3."
          color="purple"
        />

        <h3>The identity questions at each level</h3>
        <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse', marginBottom: 16 }}>
          <thead>
            <tr style={{ background: '#f3f4f6', textAlign: 'left' }}>
              <th style={{ padding: '6px 8px', borderBottom: '2px solid #e5e7eb' }}>Level</th>
              <th style={{ padding: '6px 8px', borderBottom: '2px solid #e5e7eb' }}>Data</th>
              <th style={{ padding: '6px 8px', borderBottom: '2px solid #e5e7eb' }}>Identity Question</th>
              <th style={{ padding: '6px 8px', borderBottom: '2px solid #e5e7eb' }}>Control</th>
            </tr>
          </thead>
          <tbody>
            {[
              ['pub', '1', 'Public', 'None — open access', '—'],
              ['sec-ent', '2', 'Secure, Domain', 'Does this agent have entitlement?', 'Token / Credential'],
              ['sens-dyn', '3', 'Sensitive, User', 'Agent AND user entitlement?', 'Dynamic Authorization'],
              ['sens-scope', '3', 'Sensitive, User', 'Can workload call workload?', 'Scope-Based Access'],
              ['sens-hitl', '3', 'Sensitive, User', 'Human approval needed?', 'HITL + Audit'],
            ].map(([key, l, d, q, c], idx) => (
              <tr key={key} style={{ borderBottom: '1px solid #e5e7eb', background: idx % 2 === 0 ? '#fff' : '#f9fafb' }}>
                <td style={{ padding: '6px 8px', fontWeight: 700 }}>{l}</td>
                <td style={{ padding: '6px 8px' }}>{d}</td>
                <td style={{ padding: '6px 8px', fontStyle: 'italic' }}>{q}</td>
                <td style={{ padding: '6px 8px', color: '#dc2626', fontWeight: 600 }}>{c}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3>Key insight: the chain multiplies risk</h3>
        <p>
          At Level 1 there is one actor. At Level 3 there are at least three (Agent 3, Agent 2, MCP Server)
          plus the end user. Every extra hop in the chain is <strong>another place for entitlement to break
          down</strong>: the outer agent may have scope the inner service should not honor, or the inner
          agent may try to act on behalf of a user who never consented.
        </p>
        <p>
          The model's point is not that Level 3 is dangerous and should be avoided — it is that Level 3{' '}
          <em>requires all the controls Level 1 and Level 2 rely on, plus more</em>.
        </p>
      </>
    ),
  },

  // ── RFC / STANDARD MAPPING ──
  {
    id: 'standards',
    label: 'Standards Mapping',
    content: (
      <>
        <p>
          Each control in the maturity model maps to one or more IETF / OAuth2 standards. This is
          important: the controls are not bespoke features of one vendor — they are implemented using
          open, interoperable specifications.
        </p>

        <LevelCard level={2} emoji="🔑" title="Token or Credential" color="amber">
          <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#fef3c7' }}>
                <th style={{ padding: '5px 8px', textAlign: 'left' }}>Standard</th>
                <th style={{ padding: '5px 8px', textAlign: 'left' }}>Role</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['cc', 'OAuth 2.0 Client Credentials (RFC 6749)', 'Machine-to-machine: agent gets its own access token'],
                ['jwtauth', 'RFC 7521 / 7523 — JWT client auth', 'Agent authenticates with a signed assertion, not a secret'],
                ['ri', 'RFC 8707 — Resource Indicators', 'Token is audience-restricted to the specific MCP server'],
                ['prm', 'RFC 9728 — Protected Resource Metadata', 'MCP server publishes its expected token audience (.well-known)'],
              ].map(([key, s, r]) => (
                <tr key={key} style={{ borderBottom: '1px solid #fde68a' }}>
                  <td style={{ padding: '5px 8px', fontWeight: 600 }}>{s}</td>
                  <td style={{ padding: '5px 8px' }}>{r}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </LevelCard>

        <LevelCard level={3} emoji="🧑‍💼" title="Scope-Based Access (workload → workload)" color="red">
          <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse' }}>
            <tbody>
              {[
                ['rfc8693', 'RFC 8693 — Token Exchange', 'Outer agent exchanges its token for a delegated token scoped to inner agent; preserves subject identity'],
                ['mayact', 'may_act / act claims', "Token carries act.sub (agent acting) and may_act (delegating agent\u2019s permission); receiver validates both"],
                ['oauth21', 'OAuth 2.1 — downscoped tokens', 'Exchanged tokens MUST NOT expand scope beyond original grant'],
                ['cimd', 'CIMD — RFC 9728 extension', 'MCP server publishes which agent client IDs are trusted to receive tokens'],
              ].map(([key, s, r], idx) => (
                <tr key={key} style={{ borderBottom: '1px solid #fecaca', background: idx % 2 === 0 ? '#fff' : '#fef2f2' }}>
                  <td style={{ padding: '5px 8px', fontWeight: 600 }}>{s}</td>
                  <td style={{ padding: '5px 8px' }}>{r}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </LevelCard>

        <LevelCard level={3} emoji="⚖️" title="Dynamic Authorization" color="red">
          <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse' }}>
            <tbody>
              {[
                ['p1authz', 'PingOne Authorize', 'Policy engine evaluates agent + user + resource + action in real time'],
                ['rar', 'RFC 9396 — RAR', 'Rich Authorization Requests carry fine-grained authorizations (amount, recipient, action type) into the token request'],
                ['intro', 'Token Introspection (RFC 7662)', 'MCP server live-checks token validity + scope + binding at call time'],
                ['ciba-dyn', 'CIBA (OpenID CIBA Core)', 'Out-of-band async authorization: user approves while agent waits'],
              ].map(([key, s, r], idx) => (
                <tr key={key} style={{ borderBottom: '1px solid #fecaca', background: idx % 2 === 0 ? '#fff' : '#fef2f2' }}>
                  <td style={{ padding: '5px 8px', fontWeight: 600 }}>{s}</td>
                  <td style={{ padding: '5px 8px' }}>{r}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </LevelCard>

        <LevelCard level={3} emoji="👤" title="HITL Approvals + Audit" color="red">
          <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse' }}>
            <tbody>
              {[
                ['ciba-hitl', 'CIBA (OpenID CIBA Core)', 'Backchannel auth pauses agent; user receives push/email approval request'],
                ['p1authz-hitl', 'PingOne Authorize', 'Policy decision can require explicit human approval step before permitting tool execution'],
                ['audit', 'Server-side audit log', 'All agent actions, token exchanges, consent decisions written to audit trail'],
                ['actclaim', 'act/may_act claims', 'Audit log can always identify the human principal (sub) and acting agent (act.sub)'],
              ].map(([key, s, r], idx) => (
                <tr key={key} style={{ borderBottom: '1px solid #fecaca', background: idx % 2 === 0 ? '#fff' : '#fef2f2' }}>
                  <td style={{ padding: '5px 8px', fontWeight: 600 }}>{s}</td>
                  <td style={{ padding: '5px 8px' }}>{r}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </LevelCard>
      </>
    ),
  },

  // ── IN THIS DEMO ──
  {
    id: 'demo',
    label: 'In This Demo',
    content: (
      <>
        <p>
          The banking demo is a <strong>Level 3 implementation</strong>. It requires agent entitlement,
          user delegation, and human-in-the-loop consent before executing sensitive financial operations.
          Here is where you see each maturity level in practice:
        </p>

        <LevelCard level={1} emoji="🌐" title="Not applicable — no public data" color="green">
          <p>
            The banking API has no anonymous endpoints. Every call requires an authenticated session or
            token. This is intentional — financial data is not public.
          </p>
        </LevelCard>

        <LevelCard level={2} emoji="🔑" title="Agent token via Token Exchange (RFC 8693)" color="amber">
          <ul>
            <li>
              The BFF calls <code>POST /api/mcp/tool</code>. Before forwarding to the MCP server, it
              calls <strong>agentMcpTokenService.js</strong> which performs an RFC&nbsp;8693 token
              exchange against PingOne.
            </li>
            <li>
              The resulting token carries <code>act.sub = &#123;agent-client-id&#125;</code> and the
              user's <code>sub</code> — so the MCP server always knows <em>who</em> is acting and on{' '}
              <em>whose behalf</em>.
            </li>
            <li>
              The MCP server introspects this token on every call
              (<strong>TokenIntrospector.ts</strong>). A stale or invalid token returns a{' '}
              <code>−32001</code> protocol error.
            </li>
          </ul>
          <pre className="edu-code">{`// services/agentMcpTokenService.js (simplified)
const exchanged = await pingoneTokenExchange({
  subject_token:       userAccessToken,
  subject_token_type:  'urn:ietf:params:oauth:token-type:access_token',
  client_id:           AGENT_CLIENT_ID,
  client_secret:       AGENT_CLIENT_SECRET,
  audience:            MCP_SERVER_RESOURCE_URI,
  scope:               toolScope,   // e.g. 'read' only
});
// exchanged.access_token carries:  act: { sub: "agent-client-id" }`}</pre>
        </LevelCard>

        <LevelCard level={3} emoji="🧑‍💼" title="Full Level 3: Delegation + Dynamic Auth + HITL" color="red">
          <p><strong>Scope-based workload access</strong></p>
          <ul>
            <li>
              The BFF (Agent 2) exchanges the user token for a <strong>downscoped agent token</strong>
              — scope is restricted to only what the requested tool requires
              (<code>agentMcpScopePolicy.js</code>).
            </li>
            <li>
              The MCP server's <strong>per-tool <code>requiredScopes</code></strong> list is checked
              before execution. Insufficient scope returns an error; there is no downgrade path.
            </li>
          </ul>

          <p><strong>Dynamic Authorization (PingOne Authorize)</strong></p>
          <ul>
            <li>
              When <code>ff_authorize_mcp_first_tool</code> is enabled, the BFF calls{' '}
              <strong>mcpToolAuthorizationService.js</strong> before the first tool call.
            </li>
            <li>
              A Trust Framework decision is made for the combination of
              UserId + TokenAudience + McpResourceUri + ActClientId. Only a <code>PERMIT</code>{' '}
              outcome allows the chain to continue.
            </li>
          </ul>

          <p><strong>Human-in-the-Loop</strong></p>
          <ul>
            <li>
              Transfers, withdrawals, and deposits <strong>over $500</strong> are gated by a consent
              challenge (<strong>transactionConsentChallenge.js</strong>).
            </li>
            <li>
              The server issues a one-time challenge (HMAC-SHA256). The user must confirm in the
              browser before the tool completes. The AI agent cannot bypass this step.
            </li>
            <li>
              For CIBA-mode consent: PingOne sends a push notification or email to the user. The
              agent polls for approval (<strong>cibaService.js</strong>); tool execution resumes only
              after approval.
            </li>
          </ul>

          <p><strong>Audit</strong></p>
          <ul>
            <li>
              <strong>delegationAuditLogger.js</strong> logs every agent-initiated action with the
              full token chain: human <code>sub</code>, agent <code>act.sub</code>, scopes used,
              MCP tool name, and outcome.
            </li>
          </ul>
        </LevelCard>

        <div style={{
          background: 'rgba(37,99,235,0.07)',
          border: '1px solid rgba(37,99,235,0.2)',
          borderRadius: 8,
          padding: '12px 16px',
          fontSize: '0.83rem',
          color: 'var(--brand-navy)',
        }}>
          <strong>💡 To see Level 3 in action:</strong> enable the AI Banking Assistant, ask it to
          transfer more than $500. You will see the HITL consent popup, the PingOne Authorize gate
          (if enabled in Feature Flags), and the agent token in the JWT panel — all in one flow.
        </div>
      </>
    ),
  },
];

// ─── Export ────────────────────────────────────────────────────────────────────

export default function AgenticMaturityPanel({ isOpen, onClose, initialTabId }) {
  return (
    <EducationDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="Agentic Maturity Model"
      tabs={tabs}
      initialTabId={initialTabId}
    />
  );
}
